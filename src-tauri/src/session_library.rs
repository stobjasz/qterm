//! Session references, explicit discovery and recoverable pins. No transcript copies.
use crate::{
    claude::{self, ClaudeSession, TranscriptSummary},
    repo_state,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    fs,
    io::Read,
    path::{Path, PathBuf},
    sync::Mutex,
};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Provider {
    Claude,
    Codex,
}
#[derive(Clone, Copy)]
pub struct Enabled {
    pub claude: bool,
    pub codex: bool,
}
impl Enabled {
    pub fn get(self, p: Provider) -> bool {
        match p {
            Provider::Claude => self.claude,
            Provider::Codex => self.codex,
        }
    }
}
pub fn environment(profile: &str, cwd: Option<&str>) -> String {
    if let Some(distro) = profile.strip_prefix("wsl:").filter(|s| !s.is_empty()) {
        return format!("wsl:{}", distro.to_lowercase());
    }
    if cwd.is_some_and(|p| {
        let b = p.as_bytes();
        b.len() >= 3 && b[0].is_ascii_alphabetic() && b[1] == b':' && matches!(b[2], b'\\' | b'/')
    }) {
        "native".into()
    } else {
        "unknown".into()
    }
}
pub fn sighting_environment(
    profile: &str,
    cwd: Option<&str>,
    captured: Option<String>,
) -> Result<String, String> {
    if let Some(captured) = captured {
        if captured == "native" || captured == "unknown" {
            return Ok(captured);
        }
        if let Some(distro) = captured
            .strip_prefix("wsl:")
            .filter(|d| crate::wsl::valid_distribution(d))
        {
            return Ok(format!("wsl:{}", distro.to_lowercase()));
        }
        return Err("Invalid captured session environment".into());
    }
    let inferred = environment(profile, cwd);
    Ok(if inferred == "unknown" && cwd.is_none() {
        "native".into()
    } else {
        inferred
    })
}
pub fn session_environment(session: &ClaudeSession) -> String {
    session
        .environment
        .clone()
        .unwrap_or_else(|| environment(&session.profile_id, session.cwd.as_deref()))
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Reference {
    pub id: String,
    pub environment: String,
}
impl Reference {
    pub fn validate(&self) -> Result<(), String> {
        Identity {
            provider: Provider::Claude,
            id: self.id.clone(),
            environment: self.environment.clone(),
        }
        .validate()
    }
    pub fn matches(&self, session: &ClaudeSession) -> bool {
        self.id.eq_ignore_ascii_case(&session.id)
            && self.environment == session_environment(session)
    }
}
#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Identity {
    pub provider: Provider,
    pub environment: String,
    pub id: String,
}
impl Identity {
    pub fn key(&self) -> String {
        format!(
            "{:x}",
            Sha256::digest(format!(
                "{:?}\0{}\0{}",
                self.provider,
                self.environment,
                self.id.to_ascii_lowercase()
            ))
        )
    }
    pub(crate) fn validate(&self) -> Result<(), String> {
        if !crate::codex::valid_id(&self.id) || self.id != self.id.to_ascii_lowercase() {
            return Err("Expected a normalized UUID session ID".into());
        }
        if self.environment != "native"
            && self.environment != "unknown"
            && !(self.environment.starts_with("wsl:")
                && self.environment.len() > 4
                && self.environment.len() <= 160
                && self.environment == self.environment.to_lowercase()
                && !self.environment.chars().any(char::is_control))
        {
            return Err("Invalid session environment identity".into());
        }
        Ok(())
    }
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Pin {
    #[serde(flatten)]
    pub identity: Identity,
    pub pinned_at: u64,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Saved {
    version: u32,
    pins: Vec<Pin>,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Pins {
    pub pins: Vec<Pin>,
    pub revision: u64,
    pub error: Option<String>,
    pub recovery_required: bool,
    pub backup_path: Option<String>,
}
struct PinState {
    pins: Vec<Pin>,
    revision: u64,
    load_error: Option<String>,
    write_error: Option<String>,
    backup_path: Option<String>,
}
fn read(path: &Path) -> Result<Vec<Pin>, String> {
    let file = match fs::File::open(path) {
        Ok(f) => f,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(vec![]),
        Err(e) => return Err(format!("Could not read session pins: {e}")),
    };
    let mut bytes = vec![];
    file.take(1_048_577)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() > 1_048_576 {
        return Err("Session pins exceed 1 MiB; original preserved".into());
    }
    let saved: Saved =
        serde_json::from_slice(&bytes).map_err(|e| format!("Could not read session pins: {e}"))?;
    if saved.version != 1 || saved.pins.len() > 500 {
        return Err("Unsupported or excessive session pins; original preserved".into());
    }
    let mut keys = HashSet::new();
    for pin in &saved.pins {
        pin.identity.validate()?;
        if !keys.insert(pin.identity.key()) {
            return Err("Duplicate session pins; original preserved".into());
        }
    }
    Ok(saved.pins)
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceStatus {
    pub provider: Provider,
    pub environment: String,
    pub home: Option<String>,
    pub observed_at: Option<u64>,
    pub errors: Vec<String>,
    pub truncated: bool,
    pub enabled: bool,
}
pub struct Scan {
    pub provider: Provider,
    pub home: Option<String>,
    pub sessions: Vec<TranscriptSummary>,
    pub errors: Vec<String>,
}
struct Cached {
    signature: String,
    status: SourceStatus,
    sessions: Vec<TranscriptSummary>,
}
#[derive(Clone)]
pub struct SourceConfig {
    pub provider: Provider,
    pub environment: String,
    pub signature: String,
    pub home: Option<String>,
    pub enabled: bool,
}
pub struct ScopedScan {
    pub environment: String,
    pub signature: String,
    pub scan: Scan,
}
pub fn native_sources() -> Vec<SourceConfig> {
    [Provider::Claude, Provider::Codex]
        .into_iter()
        .map(|provider| SourceConfig {
            provider,
            environment: "native".into(),
            signature: String::new(),
            home: None,
            enabled: true,
        })
        .collect()
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub source_home: Option<String>,
    pub source_version: Option<String>,
    pub source_config: Option<String>,
    pub launch_cwd: Option<String>,
    pub key: String,
    #[serde(flatten)]
    pub identity: Identity,
    pub cwd: Option<String>,
    pub project: Option<String>,
    pub title: Option<String>,
    pub branch: Option<String>,
    pub last_prompt: Option<String>,
    pub modified: Option<u64>,
    pub seen_at: Option<u64>,
    pub profile_id: Option<String>,
    pub remembered: bool,
    pub pinned: bool,
    pub available: bool,
    pub availability: String,
    pub reason: Option<String>,
    pub observed_at: Option<u64>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub source_revision: String,
    pub entries: Vec<Entry>,
    pub sources: Vec<SourceStatus>,
    pub pins: Pins,
    pub truncated: bool,
}
pub struct Store {
    path: PathBuf,
    pins: Mutex<PinState>,
    sources: Mutex<HashMap<(Provider, String), Cached>>,
}
impl Store {
    pub fn load(path: PathBuf) -> Self {
        let (pins, load_error) = match read(&path) {
            Ok(v) => (v, None),
            Err(e) => (vec![], Some(e)),
        };
        Self {
            path,
            pins: Mutex::new(PinState {
                pins,
                load_error,
                revision: 0,
                write_error: None,
                backup_path: None,
            }),
            sources: Mutex::new(HashMap::new()),
        }
    }
    fn persist(&self, inner: &mut PinState) {
        if inner.load_error.is_some() {
            return;
        }
        let result = serde_json::to_string_pretty(&Saved {
            version: 1,
            pins: inner.pins.clone(),
        })
        .map_err(|e| e.to_string())
        .and_then(|json| claude::write_atomically(&self.path, &json));
        inner.write_error = result.err();
        inner.revision += 1;
    }
    fn pins_of(inner: &PinState) -> Pins {
        Pins {
            pins: inner.pins.clone(),
            revision: inner.revision,
            error: inner
                .load_error
                .clone()
                .or_else(|| inner.write_error.clone()),
            recovery_required: inner.load_error.is_some(),
            backup_path: inner.backup_path.clone(),
        }
    }
    pub fn pins(&self) -> Pins {
        let mut inner = self.pins.lock().unwrap();
        if inner.write_error.is_some() && inner.load_error.is_none() {
            self.persist(&mut inner);
        }
        Self::pins_of(&inner)
    }
    pub fn pin(&self, identity: Identity, pinned: bool) -> Result<Pins, String> {
        identity.validate()?;
        let mut inner = self.pins.lock().unwrap();
        if inner.load_error.is_some() {
            return Err("Recover saved pins or retry reading them before editing".into());
        }
        let key = identity.key();
        let existing = inner.pins.iter().any(|p| p.identity.key() == key);
        if existing == pinned {
            return Ok(Self::pins_of(&inner));
        }
        if pinned {
            if inner.pins.len() >= 500 {
                return Err("At most 500 sessions can be pinned".into());
            }
            inner.pins.push(Pin {
                identity,
                pinned_at: repo_state::now(),
            });
        } else {
            inner.pins.retain(|p| p.identity.key() != key);
        }
        self.persist(&mut inner);
        Ok(Self::pins_of(&inner))
    }
    pub fn pins_action(&self, action: &str) -> Result<Pins, String> {
        let mut inner = self.pins.lock().unwrap();
        match action {
            "retry" if inner.load_error.is_some() => match read(&self.path) {
                Ok(pins) => {
                    inner.pins = pins;
                    inner.load_error = None;
                    inner.write_error = None;
                    inner.revision += 1;
                }
                Err(e) => inner.load_error = Some(e),
            },
            "retry" => self.persist(&mut inner),
            "recover" if inner.load_error.is_some() => {
                if self.path.exists() {
                    if !self.path.is_file() {
                        return Err(
                            "Remove the filesystem blocker and retry; no directory was moved"
                                .into(),
                        );
                    }
                    let backup = self
                        .path
                        .with_extension(format!("backup-{}.json", crate::agent_pipe::random()?));
                    fs::rename(&self.path, &backup)
                        .map_err(|e| format!("Could not preserve session pin backup: {e}"))?;
                    inner.backup_path = Some(backup.to_string_lossy().into());
                }
                inner.load_error = None;
                self.persist(&mut inner);
            }
            "recover" => {}
            _ => return Err("Unknown session pin action".into()),
        }
        Ok(Self::pins_of(&inner))
    }
    #[cfg(test)]
    pub fn catalog(
        &self,
        remembered: &[(Provider, Vec<ClaudeSession>)],
        enabled: Enabled,
        scans: Vec<Scan>,
    ) -> Snapshot {
        self.catalog_sources(
            remembered,
            enabled,
            native_sources(),
            scans
                .into_iter()
                .map(|scan| ScopedScan {
                    environment: "native".into(),
                    signature: String::new(),
                    scan,
                })
                .collect(),
        )
    }
    pub fn catalog_sources(
        &self,
        remembered: &[(Provider, Vec<ClaudeSession>)],
        enabled: Enabled,
        configs: Vec<SourceConfig>,
        scans: Vec<ScopedScan>,
    ) -> Snapshot {
        let pins = self.pins();
        let mut sources = self.sources.lock().unwrap();
        sources.retain(|(provider, environment), cache| {
            enabled.get(*provider)
                && configs.iter().any(|config| {
                    config.provider == *provider
                        && config.environment == *environment
                        && config.enabled
                        && config.signature == cache.signature
                })
        });
        for scoped in scans {
            let scan = scoped.scan;
            if !enabled.get(scan.provider)
                || !configs.iter().any(|config| {
                    config.provider == scan.provider
                        && config.environment == scoped.environment
                        && config.enabled
                        && config.signature == scoped.signature
                })
            {
                continue;
            }
            let truncated = scan.sessions.len() > 2000;
            let sessions = scan.sessions.into_iter().take(2000).collect();
            sources.insert(
                (scan.provider, scoped.environment.clone()),
                Cached {
                    signature: scoped.signature,
                    status: SourceStatus {
                        provider: scan.provider,
                        environment: scoped.environment,
                        home: scan.home,
                        observed_at: Some(repo_state::now()),
                        errors: scan
                            .errors
                            .into_iter()
                            .take(10)
                            .map(|e| limit(&e, 2000))
                            .collect(),
                        truncated,
                        enabled: true,
                    },
                    sessions,
                },
            );
        }
        let mut rows: HashMap<String, Entry> = HashMap::new();
        for (provider, sessions) in remembered.iter().filter(|(p, _)| enabled.get(*p)) {
            for session in sessions.iter().take(200) {
                if !crate::codex::valid_id(&session.id) {
                    continue;
                }
                let identity = Identity {
                    provider: *provider,
                    environment: session_environment(session),
                    id: session.id.to_ascii_lowercase(),
                };
                let mut row = empty(identity);
                row.cwd = session.cwd.as_deref().map(|s| limit(s, 4096));
                row.title = session.title.as_deref().map(|s| limit(s, 256));
                row.profile_id = Some(session.profile_id.clone());
                row.seen_at = Some(session.seen_at);
                row.remembered = true;
                rows.entry(row.key.clone()).or_insert(row);
            }
        }
        let mut observed = HashSet::new();
        for ((provider, source_environment), cache) in sources.iter() {
            for summary in &cache.sessions {
                if !crate::codex::valid_id(&summary.id) {
                    continue;
                }
                let identity = Identity {
                    provider: *provider,
                    environment: if source_environment == "native" {
                        environment("", summary.cwd.as_deref())
                    } else {
                        source_environment.clone()
                    },
                    id: summary.id.to_ascii_lowercase(),
                };
                let key = identity.key();
                if !observed.insert(key.clone()) {
                    continue;
                }
                let row = rows.entry(key).or_insert_with(|| empty(identity));
                row.cwd = summary
                    .cwd
                    .as_deref()
                    .map(|s| limit(s, 4096))
                    .or(row.cwd.take());
                row.title = summary
                    .title
                    .as_deref()
                    .map(|s| limit(s, 256))
                    .or(row.title.take());
                row.branch = summary.git_branch.as_deref().map(|s| limit(s, 256));
                row.last_prompt = summary.last_prompt.as_deref().map(|s| limit(s, 2000));
                row.modified = Some(summary.modified);
                row.observed_at = cache.status.observed_at;
                row.source_config = Some(cache.signature.clone());
                row.source_home = cache.status.home.clone();
                row.source_version = Some(format!(
                    "{:x}",
                    Sha256::digest(format!(
                        "{}\0{}",
                        cache.signature,
                        cache.status.home.as_deref().unwrap_or("")
                    ))
                ));
                row.available = row.identity.environment == "native"
                    || (source_environment.starts_with("wsl:")
                        && row.cwd.as_ref().is_some_and(|cwd| {
                            cwd.starts_with('/')
                                && cwd.len() <= 4096
                                && !cwd.chars().any(char::is_control)
                        }));
                row.availability = if row.available {
                    "verified"
                } else {
                    "unverified"
                }
                .into();
                row.reason = (!row.available).then(||"The transcript does not report a supported absolute folder for its environment".into());
            }
        }
        for row in rows.values_mut() {
            if row.observed_at.is_none()
                && let Some(cache) =
                    sources.get(&(row.identity.provider, row.identity.environment.clone()))
            {
                row.observed_at = cache.status.observed_at;
                if cache.status.errors.is_empty() && !cache.status.truncated {
                    row.availability = "unavailable".into();
                    row.reason = Some("Session not found in the latest source scan".into());
                } else {
                    row.reason = Some("Source scan incomplete; availability is unknown".into());
                }
            }
            if row.identity.environment.starts_with("wsl:")
                && !configs.iter().any(|config| {
                    config.provider == row.identity.provider
                        && config.environment == row.identity.environment
                        && config.enabled
                })
            {
                row.available = false;
                row.availability = "disabled".into();
                row.reason = Some("WSL source is disabled or no longer configured".into());
            }
        }
        for pin in &pins.pins {
            let row = rows
                .entry(pin.identity.key())
                .or_insert_with(|| empty(pin.identity.clone()));
            row.pinned = true;
            if !enabled.get(pin.identity.provider) {
                row.availability = "disabled".into();
                row.reason = Some(
                    "Session history is disabled for this provider; no source was read".into(),
                );
            } else if row.cwd.is_none() && row.observed_at.is_none() {
                row.availability = "unavailable".into();
                row.reason =
                    Some("Pinned reference has no current remembered or discovered session".into());
            }
        }
        let mut projects = HashMap::new();
        for row in rows.values_mut() {
            row.project = row.cwd.as_ref().map(|cwd| {
                if row.identity.environment != "native" {
                    return cwd.clone();
                }
                projects
                    .entry(cwd.clone())
                    .or_insert_with(|| project_folder(cwd))
                    .clone()
            });
        }
        let mut entries: Vec<_> = rows.into_values().collect();
        entries.sort_by(|a, b| {
            b.pinned
                .cmp(&a.pinned)
                .then_with(|| {
                    b.modified
                        .or(b.seen_at)
                        .unwrap_or(0)
                        .cmp(&a.modified.or(a.seen_at).unwrap_or(0))
                })
                .then_with(|| a.key.cmp(&b.key))
        });
        let truncated = entries.len() > 4000;
        entries.truncate(4000);
        let statuses = configs
            .into_iter()
            .map(|config| {
                sources
                    .get(&(config.provider, config.environment.clone()))
                    .map(|s| s.status.clone())
                    .unwrap_or(SourceStatus {
                        provider: config.provider,
                        environment: config.environment,
                        home: config.home,
                        observed_at: None,
                        errors: vec![],
                        truncated: false,
                        enabled: config.enabled && enabled.get(config.provider),
                    })
            })
            .collect();
        Snapshot {
            source_revision: String::new(),
            entries,
            sources: statuses,
            pins,
            truncated,
        }
    }
    pub fn retain_sources(&self, enabled: Enabled, configs: &[SourceConfig]) {
        self.sources
            .lock()
            .unwrap()
            .retain(|(provider, environment), cache| {
                enabled.get(*provider)
                    && configs.iter().any(|config| {
                        config.provider == *provider
                            && config.environment == *environment
                            && config.enabled
                            && config.signature == cache.signature
                    })
            });
    }
}
fn empty(identity: Identity) -> Entry {
    Entry {
        source_home: None,
        source_version: None,
        source_config: None,
        launch_cwd: None,
        key: identity.key(),
        identity,
        cwd: None,
        project: None,
        title: None,
        branch: None,
        last_prompt: None,
        modified: None,
        seen_at: None,
        profile_id: None,
        remembered: false,
        pinned: false,
        available: false,
        availability: "unverified".into(),
        reason: Some("Refresh sources to verify session availability".into()),
        observed_at: None,
    }
}
fn limit(text: &str, n: usize) -> String {
    text.chars().take(n).collect()
}
fn project_folder(cwd: &str) -> String {
    // An unrefreshed catalog must not start a distro for project grouping.
    let normalized = cwd.replace('\\', "/").to_lowercase();
    if [
        "//wsl.localhost/",
        "//wsl$/",
        "//?/unc/wsl.localhost/",
        "//?/unc/wsl$/",
    ]
    .iter()
    .any(|prefix| normalized.starts_with(prefix))
    {
        return cwd.into();
    }
    let Ok(folder) = repo_state::native_folder(cwd) else {
        return cwd.into();
    };
    let project = folder
        .ancestors()
        .find(|p| p.join(".git").exists())
        .unwrap_or(&folder);
    repo_state::display(project)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::repo_state::tests::Repo;
    const ID: &str = "01a1690c-c7b7-7e80-9864-e6971b91db16";
    const ENABLED: Enabled = Enabled {
        claude: true,
        codex: true,
    };
    fn identity(provider: Provider, environment: &str) -> Identity {
        Identity {
            provider,
            environment: environment.into(),
            id: ID.into(),
        }
    }
    fn remembered(profile: &str, cwd: &str) -> ClaudeSession {
        ClaudeSession {
            environment: None,
            id: ID.into(),
            profile_id: profile.into(),
            cwd: Some(cwd.into()),
            title: Some("Remembered title".into()),
            seen_at: 1,
        }
    }
    #[test]
    fn scoped_forgetting_keeps_colliding_environments_and_legacy_ids_are_native_only() {
        let repo = Repo::new();
        let rows: Vec<_> = ["native", "wsl:alpha", "wsl:beta"]
            .into_iter()
            .map(|environment| ClaudeSession {
                environment: Some(environment.into()),
                ..remembered("custom:scope", "/work")
            })
            .collect();
        for file in ["claude-sessions.json", "codex-sessions.json"] {
            fs::write(repo.dir.join(file), serde_json::to_vec(&rows).unwrap()).unwrap();
        }
        let claude = claude::ClaudeStore::load(&repo.dir, None);
        let codex = crate::codex::Store::load(&repo.dir);
        let selected = Reference {
            id: ID.into(),
            environment: "wsl:alpha".into(),
        };
        for remaining in [
            claude
                .forget_scoped(std::slice::from_ref(&selected))
                .unwrap(),
            codex.forget_scoped(&[selected]).unwrap(),
        ] {
            assert_eq!(
                remaining
                    .iter()
                    .map(session_environment)
                    .collect::<Vec<_>>(),
                ["native", "wsl:beta"]
            );
        }
        for remaining in [
            claude.forget(&[ID.into()]).unwrap(),
            codex.forget(&[ID.into()]).unwrap(),
        ] {
            assert_eq!(remaining.len(), 1);
            assert_eq!(session_environment(&remaining[0]), "wsl:beta");
        }
        assert_eq!(
            claude::ClaudeStore::load(&repo.dir, None).list(),
            claude.list()
        );
        assert_eq!(crate::codex::Store::load(&repo.dir).list(), codex.list());
    }
    #[test]
    fn failed_scoped_forget_preserves_both_provider_stores_in_memory() {
        let repo = Repo::new();
        let rows = vec![ClaudeSession {
            environment: Some("native".into()),
            ..remembered("pwsh", "C:/fixture")
        }];
        for file in ["claude-sessions.json", "codex-sessions.json"] {
            fs::write(repo.dir.join(file), serde_json::to_vec(&rows).unwrap()).unwrap();
        }
        let claude = claude::ClaudeStore::load(&repo.dir, None);
        let codex = crate::codex::Store::load(&repo.dir);
        for file in ["claude-sessions.json", "codex-sessions.json"] {
            let path = repo.dir.join(file);
            fs::remove_file(&path).unwrap();
            fs::create_dir(&path).unwrap();
        }
        let selected = Reference {
            id: ID.into(),
            environment: "native".into(),
        };
        assert!(
            claude
                .forget_scoped(std::slice::from_ref(&selected))
                .is_err()
        );
        assert!(codex.forget_scoped(&[selected]).is_err());
        assert_eq!(claude.list(), rows);
        assert_eq!(codex.list(), rows);
    }
    fn scan(provider: Provider, cwd: &str) -> Scan {
        Scan {
            provider,
            home: Some("native test home".into()),
            errors: vec![],
            sessions: vec![TranscriptSummary {
                id: ID.into(),
                cwd: Some(cwd.into()),
                title: Some("Discovered title".into()),
                git_branch: Some("historical-branch".into()),
                prompts: 2,
                last_prompt: Some("private prompt excerpt".into()),
                modified: 2,
            }],
        }
    }
    #[test]
    fn identities_keep_providers_and_distributions_separate_and_never_infer_a_distro_from_a_posix_path()
     {
        let native = identity(Provider::Claude, "native");
        native.validate().unwrap();
        assert_ne!(native.key(), identity(Provider::Codex, "native").key());
        assert_ne!(
            identity(Provider::Codex, "wsl:alpha").key(),
            identity(Provider::Codex, "wsl:beta").key()
        );
        assert_eq!(environment("wsl:Ubuntu", Some("/work")), "wsl:ubuntu");
        assert_eq!(environment("custom:Bash", Some("/work")), "unknown");
        assert_eq!(environment("custom:Bash", Some(r"C:\work")), "native");
        let mut invalid = native.clone();
        invalid.id = "../../foreign".into();
        assert!(invalid.validate().is_err());
        invalid = native;
        invalid.environment = "wsl:".into();
        assert!(invalid.validate().is_err());
    }

    #[test]
    fn scoped_caches_keep_colliding_uuids_separate_and_discard_disabled_changed_or_obsolete_sources()
     {
        let repo = crate::repo_state::tests::Repo::new();
        let store = Store::load(repo.dir.join("pins.json"));
        let enabled = Enabled {
            claude: true,
            codex: true,
        };
        let mut configs = native_sources();
        for environment in ["wsl:alpha", "wsl:beta"] {
            configs.push(SourceConfig {
                provider: Provider::Codex,
                environment: environment.into(),
                signature: "first".into(),
                home: Some("/isolated/codex".into()),
                enabled: true,
            });
        }
        let scoped = |environment: &str, signature: &str| ScopedScan {
            environment: environment.into(),
            signature: signature.into(),
            scan: scan(Provider::Codex, "/c/Case"),
        };
        let catalog = store.catalog_sources(
            &[],
            enabled,
            configs.clone(),
            vec![
                ScopedScan {
                    environment: "native".into(),
                    signature: String::new(),
                    scan: scan(Provider::Codex, r"C:\native"),
                },
                scoped("wsl:alpha", "first"),
                scoped("wsl:beta", "first"),
            ],
        );
        assert_eq!(catalog.entries.len(), 3);
        assert!(
            catalog
                .entries
                .iter()
                .any(|entry| entry.identity.environment == "wsl:alpha"
                    && entry.cwd.as_deref() == Some("/c/Case"))
        );
        store
            .pin(identity(Provider::Codex, "wsl:alpha"), true)
            .unwrap();
        configs[2].signature = "changed-home".into();
        let changed = store.catalog_sources(
            &[],
            enabled,
            configs.clone(),
            vec![scoped("wsl:alpha", "first")],
        );
        let alpha = changed
            .entries
            .iter()
            .find(|entry| entry.identity.environment == "wsl:alpha")
            .unwrap();
        assert!(alpha.pinned && alpha.last_prompt.is_none() && alpha.cwd.is_none());
        assert!(
            changed.entries.iter().any(
                |entry| entry.identity.environment == "wsl:beta" && entry.last_prompt.is_some()
            )
        );
        configs[3].enabled = false;
        let disabled = store.catalog_sources(&[], enabled, configs, vec![]);
        assert!(
            !disabled
                .entries
                .iter()
                .any(|entry| entry.identity.environment == "wsl:beta")
        );
        let off = store.catalog_sources(
            &[],
            Enabled {
                claude: false,
                codex: false,
            },
            native_sources(),
            vec![],
        );
        assert_eq!(off.entries.len(), 1);
        assert!(off.entries[0].last_prompt.is_none());
        assert!(store.sources.lock().unwrap().is_empty());
    }
    #[test]
    fn discovery_is_explicit_and_reported_branches_and_native_data_never_cross_environment_identity()
     {
        let repo = Repo::new();
        let cwd = repo_state::display(&repo.dir);
        let store = Store::load(repo.dir.join("pins.json"));
        let remembered = vec![
            (
                Provider::Claude,
                vec![
                    remembered("powershell", &cwd),
                    remembered("wsl:Alpha", "/work"),
                    remembered("wsl:Beta", "/work"),
                ],
            ),
            (Provider::Codex, vec![remembered("powershell", &cwd)]),
        ];
        let initial = store.catalog(&remembered, ENABLED, vec![]);
        assert_eq!(initial.entries.len(), 4);
        assert!(
            initial
                .entries
                .iter()
                .all(|e| !e.available && e.branch.is_none() && e.last_prompt.is_none())
        );
        assert!(initial.sources.iter().all(|s| s.observed_at.is_none()));
        let discovered = store.catalog(
            &remembered,
            ENABLED,
            vec![scan(Provider::Claude, &cwd), scan(Provider::Codex, &cwd)],
        );
        assert_eq!(discovered.entries.len(), 4);
        for entry in &discovered.entries {
            if entry.identity.environment == "native" {
                assert!(entry.available);
                assert_eq!(entry.branch.as_deref(), Some("historical-branch"));
                assert_eq!(entry.project.as_deref(), Some(cwd.as_str()));
            } else {
                assert!(!entry.available);
                assert!(entry.branch.is_none());
                assert!(entry.last_prompt.is_none());
            }
        }
        let missing = store.catalog(
            &remembered,
            ENABLED,
            vec![Scan {
                provider: Provider::Claude,
                home: None,
                sessions: vec![],
                errors: vec![],
            }],
        );
        assert_eq!(
            missing
                .entries
                .iter()
                .find(|e| e.identity == identity(Provider::Claude, "native"))
                .unwrap()
                .availability,
            "unavailable"
        );
    }
    #[test]
    fn disabling_history_erases_cached_source_fields_and_pins_store_only_identity() {
        let repo = Repo::new();
        let store = Store::load(repo.dir.join("pins.json"));
        let cwd = repo_state::display(&repo.dir);
        store
            .pin(identity(Provider::Claude, "native"), true)
            .unwrap();
        store.catalog(&[], ENABLED, vec![scan(Provider::Claude, &cwd)]);
        let disabled = store.catalog(
            &[],
            Enabled {
                claude: false,
                codex: false,
            },
            vec![],
        );
        assert_eq!(disabled.entries.len(), 1);
        assert_eq!(disabled.entries[0].availability, "disabled");
        assert!(!disabled.entries[0].available);
        assert!(disabled.entries[0].cwd.is_none());
        let json = serde_json::to_string(&disabled).unwrap();
        assert!(!json.contains("private prompt excerpt"));
        assert!(!json.contains("historical-branch"));
        let saved = fs::read_to_string(repo.dir.join("pins.json")).unwrap();
        assert!(!saved.contains("title"));
        assert!(!saved.contains("cwd"));
        assert!(!saved.contains("private prompt"));
        let reenabled = store.catalog(&[], ENABLED, vec![]);
        assert!(!reenabled.entries[0].available);
        assert!(reenabled.sources.iter().all(|s| s.observed_at.is_none()));
    }
    #[test]
    fn pins_retry_unchanged_failed_writes_and_recovery_preserves_the_unreadable_original() {
        let repo = Repo::new();
        let path = repo.dir.join("pins.json");
        fs::create_dir(&path).unwrap();
        let store = Store::load(path.clone());
        assert!(store.pins().recovery_required);
        fs::remove_dir(&path).unwrap();
        store.pins_action("retry").unwrap();
        fs::create_dir(&path).unwrap();
        let failed = store
            .pin(identity(Provider::Codex, "native"), true)
            .unwrap();
        assert!(failed.error.is_some());
        assert_eq!(failed.pins.len(), 1);
        fs::remove_dir(&path).unwrap();
        assert!(store.pins().error.is_none());
        assert_eq!(Store::load(path.clone()).pins().pins.len(), 1);
        fs::write(&path, "unreadable original").unwrap();
        let broken = Store::load(path.clone());
        assert!(
            broken
                .pin(identity(Provider::Claude, "native"), true)
                .is_err()
        );
        assert_eq!(fs::read_to_string(&path).unwrap(), "unreadable original");
        let recovered = broken.pins_action("recover").unwrap();
        assert!(!recovered.recovery_required);
        assert_eq!(
            fs::read_to_string(recovered.backup_path.unwrap()).unwrap(),
            "unreadable original"
        );
        assert!(recovered.pins.is_empty());
    }
    #[test]
    fn remembered_wsl_sessions_with_the_same_id_are_not_overwritten_by_another_distribution() {
        let repo = Repo::new();
        let claude = crate::claude::ClaudeStore::load(&repo.dir, None);
        let codex = crate::codex::Store::load(&repo.dir);
        let index = crate::codex::Index::default();
        for profile in ["wsl:Alpha", "wsl:Beta"] {
            claude.remember(ID, profile, Some("/work".into())).unwrap();
            codex
                .remember(&index, ID, profile, Some("/work".into()))
                .unwrap();
        }
        assert_eq!(claude.list().len(), 2);
        assert_eq!(codex.list().len(), 2);
        assert_eq!(
            crate::claude::ClaudeStore::load(&repo.dir, None)
                .list()
                .len(),
            2
        );
        assert_eq!(crate::codex::Store::load(&repo.dir).list().len(), 2);
    }
}
