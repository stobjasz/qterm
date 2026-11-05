//! Durable command results and evidence for explicitly prepared verification runs.
use crate::repo_state::{self, Coverage as NativeCoverage, Snapshot as Repository};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    fs,
    io::Read,
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering},
    },
};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Run {
    #[serde(default)]
    pub environment: Option<String>,
    pub id: String,
    pub pane_id: String,
    pub profile_id: Option<String>,
    pub shell_kind: Option<String>,
    #[serde(default)]
    pub app_run_id: Option<String>,
    pub cwd: Option<String>,
    pub command: String,
    #[serde(default)]
    pub command_truncated: bool,
    pub exit_code: Option<i64>,
    pub started_at: u64,
    pub finished_at: u64,
    pub output: String,
    pub output_truncated: bool,
    #[serde(default)]
    pub verification: Option<Evidence>,
    #[serde(default)]
    pub requester: Option<crate::agent_tasks::Requester>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::repo_state::tests::{Repo, until};
    fn run(repo: &Repo, at: u64) -> Run {
        Run {
            id: id(),
            pane_id: "pane".into(),
            profile_id: Some("pwsh".into()),
            shell_kind: Some("powershell".into()),
            app_run_id: None,
            environment: None,
            cwd: Some(repo_state::display(&repo.dir)),
            command: "check".into(),
            command_truncated: false,
            exit_code: Some(0),
            started_at: at,
            finished_at: at + 1,
            output: "Passed".into(),
            output_truncated: false,
            verification: None,
            requester: None,
        }
    }
    #[test]
    fn saved_linux_environment_is_retained_and_invalid_context_is_rejected(){
        let repo=Repo::new();let path=repo.dir.join("target/environment.json");let store=Store::load(path.clone());let mut record=run(&repo,1);record.environment=Some("wsl:ubuntu".into());record.cwd=Some("/c/Case".into());let id=record.id.clone();store.append(record.clone(),None).unwrap();assert_eq!(Store::load(path).snapshot().runs[0].environment.as_deref(),Some("wsl:ubuntu"));record.environment=Some("wsl:../wrong".into());record.id=format!("{id}-other");assert!(store.append(record,None).is_err());
    }
    #[test]
    fn persists_records_and_marks_a_prior_check_stale_after_an_edit() {
        let repo = Repo::new();
        let store = Store::load(repo.dir.join("target/history.json"));
        let prepared = store.prepare(&repo.dir.to_string_lossy(), "check").unwrap();
        let snapshot = store
            .append(run(&repo, prepared.before.captured_at), Some(&prepared.id))
            .unwrap();
        assert_eq!(
            snapshot.runs[0].verification.as_ref().unwrap().status,
            Freshness::Matches
        );
        fs::write(repo.dir.join("src/value.txt"), "two").unwrap();
        assert_eq!(
            store.refresh().runs[0]
                .verification
                .as_ref()
                .unwrap()
                .status,
            Freshness::Stale
        );
        let restored = Store::load(store.path.clone());
        assert_eq!(
            restored.snapshot().runs[0]
                .verification
                .as_ref()
                .unwrap()
                .status,
            Freshness::Unknown
        );
        assert_eq!(
            restored.refresh().runs[0]
                .verification
                .as_ref()
                .unwrap()
                .status,
            Freshness::Stale
        );
    }
    #[test]
    fn an_edit_restored_during_a_check_cannot_become_valid_evidence() {
        let repo = Repo::new();
        let store = Store::load(repo.dir.join("target/history.json"));
        let prepared = store.prepare(&repo.dir.to_string_lossy(), "check").unwrap();
        fs::write(repo.dir.join("src/value.txt"), "two").unwrap();
        until(|| {
            store.tickets.lock().unwrap()[&prepared.id]
                .coverage
                .changed()
                .unwrap()
        });
        fs::write(repo.dir.join("src/value.txt"), "one").unwrap();
        let snapshot = store
            .append(run(&repo, prepared.before.captured_at), Some(&prepared.id))
            .unwrap();
        assert!(!snapshot.runs[0].verification.as_ref().unwrap().eligible);
        assert!(
            snapshot.runs[0]
                .verification
                .as_ref()
                .unwrap()
                .changed_during_run
        );
        assert_eq!(
            store.refresh().runs[0]
                .verification
                .as_ref()
                .unwrap()
                .status,
            Freshness::Stale
        );
    }
    #[test]
    fn records_keep_memory_on_failed_write_and_preserve_corrupt_history() {
        let repo = Repo::new();
        let file = repo.dir.join("target/history.json");
        fs::create_dir_all(&file).unwrap();
        let store = Store::load(file.clone());
        let failed = store.append(run(&repo, 1), None).unwrap();
        assert!(failed.error.is_some());
        fs::remove_dir(&file).unwrap();
        assert!(store.act(Action::Retry).unwrap().error.is_none());
        assert_eq!(Store::load(file.clone()).snapshot().runs.len(), 1);
        fs::write(&file, "broken records").unwrap();
        let broken = Store::load(file.clone());
        broken.append(run(&repo, 2), None).unwrap();
        assert_eq!(fs::read_to_string(&file).unwrap(), "broken records");
        let recovered = broken.act(Action::ResetSaved).unwrap();
        assert!(recovered.error.is_none());
        assert_eq!(
            fs::read_to_string(recovered.backup_path.unwrap()).unwrap(),
            "broken records"
        );
        assert_eq!(Store::load(file).snapshot().runs.len(), 1);
    }
    #[test]
    fn mismatched_commands_and_forged_client_evidence_are_not_accepted() {
        let repo = Repo::new();
        let store = Store::load(repo.dir.join("target/history.json"));
        let prepared = store
            .prepare(&repo.dir.to_string_lossy(), "another-command")
            .unwrap();
        let snapshot = store
            .append(run(&repo, prepared.before.captured_at), Some(&prepared.id))
            .unwrap();
        assert!(!snapshot.runs[0].verification.as_ref().unwrap().eligible);
        let mut forged = run(&repo, 1);
        forged.verification = snapshot.runs[0].verification.clone();
        assert!(
            store
                .append(forged, None)
                .unwrap()
                .runs
                .iter()
                .find(|r| r.started_at == 1)
                .unwrap()
                .verification
                .is_none()
        );
    }
    #[test]
    fn retrying_a_saved_run_keeps_its_original_evidence_and_does_not_duplicate_it() {
        let repo = Repo::new();
        let store = Store::load(repo.dir.join("target/history.json"));
        let prepared = store.prepare(&repo.dir.to_string_lossy(), "check").unwrap();
        let first = run(&repo, prepared.before.captured_at);
        store.append(first.clone(), Some(&prepared.id)).unwrap();
        let retried = store.append(first.clone(), Some(&prepared.id)).unwrap();
        assert_eq!(retried.runs.len(), 1);
        assert!(retried.runs[0].verification.as_ref().unwrap().eligible);
        let mut other = first;
        other.command = "different check".into();
        assert!(store.append(other, None).is_err());
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Evidence {
    pub before: Repository,
    pub after: Option<Repository>,
    pub eligible: bool,
    pub changed_during_run: bool,
    pub status: Freshness,
    pub reason: String,
    pub checked_at: u64,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Freshness {
    Matches,
    Stale,
    Unknown,
}
#[derive(Serialize, Deserialize)]
struct Saved {
    version: u32,
    runs: Vec<Run>,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub run_id: String,
    pub revision: u64,
    pub runs: Vec<Run>,
    pub error: Option<String>,
    pub recovery_required: bool,
    pub backup_path: Option<String>,
}
#[derive(Deserialize, Clone, Copy)]
#[serde(rename_all = "camelCase")]
pub enum Action {
    Retry,
    ResetSaved,
    Clear,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Prepared {
    pub id: String,
    pub before: Repository,
    pub launch: Option<VerificationLaunch>,
}
#[derive(Clone, Serialize)]
#[serde(rename_all="camelCase")]
pub struct VerificationLaunch {
    pub profile_id:String, pub profile_key:String, pub environment:String, pub cwd:String,
}
enum Coverage { Native(NativeCoverage), Wsl(Arc<crate::wsl_verification_monitor::Monitor>) }
impl Coverage {
    fn changed(&self)->Result<bool,String>{match self{Self::Native(value)=>value.changed(),Self::Wsl(value)=>value.changed()}}
    fn finish(&self,root:&str)->Result<(Option<Repository>,bool),String>{
        match self{
            Self::Native(_)=>{let after=repo_state::capture(Path::new(root))?;Ok((Some(after),self.changed()?))},
            Self::Wsl(value)=>{let result=value.finish()?;Ok((result.after,result.changed))},
        }
    }
    fn cancel(&self){if let Self::Wsl(value)=self{value.cancel();}}
}
struct Ticket {
    before: Repository,
    coverage: Coverage,
    cwd: String,
    command: String,
    launch:Option<VerificationLaunch>,
    authorized_pane:Option<String>,
}
impl Drop for Ticket {fn drop(&mut self){self.coverage.cancel();}}
struct Inner {
    runs: Vec<Run>,
    revision: u64,
    load_error: Option<String>,
    write_error: Option<String>,
    backup_path: Option<String>,
}
pub struct Store {
    path: PathBuf,
    run_id: String,
    inner: Mutex<Inner>,
    tickets: Mutex<HashMap<String, Ticket>>,
}
pub fn id() -> String {
    static NEXT: AtomicU64 = AtomicU64::new(0);
    format!(
        "{}-{}-{}",
        std::process::id(),
        repo_state::now(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    )
}
fn validate(run: &Run) -> Result<(), String> {
    if run.id.is_empty()
        || run.id.len() > 128
        || run.pane_id.len() > 128
        || run.command.encode_utf16().count() > 16_000
        || run.cwd.as_ref().is_some_and(|s| s.len() > 16_384)
        || run.output.encode_utf16().count() > 128_000
        || run.profile_id.as_ref().is_some_and(|s| s.len() > 256)
        || run.environment.as_ref().is_some_and(|s|s.len()>256 || (s!="native"&&s!="unknown"&&!s.strip_prefix("wsl:").is_some_and(crate::wsl::valid_distribution)))
        || run.finished_at < run.started_at
    {
        return Err("Command record has invalid or excessive fields".into());
    }
    if let Some(v) = &run.verification
        && (v.before.digest.len() != 64 || v.before.root.len() > 16_384 || v.reason.len() > 8000)
    {
        return Err("Verification evidence is invalid".into());
    }
    Ok(())
}
fn read(path: &Path) -> Result<Vec<Run>, String> {
    let file = match fs::File::open(path) {
        Ok(file) => file,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(format!("Could not read command records: {e}")),
    };
    let mut bytes = Vec::new();
    file.take(64 * 1024 * 1024 + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() > 64 * 1024 * 1024 {
        return Err("Command records exceed 64 MiB; original file preserved".into());
    }
    let saved: Saved = serde_json::from_slice(&bytes)
        .map_err(|e| format!("Could not read command records: {e}"))?;
    if saved.version != 1 || saved.runs.len() > 100 {
        return Err("Unsupported command record history; original file preserved".into());
    }
    let mut seen = HashSet::new();
    for run in &saved.runs {
        validate(run)?;
        if !seen.insert(&run.id) {
            return Err("Command history contains duplicate IDs".into());
        }
    }
    let mut runs = saved.runs;
    // A persisted last comparison is historical until this process checks again.
    for run in &mut runs {
        if let Some(v) = &mut run.verification {
            v.status = Freshness::Unknown;
            v.reason = "Repository state has not been rechecked since restart".into();
        }
    }
    Ok(runs)
}
impl Store {
    pub fn load(path: PathBuf) -> Self {
        let (runs, load_error) = match read(&path) {
            Ok(runs) => (runs, None),
            Err(e) => (Vec::new(), Some(e)),
        };
        Self {
            path,
            run_id: id(),
            inner: Mutex::new(Inner {
                runs,
                revision: 0,
                load_error,
                write_error: None,
                backup_path: None,
            }),
            tickets: Mutex::new(HashMap::new()),
        }
    }
    fn view(&self, inner: &Inner) -> Snapshot {
        Snapshot {
            run_id: self.run_id.clone(),
            revision: inner.revision,
            runs: inner.runs.clone(),
            error: inner
                .load_error
                .clone()
                .or_else(|| inner.write_error.clone()),
            recovery_required: inner.load_error.is_some(),
            backup_path: inner.backup_path.clone(),
        }
    }
    pub fn snapshot(&self) -> Snapshot {
        self.view(&self.inner.lock().unwrap())
    }
    fn persist(&self, inner: &mut Inner) {
        inner.revision += 1;
        inner.runs.sort_by_key(|r| std::cmp::Reverse(r.started_at));
        inner.runs.truncate(100);
        let mut bytes = 32;
        let mut keep = 0;
        for run in &inner.runs {
            let size = match serde_json::to_vec(run) {
                Ok(value) => value.len() + 1,
                Err(error) => {
                    inner.write_error = Some(error.to_string());
                    return;
                }
            };
            if bytes + size > 32 * 1024 * 1024 {
                break;
            }
            bytes += size;
            keep += 1;
        }
        inner.runs.truncate(keep);
        if inner.load_error.is_some() {
            return;
        }
        inner.write_error = serde_json::to_string(&Saved {
            version: 1,
            runs: inner.runs.clone(),
        })
        .map_err(|e| e.to_string())
        .and_then(|text| crate::claude::write_atomically(&self.path, &text))
        .err();
    }
    pub fn prepare(&self, cwd: &str, command: &str) -> Result<Prepared, String> {
        if command.trim().is_empty()
            || command.encode_utf16().count() > 16_000
            || command.contains(['\r', '\n'])
        {
            return Err("Choose a single reviewed shell command".into());
        }
        let cwd = repo_state::native_folder(cwd)?;
        let root = repo_state::root(&cwd)?;
        let coverage = NativeCoverage::start(&root)?;
        let before = repo_state::capture(&root)?;
        if coverage.changed()? {
            return Err(
                "Repository changed while preparing verification. Retry when edits stop".into(),
            );
        }
        let mut tickets = self.tickets.lock().unwrap();
        if tickets.len() >= 16 {
            return Err("At most 16 verification checks can be pending".into());
        }
        let id = id();
        tickets.insert(
            id.clone(),
            Ticket {
                before: before.clone(),
                coverage:Coverage::Native(coverage),
                cwd:repo_state::display(&cwd),
                command: command.trim().to_owned(),
                launch:None,authorized_pane:None,
            },
        );
        Ok(Prepared { id, before,launch:None })
    }
    pub fn prepare_wsl(&self,distribution:&str,cwd:&str,command:&str,profile:&crate::pty::Profile)->Result<Prepared,String>{
        if command.trim().is_empty()||command.encode_utf16().count()>16000||command.contains(['\r','\n']){return Err("Choose a single reviewed shell command".into());}
        profile.check_environment(Some(&format!("wsl:{}",distribution.to_lowercase())))?;
        profile.check_kind(Some("wsl"))?;
        if self.tickets.lock().unwrap().len()>=16{return Err("At most 16 verification checks can be pending".into());}
        let monitor=Arc::new(crate::wsl_verification_monitor::Monitor::start(distribution,cwd)?);
        let before=monitor.before.clone();
        let launch=VerificationLaunch{profile_id:profile.id.clone(),profile_key:profile.launch_key(),environment:format!("wsl:{}",distribution.to_lowercase()),cwd:monitor.cwd.clone()};
        let mut tickets=self.tickets.lock().unwrap();
        if tickets.len()>=16{return Err("At most 16 verification checks can be pending".into());}
        let id=id();tickets.insert(id.clone(),Ticket{before:before.clone(),coverage:Coverage::Wsl(monitor),cwd:launch.cwd.clone(),command:command.trim().into(),launch:Some(launch.clone()),authorized_pane:None});
        Ok(Prepared{id,before,launch:Some(launch)})
    }
    pub fn launch_context(&self,ticket:&str)->Result<VerificationLaunch,String>{self.tickets.lock().unwrap().get(ticket).and_then(|ticket|ticket.launch.clone()).ok_or("Linux verification ticket is no longer pending".into())}
    pub fn authorize_wsl(&self,ticket:&str,pane:&str,validate:&dyn Fn(&VerificationLaunch)->Result<(),String>)->Result<(),String>{
        let (monitor,launch)={let tickets=self.tickets.lock().unwrap();let ticket=tickets.get(ticket).ok_or("Verification ticket was cancelled")?;
            let Coverage::Wsl(monitor)=&ticket.coverage else{return Err("This is not a Linux verification ticket".into());};
            if ticket.authorized_pane.is_some(){return Err("Verification startup was already authorized".into());}
            (Arc::clone(monitor),ticket.launch.clone().ok_or("Missing verification launch identity")?)};
        validate(&launch)?;
        if monitor.changed()?{return Err("Repository changed before the reviewed check started; prepare it again".into());}
        validate(&launch)?;
        let mut tickets=self.tickets.lock().unwrap();let pending=tickets.get_mut(ticket).ok_or("Verification ticket was cancelled")?;
        if pending.authorized_pane.is_some(){return Err("Verification startup was already authorized".into());}
        pending.authorized_pane=Some(pane.into());Ok(())
    }
    pub fn cancel(&self, ticket: &str) {
        let ticket=self.tickets.lock().unwrap().remove(ticket);
        if let Some(ticket)=ticket{ticket.coverage.cancel();}
    }
    pub fn append(&self, mut run: Run, ticket: Option<&str>) -> Result<Snapshot, String> {
        // The caller cannot submit its own repository attestation.
        run.verification = None;
        run.app_run_id = Some(self.run_id.clone());
        validate(&run)?;
        {
            let inner = self.inner.lock().unwrap();
            if let Some(existing) = inner.runs.iter().find(|r| r.id == run.id) {
                if existing.command != run.command
                    || existing.cwd != run.cwd
                    || existing.environment != run.environment
                    || existing.started_at != run.started_at
                {
                    return Err("Command record ID already belongs to a different run".into());
                }
                return Ok(self.view(&inner));
            }
        }
        if let Some(ticket) = ticket.and_then(|id| self.tickets.lock().unwrap().remove(id)) {
            let mut evidence = Evidence {
                before: ticket.before.clone(),
                after: None,
                eligible: false,
                changed_during_run: false,
                status: Freshness::Unknown,
                reason: "Verification input did not match the prepared command".into(),
                checked_at: repo_state::now(),
            };
            let matches=if let Some(launch)=&ticket.launch{
                run.environment.as_deref()==Some(&launch.environment)&&run.cwd.as_ref()==Some(&ticket.cwd)&&run.profile_id.as_ref()==Some(&launch.profile_id)&&run.shell_kind.as_deref()==Some("wsl")&&ticket.authorized_pane.as_ref()==Some(&run.pane_id)
            }else{run.environment.as_deref().unwrap_or("native")=="native"&&run.cwd.as_ref().and_then(|cwd|repo_state::native_folder(cwd).ok()).map(|path|repo_state::display(&path)).as_ref()==Some(&ticket.cwd)};
            if matches
                && run.command.trim() == ticket.command
                && !run.command_truncated
                && run.started_at >= evidence.before.captured_at
            {
                match ticket.coverage.finish(&evidence.before.root) {
                    Ok((after, changed)) => {
                        evidence.changed_during_run = changed;
                        evidence.eligible = !changed && after.as_ref().is_some_and(|after|after.digest == evidence.before.digest);
                        evidence.status = if evidence.eligible {
                            Freshness::Matches
                        } else {
                            Freshness::Stale
                        };
                        evidence.reason = if changed { "Repository edits were observed after this check was prepared; its result does not validate those edits" } else if !evidence.eligible { "Repository state changed between the before and after snapshots" } else { "Repository files, Git identity and staged state match the before-run snapshot; no relevant edits were observed during the check" }.into();
                        evidence.after = after;
                    }
                    Err(error) => evidence.reason = error,
                }
            }
            ticket.coverage.cancel();
            run.verification = Some(evidence);
        }
        let mut inner = self.inner.lock().unwrap();
        inner.runs.retain(|r| r.id != run.id);
        inner.runs.push(run);
        self.persist(&mut inner);
        Ok(self.view(&inner))
    }
    pub fn refresh(&self) -> Snapshot {
        let records: Vec<_> = self
            .inner
            .lock()
            .unwrap()
            .runs
            .iter()
            .filter_map(|r| {
                r.verification
                    .as_ref()
                    .map(|v| (r.id.clone(),r.environment.clone().unwrap_or_else(||"native".into()), v.before.clone(), v.eligible))
            })
            .collect();
        let roots: HashSet<_> = records
            .iter()
            .map(|(_,environment, before, _)| (environment.clone(),before.root.clone()))
            .collect();
        let current: HashMap<_, _> = roots
            .into_iter()
            .map(|(environment,root)| {
                let value: Result<Repository, String> = (|| {
                    if let Some(distribution)=environment.strip_prefix("wsl:"){
                        let monitor=crate::wsl_verification_monitor::Monitor::start(distribution,&root)?;
                        let result=monitor.finish()?;
                        if result.changed{return Err("Linux repository changed during comparison; retry to establish freshness".into());}
                        return result.after.ok_or("Linux comparison returned no repository state".into());
                    }
                    if environment!="native"{return Err("Verification environment is unavailable".into());}
                    let coverage = NativeCoverage::start(Path::new(&root))?;
                    let captured = repo_state::capture(Path::new(&root))?;
                    if coverage.changed()? {
                        return Err(
                            "Repository changed during comparison; retry to establish freshness"
                                .into(),
                        );
                    }
                    Ok(captured)
                })();
                ((environment,root), value)
            })
            .collect();
        let mut inner = self.inner.lock().unwrap();
        for (id, environment,before, eligible) in records {
            let Some(run) = inner.runs.iter_mut().find(|r| r.id == id) else {
                continue;
            };
            let v = run.verification.as_mut().unwrap();
            v.checked_at = repo_state::now();
            match &current[&(environment,before.root.clone())] {
                Ok(now) if eligible => {
                    v.status = if now.digest == before.digest {
                        Freshness::Matches
                    } else {
                        Freshness::Stale
                    };
                    v.reason = if v.status == Freshness::Matches { "Current repository files match the state captured before the check. Ignored files, external dependencies and environment are outside this evidence" } else { "Repository files, staged state or Git identity changed after the check started" }.into();
                }
                Ok(_) => {
                    v.status = if v.changed_during_run
                        || v.after
                            .as_ref()
                            .is_some_and(|after| after.digest != before.digest)
                    {
                        Freshness::Stale
                    } else {
                        Freshness::Unknown
                    };
                }
                Err(error) => {
                    v.status = Freshness::Unknown;
                    v.reason = error.clone();
                }
            }
        }
        inner.revision += 1; // Comparison is transient; quit/retry persists history.
        self.view(&inner)
    }
    pub fn act(&self, action: Action) -> Result<Snapshot, String> {
        let mut inner = self.inner.lock().unwrap();
        match action {
            Action::Retry if inner.load_error.is_some() => match read(&self.path) {
                Ok(mut saved) => {
                    let pending: HashSet<_> = inner.runs.iter().map(|r| r.id.clone()).collect();
                    saved.retain(|r| !pending.contains(&r.id));
                    saved.extend(inner.runs.clone());
                    inner.runs = saved;
                    inner.load_error = None;
                }
                Err(error) => inner.load_error = Some(error),
            },
            Action::ResetSaved if inner.load_error.is_some() => {
                let backup = self.path.with_extension(format!("backup-{}.json", id()));
                match fs::rename(&self.path, &backup) {
                    Ok(()) => inner.backup_path = Some(backup.to_string_lossy().into_owned()),
                    Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                    Err(e) => {
                        return Err(format!("Could not preserve original command records: {e}"));
                    }
                }
                inner.load_error = None;
            }
            Action::Clear => inner.runs.clear(),
            _ => {}
        }
        self.persist(&mut inner);
        Ok(self.view(&inner))
    }
}
