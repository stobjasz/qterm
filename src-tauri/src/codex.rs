//! Codex CLI rollouts. This adapter deliberately tolerates unknown records: the
//! on-disk transcript is not a stable API. Never infer billing from token counts.
use crate::claude::{ClaudeSession, TranscriptSummary};
use serde::Serialize;
use serde_json::Value;
use std::{
    collections::HashMap,
    io::{BufRead, BufReader},
    path::{Path, PathBuf},
    sync::Mutex,
    time::UNIX_EPOCH,
};

pub fn home() -> Option<PathBuf> {
    std::env::var_os("CODEX_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("USERPROFILE").map(|p| PathBuf::from(p).join(".codex")))
}

pub fn valid_id(id: &str) -> bool {
    id.split('-')
        .zip([8, 4, 4, 4, 12])
        .filter(|(s, n)| s.len() == *n && s.bytes().all(|b| b.is_ascii_hexdigit()))
        .count()
        == 5
        && id.len() == 36
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Usage {
    pub session_id: String,
    pub model: Option<String>,
    pub context_tokens: u64,
    pub context_limit: Option<u64>,
    pub output_tokens: u64,
    pub title: Option<String>,
    pub rate_limits: Option<Value>,
}

#[derive(Clone)]
struct Rollout {
    summary: TranscriptSummary,
    usage: Usage,
}

fn parse(path: &Path) -> std::io::Result<Option<Rollout>> {
    let file = std::fs::File::open(path)?;
    let mut summary = TranscriptSummary {
        id: String::new(),
        cwd: None,
        title: None,
        git_branch: None,
        prompts: 0,
        last_prompt: None,
        modified: stamp(path).0,
    };
    let mut usage = Usage {
        session_id: String::new(),
        model: None,
        context_tokens: 0,
        context_limit: None,
        output_tokens: 0,
        title: None,
        rate_limits: None,
    };
    // Some Codex versions only persist user turns as response items. Keep a
    // separate summary so versions writing both formats never double-count.
    let mut response_prompts = 0;
    let mut response_title = None;
    let mut response_last_prompt = None;
    for line in BufReader::new(file).lines() {
        let line = line?;
        let Ok(record) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        let p = &record["payload"];
        match record["type"].as_str() {
            Some("session_meta") => {
                let Some(id) = p["id"].as_str() else { continue };
                summary.id = id.to_ascii_lowercase();
                summary.cwd = p["cwd"].as_str().map(str::to_owned);
                summary.git_branch = p
                    .pointer("/git/branch")
                    .and_then(Value::as_str)
                    .map(str::to_owned);
            }
            Some("turn_context") => {
                usage.model = p["model"].as_str().map(str::to_owned).or(usage.model)
            }
            Some("response_item") if p["type"] == "message" && p["role"] == "user" => {
                if let Some(content) = p["content"].as_array() {
                    let text = content.iter()
                        .filter(|part| part["type"] == "input_text")
                        .filter_map(|part| part["text"].as_str())
                        .filter(|text| {
                            let text = text.trim_start();
                            !text.starts_with("<environment_context>")
                                && !text.starts_with("# AGENTS.md instructions")
                                && !text.starts_with("<INSTRUCTIONS>")
                        })
                        .collect::<Vec<_>>().join("\n");
                    if !text.trim().is_empty() {
                        response_prompts += 1;
                        response_title.get_or_insert_with(|| crate::claude::shorten(text.trim(), 80));
                        response_last_prompt = Some(crate::claude::shorten(text.trim(), 160));
                    }
                }
            }
            Some("event_msg") if p["type"] == "user_message" => {
                if let Some(text) = p["message"].as_str().filter(|t| !t.trim().is_empty()) {
                    summary.prompts += 1;
                    let title = crate::claude::shorten(text.trim(), 80);
                    summary.title.get_or_insert(title);
                    summary.last_prompt = Some(crate::claude::shorten(text.trim(), 160));
                }
            }
            Some("event_msg") if p["type"] == "token_count" => {
                if let Some(n) = p
                    .pointer("/info/last_token_usage/total_tokens")
                    .and_then(Value::as_u64)
                {
                    usage.context_tokens = n;
                }
                if let Some(n) = p
                    .pointer("/info/model_context_window")
                    .and_then(Value::as_u64)
                {
                    usage.context_limit = Some(n);
                }
                if let Some(n) = p
                    .pointer("/info/total_token_usage/output_tokens")
                    .and_then(Value::as_u64)
                {
                    usage.output_tokens = n;
                }
                if p["rate_limits"].is_object() {
                    usage.rate_limits = Some(p["rate_limits"].clone());
                }
            }
            _ => {}
        }
    }
    if summary.prompts == 0 {
        summary.prompts = response_prompts;
        summary.title = response_title;
        summary.last_prompt = response_last_prompt;
    }
    if !valid_id(&summary.id) {
        return Ok(None);
    }
    usage.session_id = summary.id.clone();
    usage.title = summary.title.clone();
    Ok(Some(Rollout { summary, usage }))
}

fn stamp(path: &Path) -> (u64, u64) {
    let Ok(m) = path.metadata() else {
        return (0, 0);
    };
    (
        m.modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|t| t.as_millis() as u64)
            .unwrap_or(0),
        m.len(),
    )
}

type CachedRollout = ((u64, u64), Option<Rollout>);

#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanDiagnostics {
    pub files_scanned: usize,
    pub unrecognized_files: usize,
    pub missing_sessions_folder: bool,
    pub errors: Vec<String>,
}

impl ScanDiagnostics {
    fn error(&mut self, path: &Path, error: &std::io::Error) {
        // A broken history tree must not produce an unbounded IPC response.
        if self.errors.len() < 10 {
            self.errors.push(format!("{}: {error}", path.display()));
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanResult {
    pub home: String,
    pub sessions_path: String,
    pub sessions: Vec<TranscriptSummary>,
    pub diagnostics: ScanDiagnostics,
}

#[derive(Default)]
pub struct Index {
    cache: Mutex<HashMap<PathBuf, CachedRollout>>,
}
impl Index {
    fn rollouts(&self, home: &Path) -> (Vec<Rollout>, ScanDiagnostics) {
        let root = home.join("sessions");
        let mut pending = vec![root.clone()];
        let mut diagnostics = ScanDiagnostics::default();
        let mut cache = self.cache.lock().unwrap();
        let mut found = Vec::new();
        let mut live = std::collections::HashSet::new();
        while let Some(dir) = pending.pop() {
            let entries = match std::fs::read_dir(&dir) {
                Ok(entries) => entries,
                Err(error) => {
                    if dir == root && error.kind() == std::io::ErrorKind::NotFound {
                        diagnostics.missing_sessions_folder = true;
                    } else {
                        diagnostics.error(&dir, &error);
                    }
                    continue;
                }
            };
            for entry in entries {
                let entry = match entry {
                    Ok(entry) => entry,
                    Err(error) => { diagnostics.error(&dir, &error); continue; }
                };
                let path = entry.path();
                let kind = match entry.file_type() {
                    Ok(kind) => kind,
                    Err(error) => { diagnostics.error(&path, &error); continue; }
                };
                if kind.is_dir() {
                    pending.push(path);
                    continue;
                }
                if !kind.is_file() || path.extension().is_none_or(|e| e != "jsonl") {
                    continue;
                }
                diagnostics.files_scanned += 1;
                live.insert(path.clone());
                let stamp = stamp(&path);
                if cache.get(&path).is_none_or(|(old, _)| *old != stamp) {
                    cache.remove(&path);
                    match parse(&path) {
                        Ok(rollout) => { cache.insert(path.clone(), (stamp, rollout)); }
                        Err(error) => diagnostics.error(&path, &error),
                    }
                }
                if let Some((_, Some(rollout))) = cache.get(&path) {
                    found.push(rollout.clone());
                } else if matches!(cache.get(&path), Some((_, None))) {
                    diagnostics.unrecognized_files += 1;
                }
            }
        }
        cache.retain(|p, _| live.contains(p));
        found.sort_by_key(|r| std::cmp::Reverse(r.summary.modified));
        (found, diagnostics)
    }
    pub fn scan(&self, home: &Path) -> Vec<TranscriptSummary> {
        self.scan_with_diagnostics(home).sessions
    }
    pub fn scan_with_diagnostics(&self, home: &Path) -> ScanResult {
        let (rollouts, diagnostics) = self.rollouts(home);
        ScanResult {
            home: home.to_string_lossy().into_owned(),
            sessions_path: home.join("sessions").to_string_lossy().into_owned(),
            sessions: rollouts.into_iter().filter(|r| r.summary.prompts > 0).map(|r| r.summary).collect(),
            diagnostics,
        }
    }
    pub fn usage_many(&self, home: &Path, ids: &[String]) -> Vec<Usage> {
        let wanted: std::collections::HashSet<_> = ids.iter().map(|id| id.to_ascii_lowercase()).collect();
        if wanted.is_empty() { return Vec::new(); }
        self.rollouts(home).0.into_iter()
            .filter(|r| wanted.contains(&r.summary.id))
            .map(|r| r.usage).collect()
    }
    pub fn usage(&self, home: &Path, id: &str) -> Option<Usage> {
        self.rollouts(home).0
            .into_iter()
            .find(|r| r.summary.id.eq_ignore_ascii_case(id))
            .map(|r| r.usage)
    }
}

pub struct Store {
    path: PathBuf,
    sessions: Mutex<Vec<ClaudeSession>>,
}
impl Store {
    pub fn load(dir: &Path) -> Self {
        let path = dir.join("codex-sessions.json");
        let sessions = std::fs::read_to_string(&path)
            .ok()
            .and_then(|s| serde_json::from_str::<Vec<ClaudeSession>>(&s).ok())
            .unwrap_or_default()
            .into_iter()
            .filter(|s| valid_id(&s.id))
            .take(200)
            .collect();
        Self {
            path,
            sessions: Mutex::new(sessions),
        }
    }
    pub fn list(&self) -> Vec<ClaudeSession> {
        self.sessions.lock().unwrap().clone()
    }
    #[cfg(test)]
    pub fn remember(&self,index:&Index,id:&str,profile:&str,cwd:Option<String>)->Result<Vec<ClaudeSession>,String>{self.remember_scoped(index,id,profile,cwd,None)}
    pub fn remember_scoped(
        &self,
        index: &Index,
        id: &str,
        profile: &str,
        cwd: Option<String>,
        environment:Option<String>,
    ) -> Result<Vec<ClaudeSession>, String> {
        if !valid_id(id) {
            return Err("invalid Codex session id".into());
        }
        let environment=crate::session_library::sighting_environment(profile,cwd.as_deref(),environment)?;
        let summary = (environment=="native").then(home).flatten().and_then(|h| {
            index
                .scan(&h)
                .into_iter()
                .find(|s| s.id.eq_ignore_ascii_case(id))
        });
        let session = ClaudeSession {
            environment:Some(environment.clone()),
            id: id.to_ascii_lowercase(),
            profile_id: profile.into(),
            cwd: summary.as_ref().and_then(|s| s.cwd.clone()).or(cwd),
            title: summary.and_then(|s| s.title),
            seen_at: std::time::SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as u64,
        };
        let mut sessions = self.sessions.lock().unwrap();
        let mut next = sessions.clone();
        next.retain(|s| s.id != session.id || crate::session_library::session_environment(s)!=environment);
        next.insert(0, session);
        next.truncate(200);
        self.save(&next)?;
        *sessions = next;
        Ok(sessions.clone())
    }
    pub fn forget(&self, ids: &[String]) -> Result<Vec<ClaudeSession>, String> {
        self.forget_scoped(&ids.iter().map(|id|crate::session_library::Reference{id:id.to_ascii_lowercase(),environment:"native".into()}).collect::<Vec<_>>())
    }
    pub fn forget_scoped(&self,references:&[crate::session_library::Reference])->Result<Vec<ClaudeSession>,String>{
        for reference in references{reference.validate()?;}
        let mut sessions = self.sessions.lock().unwrap();
        let next: Vec<_> = sessions
            .iter()
            .filter(|s| !references.iter().any(|reference|reference.matches(s)))
            .cloned()
            .collect();
        self.save(&next)?;
        *sessions = next;
        Ok(sessions.clone())
    }
    fn save(&self, sessions: &[ClaudeSession]) -> Result<(), String> {
        crate::claude::write_atomically(
            &self.path,
            &serde_json::to_string_pretty(sessions).map_err(|e| e.to_string())?,
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn response_item_history_is_visible_without_counting_context_or_duplicate_events() {
        let dir = std::env::temp_dir().join(format!("qterm-codex-response-{}", std::process::id()));
        std::fs::create_dir_all(dir.join("sessions")).unwrap();
        let path = dir.join("sessions/rollout.jsonl");
        let records = concat!(
            "{\"type\":\"session_meta\",\"payload\":{\"id\":\"01a1690c-c7b7-7e80-9864-e6971b91db16\",\"cwd\":\"C:/work\"}}\n",
            "{\"type\":\"response_item\",\"payload\":{\"type\":\"message\",\"role\":\"user\",\"content\":[{\"type\":\"input_text\",\"text\":\"<environment_context>context</environment_context>\"}]}}\n",
            "{\"type\":\"response_item\",\"payload\":{\"type\":\"message\",\"role\":\"user\",\"content\":[{\"type\":\"input_text\",\"text\":\"# AGENTS.md instructions for C:/work\"}]}}\n",
            "{\"type\":\"response_item\",\"payload\":{\"type\":\"message\",\"role\":\"assistant\",\"content\":[{\"type\":\"output_text\",\"text\":\"Assistant reply\"}]}}\n",
            "{\"type\":\"response_item\",\"payload\":{\"type\":\"message\",\"role\":\"user\",\"content\":[{\"type\":\"input_text\",\"text\":\"Fix login\"},{\"type\":\"input_text\",\"text\":\"Keep tests\"}]}}\n",
            "{\"type\":\"response_item\",\"payload\":{\"type\":\"message\",\"role\":\"user\",\"content\":[{\"type\":\"input_text\",\"text\":\"Now test it\"}]}}\n",
            "malformed tail\n"
        );
        std::fs::write(&path, records).unwrap();
        let index = Index::default();
        let all = index.scan(&dir);
        assert_eq!(all.len(), 1, "response-only sessions must appear in All on this PC");
        assert_eq!(all[0].prompts, 2);
        assert_eq!(all[0].title.as_deref(), Some("Fix login"));
        assert_eq!(all[0].last_prompt.as_deref(), Some("Now test it"));
        // Older versions can emit both representations of a turn.
        std::fs::write(&path, format!("{records}{}", concat!(
            "{\"type\":\"event_msg\",\"payload\":{\"type\":\"user_message\",\"message\":\"Fix login\"}}\n",
            "{\"type\":\"event_msg\",\"payload\":{\"type\":\"user_message\",\"message\":\"Now test it\"}}\n"
        ))).unwrap();
        assert_eq!(index.scan(&dir)[0].prompts, 2, "do not count a prompt twice");
        std::fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn reads_rollouts_and_keeps_usage_when_rate_limit_only_records_arrive() {
        let dir = std::env::temp_dir().join(format!("qterm-codex-{}", std::process::id()));
        std::fs::create_dir_all(dir.join("sessions/2026/10/23")).unwrap();
        let path = dir.join("sessions/2026/10/23/rollout.jsonl");
        std::fs::write(&path, concat!(
            "{\"type\":\"session_meta\",\"payload\":{\"id\":\"01a1690c-c7b7-7e80-9864-e6971b91db16\",\"cwd\":\"C:/work\"}}\n",
            "{\"type\":\"event_msg\",\"payload\":{\"type\":\"user_message\",\"message\":\"Fix login\"}}\n",
            "{\"type\":\"turn_context\",\"payload\":{\"model\":\"example-model\"}}\n",
            "{\"type\":\"event_msg\",\"payload\":{\"type\":\"token_count\",\"info\":{\"last_token_usage\":{\"total_tokens\":123},\"model_context_window\":1000,\"total_token_usage\":{\"output_tokens\":42}}}}\n",
            "{\"type\":\"event_msg\",\"payload\":{\"type\":\"token_count\",\"info\":null,\"rate_limits\":{\"primary\":{\"used_percent\":81}}}}\n",
            "malformed tail\n")).unwrap();
        let index = Index::default();
        assert_eq!(index.scan(&dir)[0].title.as_deref(), Some("Fix login"));
        let usage = index
            .usage(&dir, "01a1690c-c7b7-7e80-9864-e6971b91db16")
            .unwrap();
        assert_eq!(usage.context_tokens, 123);
        assert_eq!(usage.output_tokens, 42);
        assert_eq!(usage.rate_limits.unwrap()["primary"]["used_percent"], 81);
        std::fs::remove_file(&path).unwrap();
        assert!(index.scan(&dir).is_empty());
        std::fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn ids_cannot_be_shell_commands_or_paths() {
        assert!(valid_id("01a1690c-c7b7-7e80-9864-e6971b91db16"));
        for id in [
            "../bad",
            "x;calc",
            "01a1690c-c7b7-7e80-9864-e6971b91db16-",
            "--last",
        ] {
            assert!(!valid_id(id));
        }
    }

    #[test]
    fn scan_distinguishes_missing_empty_unrecognized_and_unreadable_data() {
        let home = std::env::temp_dir().join(format!("qterm-codex-diagnostics-{}", std::process::id()));
        let index = Index::default();
        let missing = index.scan_with_diagnostics(&home);
        assert!(missing.diagnostics.missing_sessions_folder);
        assert!(missing.diagnostics.errors.is_empty());
        std::fs::create_dir_all(home.join("sessions")).unwrap();
        let empty = index.scan_with_diagnostics(&home);
        assert!(!empty.diagnostics.missing_sessions_folder);
        assert_eq!(empty.diagnostics.files_scanned, 0);
        std::fs::write(home.join("sessions/unknown.jsonl"), "{\"type\":\"future_format\"}\n").unwrap();
        // Invalid UTF-8 produces an actual read error, not a JSON parse warning.
        std::fs::write(home.join("sessions/unreadable.jsonl"), [0xff]).unwrap();
        let partial = index.scan_with_diagnostics(&home);
        assert_eq!(partial.diagnostics.files_scanned, 2);
        assert_eq!(partial.diagnostics.unrecognized_files, 1);
        assert_eq!(partial.diagnostics.errors.len(), 1);
        assert!(partial.diagnostics.errors[0].contains("unreadable.jsonl"));
        assert!(partial.sessions.is_empty());
        assert_eq!(partial.home, home.to_string_lossy());
        // A failed file remains retryable even when no successful cache entry exists.
        std::fs::write(home.join("sessions/unreadable.jsonl"), concat!(
            "{\"type\":\"session_meta\",\"payload\":{\"id\":\"01a1690c-c7b7-7e80-9864-e6971b91db16\"}}\n",
            "{\"type\":\"event_msg\",\"payload\":{\"type\":\"user_message\",\"message\":\"Recovered\"}}\n"
        )).unwrap();
        let recovered = index.scan_with_diagnostics(&home);
        assert!(recovered.diagnostics.errors.is_empty());
        assert_eq!(recovered.sessions.len(), 1);
        let ids = vec!["01A1690C-C7B7-7E80-9864-E6971B91DB16".into(), "01a1690c-c7b7-7e80-9864-e6971b91db16".into()];
        let usage = index.usage_many(&home, &ids);
        assert_eq!(usage.len(), 1, "batch requests deduplicate IDs case-insensitively");
        assert_eq!(usage[0].title.as_deref(), Some("Recovered"));
        assert!(index.usage_many(&home, &[]).is_empty());
        std::fs::remove_dir_all(home).unwrap();
    }
}
