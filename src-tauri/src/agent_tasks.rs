//! Reviewed launch definitions and session invocation state. No arbitrary input API.
use crate::{agent_pipe, project, pty::Profile, repo_state, run_records};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    fs,
    io::Read,
    path::{Path, PathBuf},
    sync::Mutex,
};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: String,
    pub name: String,
    pub command: String,
    pub source: String,
    pub directory: String,
    pub manifest_digest: String,
    #[serde(skip)]
    manifest: PathBuf,
    #[serde(skip)]
    resolved_command: String,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    pub path: String,
    pub digest: String,
    pub preview: String,
    pub truncated: bool,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Policy {
    pub profile_id: String,
    pub profile_name: String,
    pub tasks: Vec<Task>,
    pub manifests: Vec<Manifest>,
    #[serde(skip)]
    pub profile_key: String,
}
fn source(path: &Path, root: &Path) -> Result<(PathBuf, Vec<u8>), String> {
    let path = fs::canonicalize(path).map_err(|e| e.to_string())?;
    if !path.starts_with(root) {
        return Err("Task manifest escapes the granted project".into());
    }
    let mut bytes = vec![];
    fs::File::open(&path)
        .map_err(|e| e.to_string())?
        .take(1_048_577)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() > 1_048_576 {
        return Err("Task manifest exceeds 1 MiB".into());
    }
    Ok((path, bytes))
}
pub fn task_id(source: &str, name: &str) -> String {
    format!("{:x}", Sha256::digest(format!("{source}\0{name}")))
}
impl Policy {
    pub fn review(root: &Path, cwd: &Path, profile: &Profile) -> Result<Self, String> {
        let key = profile
            .automation_key()
            .ok_or("Choose a supported native shell for task execution")?;
        let found = project::tasks(cwd).ok_or("No named project tasks found in this folder")?;
        let dir = repo_state::native_folder(&found.dir)?;
        if !dir.starts_with(root) {
            return Err("Task directory escapes the project".into());
        }
        let mut manifests: HashMap<PathBuf, Manifest> = HashMap::new();
        let mut tasks = vec![];
        for task in found.tasks {
            let command = profile.task_command(&task.command);
            if command.encode_utf16().count() > 16000
                || task.command.contains(['\r', '\n', '\0'])
                || task.name.chars().any(char::is_control)
            {
                continue;
            }
            let (manifest, bytes) = source(&dir.join(&task.source), root)?;
            let digest = format!("{:x}", Sha256::digest(&bytes));
            manifests.entry(manifest.clone()).or_insert_with(|| {
                let text = String::from_utf8_lossy(&bytes);
                let preview: String = text.chars().take(16000).collect();
                Manifest {
                    path: repo_state::display(&manifest),
                    digest: digest.clone(),
                    truncated: preview.len() < text.len(),
                    preview,
                }
            });
            tasks.push(Task {
                id: task_id(&task.source, &task.name),
                name: task.name,
                command,
                resolved_command: task.command,
                source: task.source,
                directory: repo_state::display(&dir),
                manifest_digest: digest,
                manifest,
            });
        }
        if tasks.is_empty() {
            return Err("No tasks have complete single-line launch commands".into());
        }
        let mut manifests: Vec<_> = manifests.into_values().collect();
        manifests.sort_by(|a, b| a.path.cmp(&b.path));
        let policy = Self {
            profile_id: profile.id.clone(),
            profile_name: profile.name.clone(),
            profile_key: key,
            tasks,
            manifests,
        };
        // Discovery and hashing must describe the same currently resolved commands.
        for task in &policy.tasks {
            policy.validate(root, task, profile)?;
        }
        Ok(policy)
    }
    pub fn select(&self, ids: &[String]) -> Result<Self, String> {
        if ids.is_empty() || ids.len() > 200 {
            return Err("Select 1–200 reviewed tasks".into());
        }
        let mut tasks = vec![];
        for id in ids {
            let task = self
                .tasks
                .iter()
                .find(|t| t.id == *id)
                .ok_or("Task was not in this review")?;
            if !tasks.iter().any(|t: &Task| t.id == *id) {
                tasks.push(task.clone());
            }
        }
        let manifests = self
            .manifests
            .iter()
            .filter(|m| {
                tasks.iter().any(|t| {
                    t.manifest_digest == m.digest && repo_state::display(&t.manifest) == m.path
                })
            })
            .cloned()
            .collect();
        Ok(Self {
            tasks,
            manifests,
            ..self.clone()
        })
    }
    pub fn validate(&self, root: &Path, task: &Task, profile: &Profile) -> Result<(), String> {
        if profile.id != self.profile_id
            || profile.automation_key().as_deref() != Some(&self.profile_key)
        {
            return Err("Shell configuration changed; review a new execution grant".into());
        }
        let dir = repo_state::native_folder(&task.directory)?;
        if !dir.starts_with(root) || repo_state::display(&dir) != task.directory {
            return Err("Task directory changed or escaped the project".into());
        }
        let (path, bytes) = source(&dir.join(&task.source), root)?;
        if path != task.manifest || format!("{:x}", Sha256::digest(bytes)) != task.manifest_digest {
            return Err("Task manifest changed; review a new execution grant".into());
        }
        let found = project::tasks(&dir).ok_or("Task definition no longer exists")?;
        if repo_state::native_folder(&found.dir)? != dir
            || !found.tasks.iter().any(|t| {
                t.source == task.source
                    && t.name == task.name
                    && t.command == task.resolved_command
                    && profile.task_command(&t.command) == task.command
            })
        {
            return Err(
                "Task command or execution directory changed; review a new execution grant".into(),
            );
        }
        Ok(())
    }
}
#[derive(Clone, Debug, serde::Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Requester {
    pub client: String,
    pub grant_id: String,
    pub task_id: String,
    pub task_name: String,
    pub request_id: String,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Invocation {
    pub id: String,
    pub requester: Requester,
    pub project: String,
    pub task: Task,
    pub profile_id: String,
    pub state: String,
    pub pane_id: Option<String>,
    pub queued_at: u64,
    pub started_at: Option<u64>,
    pub finished_at: Option<u64>,
    pub exit_code: Option<i64>,
    pub error: Option<String>,
    pub evidence_warning: Option<String>,
    #[serde(skip)]
    pub session: Option<u32>,
    #[serde(skip)]
    pub ticket: Option<String>,
}
impl Invocation {
    pub fn active(&self) -> bool {
        matches!(
            self.state.as_str(),
            "queued" | "launching" | "running" | "stopping" | "unknown"
        )
    }
}
#[derive(Default)]
pub struct Queue {
    jobs: Mutex<Vec<Invocation>>,
}
impl Queue {
    pub fn snapshot(&self) -> Vec<Invocation> {
        let jobs = self.jobs.lock().unwrap();
        let mut result: Vec<_> = jobs.iter().rev().take(100).cloned().collect();
        for job in jobs.iter().filter(|j| j.active()) {
            if !result.iter().any(|j| j.id == job.id) {
                result.push(job.clone());
            }
        }
        result
    }
    pub fn get(&self, id: &str) -> Result<Invocation, String> {
        self.jobs
            .lock()
            .unwrap()
            .iter()
            .find(|j| j.id == id)
            .cloned()
            .ok_or("Task run is unknown or expired".into())
    }
    pub fn replay(
        &self,
        grant: &str,
        request: &str,
        task: &str,
    ) -> Result<Option<Invocation>, String> {
        let jobs = self.jobs.lock().unwrap();
        let found = jobs
            .iter()
            .find(|j| j.requester.grant_id == grant && j.requester.request_id == request);
        if found.is_some_and(|j| j.task.id != task) {
            return Err("Request ID already belongs to another task".into());
        }
        Ok(found.cloned())
    }
    pub fn enqueue(
        &self,
        project: &str,
        requester: Requester,
        task: Task,
        profile_id: String,
    ) -> Result<Invocation, String> {
        let mut jobs = self.jobs.lock().unwrap();
        if let Some(job) = jobs.iter().find(|j| {
            j.requester.grant_id == requester.grant_id
                && j.requester.request_id == requester.request_id
        }) {
            if job.task.id != task.id {
                return Err("Request ID already belongs to another task".into());
            }
            return Ok(job.clone());
        }
        if jobs.len() >= 1024 {
            return Err("Session task history is full (1024 invocations)".into());
        }
        if jobs.iter().filter(|j| j.active()).count() >= 4 {
            return Err("At most four agent tasks can be active; stop or finish one first".into());
        }
        let job = Invocation {
            id: format!("agent-{}", agent_pipe::random()?),
            requester,
            project: project.into(),
            task,
            profile_id,
            state: "queued".into(),
            pane_id: None,
            queued_at: repo_state::now(),
            started_at: None,
            finished_at: None,
            exit_code: None,
            error: None,
            evidence_warning: None,
            session: None,
            ticket: None,
        };
        jobs.push(job.clone());
        Ok(job)
    }
    pub fn claim(&self, id: &str, pane: &str) -> Result<Invocation, String> {
        let mut jobs = self.jobs.lock().unwrap();
        let job = jobs
            .iter_mut()
            .find(|j| j.id == id)
            .ok_or("Task run not found")?;
        if job.state != "queued" {
            return Err("Task launch was already claimed or cancelled".into());
        }
        if jobs_pane_invalid(pane) {
            return Err("Invalid task pane ID".into());
        }
        job.state = "launching".into();
        job.pane_id = Some(pane.into());
        Ok(job.clone())
    }
    pub fn launch(
        &self,
        id: &str,
        pane: &str,
        session: u32,
        ticket: Option<String>,
        warning: Option<String>,
        write: impl FnOnce(&str) -> Result<(), String>,
    ) -> Result<Invocation, String> {
        let mut jobs = self.jobs.lock().unwrap();
        let job = jobs
            .iter_mut()
            .find(|j| j.id == id)
            .ok_or("Task run not found")?;
        if job.state != "launching" || job.pane_id.as_deref() != Some(pane) {
            return Err("Task is no longer awaiting launch in this pane".into());
        }
        job.started_at = Some(repo_state::now());
        job.session = Some(session);
        job.ticket = ticket;
        job.evidence_warning = warning;
        if let Err(e) = write(&job.task.command) {
            job.state = "unknown".into();
            job.error = Some(format!("PTY write failed; launch outcome is unknown: {e}"));
            return Err(job.error.clone().unwrap());
        }
        job.state = "running".into();
        Ok(job.clone())
    }
    pub fn fail(&self, id: &str, message: &str) -> Option<String> {
        let mut jobs = self.jobs.lock().unwrap();
        let job = jobs.iter_mut().find(|j| j.id == id)?;
        if job.active() && job.state != "unknown" {
            job.state = "cancelled".into();
            job.error = Some(message.chars().take(2000).collect());
            job.finished_at = Some(repo_state::now());
        }
        job.ticket.take()
    }
    pub fn revoke(&self, grant: &str) {
        for job in self.jobs.lock().unwrap().iter_mut().filter(|j| {
            j.requester.grant_id == grant && matches!(j.state.as_str(), "queued" | "launching")
        }) {
            job.state = "cancelled".into();
            job.error = Some("Grant revoked before launch".into());
            job.finished_at = Some(repo_state::now());
        }
    }
    pub fn record(&self, run: &mut run_records::Run) -> Result<Option<String>, String> {
        run.requester = None;
        let jobs = self.jobs.lock().unwrap();
        let Some(job) = jobs.iter().find(|j| j.id == run.id) else {
            return Ok(None);
        };
        if !matches!(
            job.state.as_str(),
            "running" | "stopping" | "finished" | "unknown" | "cancelled"
        ) || job.pane_id.as_ref() != Some(&run.pane_id)
            || run.profile_id.as_ref() != Some(&job.profile_id)
            || run.command.trim() != job.task.command.trim()
        {
            return Err("Command result does not match the granted task invocation".into());
        }
        run.requester = Some(job.requester.clone());
        run.environment=Some("native".into());
        // The launch boundary already verified this canonical folder. Preserve it
        // even when the task removes/renames its cwd or shell telemetry is absent.
        run.cwd = Some(job.task.directory.clone());
        run.started_at = job.started_at.ok_or("Task never started")?;
        run.finished_at = run.finished_at.max(run.started_at);
        Ok(job.ticket.clone())
    }
    pub fn complete(&self, id: &str, exit: Option<i64>, at: u64) {
        if let Some(job) = self.jobs.lock().unwrap().iter_mut().find(|j| {
            j.id == id
                && j.started_at.is_some()
                && matches!(
                    j.state.as_str(),
                    "running" | "stopping" | "finished" | "unknown" | "cancelled"
                )
        }) {
            job.state = "finished".into();
            job.exit_code = exit;
            job.finished_at = Some(at);
            job.ticket = None;
        }
    }
    pub fn stopping(&self, id: &str) -> Result<Invocation, String> {
        let mut jobs = self.jobs.lock().unwrap();
        let job = jobs
            .iter_mut()
            .find(|j| j.id == id)
            .ok_or("Task run not found")?;
        if !matches!(job.state.as_str(), "running" | "stopping" | "unknown") {
            return Err("Task is no longer running".into());
        }
        job.state = "stopping".into();
        Ok(job.clone())
    }
}
fn jobs_pane_invalid(pane: &str) -> bool {
    pane.is_empty() || pane.len() > 128 || pane.chars().any(char::is_control)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::repo_state::tests::Repo;
    fn profile(env: &str) -> Profile {
        Profile::custom(&serde_json::from_value(serde_json::json!({"name":"task-test","command":"powershell.exe -NoLogo -NoProfile","env":{"TASK_TEST":env}})).unwrap())
    }
    fn setup() -> (Repo, Policy, Profile) {
        let repo = Repo::new();
        fs::write(
            repo.dir.join("package.json"),
            r#"{"scripts":{"check":"node check.cjs","build":"node build.cjs"}}"#,
        )
        .unwrap();
        let profile = profile("original");
        let root = fs::canonicalize(&repo.dir).unwrap();
        let policy = Policy::review(&root, &root, &profile).unwrap();
        (repo, policy, profile)
    }
    fn requester(task: &Task, id: &str) -> Requester {
        Requester {
            client: "test client".into(),
            grant_id: "grant".into(),
            task_id: task.id.clone(),
            task_name: task.name.clone(),
            request_id: id.into(),
        }
    }
    fn enqueue(queue: &Queue, repo: &Repo, policy: &Policy, id: &str) -> Invocation {
        queue
            .enqueue(
                &repo_state::display(&repo.dir),
                requester(&policy.tasks[0], id),
                policy.tasks[0].clone(),
                policy.profile_id.clone(),
            )
            .unwrap()
    }
    #[test]
    fn reviews_bind_exact_manifests_commands_folders_and_secret_profile_configuration() {
        let (repo, policy, original) = setup();
        let root = fs::canonicalize(&repo.dir).unwrap();
        let task = &policy.tasks[0];
        policy.validate(&root, task, &original).unwrap();
        assert!(
            policy
                .validate(&root, task, &profile("changed environment"))
                .is_err()
        );
        assert!(policy.select(&["not reviewed".into()]).is_err());
        assert_eq!(
            policy
                .select(std::slice::from_ref(&task.id))
                .unwrap()
                .tasks
                .len(),
            1
        );
        fs::write(
            repo.dir.join("package.json"),
            r#"{"scripts":{"check":"node changed.cjs","build":"node build.cjs"}}"#,
        )
        .unwrap();
        assert!(
            policy
                .validate(&root, task, &original)
                .unwrap_err()
                .contains("manifest changed")
        );
        let serialized = serde_json::to_string(&policy).unwrap();
        assert!(!serialized.contains("TASK_TEST"));
        assert!(!serialized.contains("profileKey"));
    }
    #[test]
    fn request_ids_are_idempotent_and_launch_claims_never_write_twice() {
        let (repo, policy, _) = setup();
        let queue = Queue::default();
        let first = enqueue(&queue, &repo, &policy, "once");
        let again = enqueue(&queue, &repo, &policy, "once");
        assert_eq!(first.id, again.id);
        assert_eq!(queue.snapshot().len(), 1);
        assert!(queue.replay("grant", "once", &policy.tasks[1].id).is_err());
        queue.claim(&first.id, "p").unwrap();
        assert!(queue.claim(&first.id, "other").is_err());
        let sent = std::sync::atomic::AtomicUsize::new(0);
        let write = |command: &str| {
            assert_eq!(command, policy.tasks[0].command);
            sent.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            Ok(())
        };
        queue.launch(&first.id, "p", 1, None, None, write).unwrap();
        assert!(queue.launch(&first.id, "p", 1, None, None, write).is_err());
        assert_eq!(sent.load(std::sync::atomic::Ordering::Relaxed), 1);
        queue.revoke("grant");
        assert_eq!(queue.get(&first.id).unwrap().state, "running");
        let pending = enqueue(&queue, &repo, &policy, "pending");
        queue.claim(&pending.id, "pending-pane").unwrap();
        queue.revoke("grant");
        assert!(
            queue
                .launch(&pending.id, "pending-pane", 2, None, None, write)
                .is_err()
        );
        assert_eq!(sent.load(std::sync::atomic::Ordering::Relaxed), 1);
    }
    #[test]
    fn invocation_results_get_native_requester_and_timing_and_survive_record_restart() {
        let (repo, policy, _) = setup();
        let queue = Queue::default();
        let job = enqueue(&queue, &repo, &policy, "result");
        queue.claim(&job.id, "p").unwrap();
        queue
            .launch(&job.id, "p", 1, None, None, |_| Ok(()))
            .unwrap();
        let mut run = run_records::Run {
            id: job.id.clone(),
            pane_id: "p".into(),
            profile_id: Some(policy.profile_id.clone()),
            shell_kind: Some("powershell".into()),
            app_run_id: None,
            environment: None,
            cwd: Some(job.task.directory.clone()),
            command: job.task.command.clone(),
            command_truncated: false,
            exit_code: Some(1),
            started_at: 1,
            finished_at: repo_state::now(),
            output: "check failed".into(),
            output_truncated: false,
            verification: None,
            requester: Some(Requester {
                client: "forged".into(),
                ..job.requester.clone()
            }),
        };
        queue.record(&mut run).unwrap();
        assert_eq!(run.requester.as_ref().unwrap().client, "test client");
        assert!(run.started_at > 1);
        let file = repo.dir.join(".git/task-results.json");
        let store = run_records::Store::load(file.clone());
        store.append(run.clone(), None).unwrap();
        queue.complete(&job.id, run.exit_code, run.finished_at);
        assert_eq!(queue.get(&job.id).unwrap().state, "finished");
        assert_eq!(
            run_records::Store::load(file).snapshot().runs[0]
                .requester
                .as_ref()
                .unwrap()
                .request_id,
            "result"
        );
        run.cwd = None;
        queue.record(&mut run).unwrap();
        assert_eq!(run.cwd.as_deref(), Some(job.task.directory.as_str()));
    }
    #[test]
    fn uncertain_writes_are_not_retried_and_active_invocations_are_bounded() {
        let (repo, policy, _) = setup();
        let queue = Queue::default();
        let job = enqueue(&queue, &repo, &policy, "uncertain");
        queue.claim(&job.id, "p").unwrap();
        assert!(
            queue
                .launch(&job.id, "p", 1, None, None, |_| Err("write failed".into()))
                .is_err()
        );
        assert_eq!(queue.get(&job.id).unwrap().state, "unknown");
        queue.fail(&job.id, "transport failed");
        assert_eq!(queue.get(&job.id).unwrap().state, "unknown");
        assert_eq!(
            enqueue(&queue, &repo, &policy, "uncertain").state,
            "unknown"
        );
        for id in ["two", "three", "four"] {
            enqueue(&queue, &repo, &policy, id);
        }
        assert!(
            queue
                .enqueue(
                    &job.project,
                    requester(&job.task, "five"),
                    job.task.clone(),
                    policy.profile_id.clone()
                )
                .is_err()
        );
        queue.revoke("grant");
        assert_eq!(queue.get(&job.id).unwrap().state, "unknown");
    }
    #[test]
    fn retargeting_a_task_directory_to_an_outside_junction_invalidates_execution() {
        use std::os::windows::process::CommandExt;
        let root = Repo::new();
        let outside = Repo::new();
        let child = root.dir.join("task");
        fs::create_dir(&child).unwrap();
        fs::write(
            child.join("package.json"),
            r#"{"scripts":{"check":"node check.cjs"}}"#,
        )
        .unwrap();
        let profile = profile("original");
        let canonical = fs::canonicalize(&root.dir).unwrap();
        let policy = Policy::review(&canonical, &child, &profile).unwrap();
        fs::remove_file(child.join("package.json")).unwrap();
        fs::remove_dir(&child).unwrap();
        let made = std::process::Command::new("cmd")
            .args(["/c", "mklink", "/J"])
            .arg(&child)
            .arg(&outside.dir)
            .creation_flags(0x08000000)
            .output()
            .unwrap();
        assert!(made.status.success());
        assert!(
            policy
                .validate(&canonical, &policy.tasks[0], &profile)
                .unwrap_err()
                .contains("escaped")
        );
        fs::remove_dir(child).unwrap();
    }
}
