//! Explicit worktree creation; never merge, remove, reuse or overwrite a checkout.
use crate::{claude::write_atomically, repo_state};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs,
    io::Read,
    path::{Component, Path, PathBuf},
    sync::{
        Mutex,
        atomic::{AtomicU64, Ordering},
    },
    time::{Duration, Instant},
};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: String,
    pub title: String,
    pub request: String,
    pub repository: String,
    pub common_dir: String,
    pub directory: String,
    pub branch: String,
    pub base: String,
    pub commit: String,
    pub provider: String,
    pub profile_id: String,
    pub created_at: u64,
    pub status: String,
    pub error: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::repo_state::tests::Repo;
    struct Case {
        repo: Repo,
        target: PathBuf,
        store: Store,
    }
    impl Case {
        fn new() -> Self {
            let repo = Repo::new();
            let target = repo.dir.with_extension("task");
            let data = repo.dir.join(".git/qterm-test");
            fs::create_dir(&data).unwrap();
            let store = Store::load(data.join("tasks.json"));
            Self {
                repo,
                target,
                store,
            }
        }
        fn draft(&self) -> Draft {
            Draft {
                cwd: repo_state::display(&self.repo.dir),
                title: "Fix parser".into(),
                request: "Inspect this worktree; don't install dependencies".into(),
                branch: "qterm/fix-parser".into(),
                base: "HEAD".into(),
                directory: repo_state::display(&self.target),
                provider: "codex".into(),
                profile_id: "powershell".into(),
            }
        }
        fn create(&self) -> Task {
            let p = self.store.preview(self.draft()).unwrap();
            let s = self.store.create(&p.token).unwrap();
            assert!(s.error.is_none(), "{:?}", s.error);
            s.tasks[0].clone()
        }
    }
    impl Drop for Case {
        fn drop(&mut self) {
            if self.target.exists() {
                let p = fs::canonicalize(&self.target).unwrap();
                assert_eq!(
                    p.parent(),
                    Some(fs::canonicalize(std::env::temp_dir()).unwrap().as_path())
                );
                assert!(
                    p.file_name()
                        .unwrap()
                        .to_string_lossy()
                        .starts_with("qterm-check-")
                );
                fs::remove_dir_all(p).unwrap();
            }
        }
    }
    #[test]
    fn preview_is_read_only_and_created_task_preserves_dirty_source_and_survives_restart() {
        let c = Case::new();
        fs::write(c.repo.dir.join("src/value.txt"), "dirty source").unwrap();
        let preview = c.store.preview(c.draft()).unwrap();
        assert!(preview.source_dirty);
        assert!(!c.target.exists());
        assert!(c.store.snapshot().tasks.is_empty());
        let result = c.store.create(&preview.token).unwrap();
        let task = &result.tasks[0];
        assert_eq!(task.status, "active", "{:?}", task.error);
        assert_eq!(
            fs::read_to_string(c.target.join("src/value.txt")).unwrap(),
            "one"
        );
        assert_eq!(
            fs::read_to_string(c.repo.dir.join("src/value.txt")).unwrap(),
            "dirty source"
        );
        let restored = Store::load(c.store.path.clone());
        assert_eq!(restored.snapshot().tasks[0].id, task.id);
        fs::write(c.target.join("src/value.txt"), "worktree change").unwrap();
        fs::write(c.target.join("new.txt"), "untracked").unwrap();
        let details = restored.details(&task.id).unwrap();
        assert_eq!(details.branch, task.branch);
        assert_eq!(details.changed, 1);
        assert_eq!(details.untracked, 1);
        assert!(details.summary.contains("value.txt"));
        restored.action("complete", Some(&task.id)).unwrap();
        assert!(c.target.join("new.txt").exists());
        assert_eq!(restored.snapshot().tasks[0].status, "completed");
        restored.action("reopen", Some(&task.id)).unwrap();
        assert_eq!(restored.snapshot().tasks[0].status, "active");
    }
    #[test]
    fn rejects_existing_paths_invalid_branches_and_changed_previews_without_touching_files() {
        let c = Case::new();
        let mut draft = c.draft();
        draft.directory = repo_state::display(&c.repo.dir);
        assert!(c.store.preview(draft).is_err());
        let mut draft = c.draft();
        draft.directory = repo_state::display(&c.repo.dir.join("nested"));
        assert!(c.store.preview(draft).is_err());
        for name in ["@{-1}", "--orphan", "bad branch", "x..y"] {
            let mut draft = c.draft();
            draft.branch = name.into();
            assert!(c.store.preview(draft).is_err());
        }
        let p = c.store.preview(c.draft()).unwrap();
        fs::create_dir(&c.target).unwrap();
        fs::write(c.target.join("owned.txt"), "keep").unwrap();
        assert!(c.store.create(&p.token).is_err());
        assert_eq!(
            fs::read_to_string(c.target.join("owned.txt")).unwrap(),
            "keep"
        );
        fs::remove_file(c.target.join("owned.txt")).unwrap();
        fs::remove_dir(&c.target).unwrap();
        let p = c.store.preview(c.draft()).unwrap();
        c.repo
            .git(&["commit", "--allow-empty", "--quiet", "-m", "base moved"]);
        assert!(
            c.store
                .create(&p.token)
                .unwrap_err()
                .contains("base changed")
        );
        assert!(!c.target.exists());
    }
    #[test]
    fn creation_disables_hooks_filters_and_submodule_recursion() {
        let c = Case::new();
        fs::write(
            c.repo.dir.join(".gitattributes"),
            "src/value.txt filter=trip\n",
        )
        .unwrap();
        c.repo.git(&["add", ".gitattributes"]);
        c.repo.git(&["commit", "--quiet", "-m", "attributes"]);
        let marker = repo_state::display(&c.repo.dir.join("executed.txt")).replace('\\', "/");
        let script = format!("#!/bin/sh\necho hook >> '{marker}'\n");
        fs::write(c.repo.dir.join(".git/hooks/post-checkout"), &script).unwrap();
        fs::write(c.repo.dir.join(".git/hooks/reference-transaction"), &script).unwrap();
        c.repo.git(&[
            "config",
            "filter.trip.smudge",
            &format!("echo filter >> '{marker}'; cat"),
        ]);
        c.repo.git(&["config", "filter.trip.required", "true"]);
        c.repo.git(&[
            "config",
            "filter.trip.clean",
            &format!("echo clean >> '{marker}'; cat"),
        ]);
        c.repo.git(&[
            "config",
            "filter.trip.process",
            &format!("echo process >> '{marker}'; exit 1"),
        ]);
        assert!(crate::project::git_status(&c.repo.dir).is_some());
        let task = c.create();
        assert_eq!(task.status, "active", "{:?}", task.error);
        assert!(!c.repo.dir.join("executed.txt").exists());
        assert_eq!(
            fs::read_to_string(c.target.join("src/value.txt")).unwrap(),
            "one"
        );
    }
    #[test]
    fn partial_checkout_failure_is_retained_and_history_failures_never_create_a_worktree() {
        let c = Case::new();
        let p = c.store.preview(c.draft()).unwrap();
        c.repo.git(&["branch", "qterm/fix-parser"]);
        let result = c.store.create(&p.token).unwrap();
        assert_eq!(result.tasks[0].status, "failed");
        assert!(c.target.exists());
        assert!(
            result.tasks[0]
                .error
                .as_ref()
                .unwrap()
                .contains("preserved")
        );
        let c = Case::new();
        fs::create_dir(&c.store.path).unwrap();
        let p = c.store.preview(c.draft()).unwrap();
        assert!(c.store.create(&p.token).is_err());
        assert!(!c.target.exists());
        assert!(c.store.snapshot().error.is_some());
        fs::remove_dir(&c.store.path).unwrap();
        c.store.action("retry", None).unwrap();
        assert!(c.store.snapshot().error.is_none());
        fs::write(&c.store.path, "unreadable").unwrap();
        let restored = Store::load(c.store.path.clone());
        assert!(restored.snapshot().recovery_required);
        let p = restored.preview(c.draft()).unwrap();
        assert!(restored.create(&p.token).is_err());
        let recovered = restored.action("recover", None).unwrap();
        assert_eq!(
            fs::read_to_string(recovered.backup_path.unwrap()).unwrap(),
            "unreadable"
        );
        assert!(!c.target.exists());
    }
}
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Draft {
    pub cwd: String,
    pub title: String,
    pub request: String,
    pub branch: String,
    pub base: String,
    pub directory: String,
    pub provider: String,
    pub profile_id: String,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Preview {
    pub token: String,
    pub task: Task,
    pub source_dirty: bool,
}
struct Pending {
    preview: Preview,
    prepared: Instant,
}
#[derive(Serialize, Deserialize)]
struct Saved {
    version: u32,
    tasks: Vec<Task>,
}
struct Inner {
    tasks: Vec<Task>,
    revision: u64,
    error: Option<String>,
    recovery: bool,
    backup: Option<String>,
}
pub struct Store {
    path: PathBuf,
    inner: Mutex<Inner>,
    pending: Mutex<HashMap<String, Pending>>,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub tasks: Vec<Task>,
    pub revision: u64,
    pub error: Option<String>,
    pub recovery_required: bool,
    pub backup_path: Option<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Details {
    pub branch: String,
    pub head: String,
    pub changed: usize,
    pub untracked: usize,
    pub commits: String,
    pub summary: String,
    pub summary_truncated: bool,
}

fn unique() -> String {
    static NEXT: AtomicU64 = AtomicU64::new(0);
    format!(
        "{}-{}-{}",
        repo_state::now(),
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    )
}
fn read_git(root: &Path, args: &[&str], missing: bool) -> Result<Vec<u8>, String> {
    if matches!(args.first(), Some(&"status" | &"diff")) {
        repo_state::git_configured(
            root,
            args,
            None,
            missing,
            &repo_state::disabled_filters(root)?,
            Duration::from_secs(10),
        )
    } else {
        repo_state::git(root, args, None, missing)
    }
}

fn field(root: &Path, args: &[&str]) -> Result<String, String> {
    String::from_utf8(read_git(root, args, false)?)
        .map(|s| s.trim_end_matches(['\r', '\n']).to_owned())
        .map_err(|_| "Git returned a non-UTF-8 value".into())
}
fn common(root: &Path) -> Result<String, String> {
    let p = field(
        root,
        &["rev-parse", "--path-format=absolute", "--git-common-dir"],
    )?;
    fs::canonicalize(p)
        .map(|p| repo_state::display(&p))
        .map_err(|e| e.to_string())
}
fn resolve(root: &Path, base: &str) -> Result<String, String> {
    field(
        root,
        &[
            "rev-parse",
            "--verify",
            "--end-of-options",
            &format!("{base}^{{commit}}"),
        ],
    )
}
fn bounded(value: &str, max: usize) -> bool {
    !value.trim().is_empty() && value.len() <= max && !value.contains('\0')
}

/// Resolve the existing parent and reject ambiguous Windows names/alternate streams.
fn destination(value: &str, repository: &Path) -> Result<PathBuf, String> {
    let path = Path::new(value);
    if !path.is_absolute() || path.components().any(|c| matches!(c, Component::ParentDir)) {
        return Err("Choose an absolute new directory without '..'".into());
    }
    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or("A new folder name is required")?;
    let stem = name.split('.').next().unwrap_or("").to_ascii_uppercase();
    if name.contains([':', '<', '>', '"', '|', '?', '*'])
        || name.chars().any(char::is_control)
        || name.ends_with(['.', ' '])
        || matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || (stem.len() == 4
            && (stem.starts_with("COM") || stem.starts_with("LPT"))
            && matches!(stem.as_bytes()[3], b'1'..=b'9'))
    {
        return Err("Choose a normal Windows folder name".into());
    }
    let parent = fs::canonicalize(path.parent().ok_or("Choose an existing parent directory")?)
        .map_err(|_| "The destination's parent directory must already exist")?;
    let target = parent.join(name);
    if target.symlink_metadata().is_ok() {
        return Err("The destination already exists; choose a new directory".into());
    }
    if target.starts_with(repository) {
        return Err("Choose a directory outside the source checkout".into());
    }
    let metadata = PathBuf::from(common(repository)?);
    if target.starts_with(&metadata) {
        return Err("The worktree directory cannot be inside Git metadata".into());
    }
    Ok(target)
}
fn valid_task(t: &Task) -> bool {
    bounded(&t.id, 100)
        && bounded(&t.title, 200)
        && bounded(&t.request, 8000)
        && bounded(&t.repository, 16384)
        && bounded(&t.common_dir, 16384)
        && bounded(&t.directory, 16384)
        && bounded(&t.branch, 240)
        && bounded(&t.base, 500)
        && bounded(&t.commit, 64)
        && bounded(&t.profile_id, 200)
        && matches!(t.provider.as_str(), "codex" | "claude" | "shell")
        && matches!(
            t.status.as_str(),
            "creating" | "active" | "completed" | "failed"
        )
        && t.error.as_ref().is_none_or(|e| e.len() <= 8000)
}
fn read(path: &Path) -> Result<Vec<Task>, String> {
    let file = match fs::File::open(path) {
        Ok(file) => file,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(vec![]),
        Err(e) => return Err(e.to_string()),
    };
    let mut bytes = vec![];
    file.take(8 * 1024 * 1024 + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() > 8 * 1024 * 1024 {
        return Err("Worktree history exceeds 8 MiB; original preserved".into());
    }
    let saved: Saved =
        serde_json::from_slice(&bytes).map_err(|e| format!("Cannot read worktree tasks: {e}"))?;
    let ids: std::collections::HashSet<_> = saved.tasks.iter().map(|t| &t.id).collect();
    if saved.version != 1
        || saved.tasks.len() > 200
        || !saved.tasks.iter().all(valid_task)
        || ids.len() != saved.tasks.len()
    {
        return Err("Invalid worktree history; original preserved".into());
    }
    Ok(saved.tasks)
}
impl Store {
    pub fn load(path: PathBuf) -> Self {
        let (mut tasks, error) = match read(&path) {
            Ok(tasks) => (tasks, None),
            Err(e) => (vec![], Some(e)),
        };
        for task in &mut tasks {
            if task.status == "creating" {
                task.status = "failed".into();
                task.error = Some("qterm stopped during creation. Inspect the branch and directory before starting another task; nothing was removed".into());
            }
        }
        let recovery = error.is_some();
        Self {
            path,
            inner: Mutex::new(Inner {
                tasks,
                revision: 0,
                error,
                recovery,
                backup: None,
            }),
            pending: Mutex::new(HashMap::new()),
        }
    }
    fn view(i: &Inner) -> Snapshot {
        Snapshot {
            tasks: i.tasks.clone(),
            revision: i.revision,
            error: i.error.clone(),
            recovery_required: i.recovery,
            backup_path: i.backup.clone(),
        }
    }
    pub fn snapshot(&self) -> Snapshot {
        Self::view(&self.inner.lock().unwrap())
    }
    fn persist(&self, i: &mut Inner) -> Result<(), String> {
        i.revision += 1;
        if i.recovery {
            return Err(i
                .error
                .clone()
                .unwrap_or("Recover worktree history first".into()));
        }
        let result = serde_json::to_string(&Saved {
            version: 1,
            tasks: i.tasks.clone(),
        })
        .map_err(|e| e.to_string())
        .and_then(|s| {
            if s.len() > 8 * 1024 * 1024 {
                return Err("Worktree history exceeds the 8 MiB save limit".into());
            }
            write_atomically(&self.path, &s)
        });
        i.error = result.as_ref().err().cloned();
        result
    }
    pub fn action(&self, action: &str, task_id: Option<&str>) -> Result<Snapshot, String> {
        let mut i = self.inner.lock().unwrap();
        match action {
            "retry" if i.recovery => match read(&self.path) {
                Ok(tasks) => {
                    i.tasks = tasks;
                    i.recovery = false;
                }
                Err(e) => i.error = Some(e),
            },
            "recover" if i.recovery => {
                let backup = self
                    .path
                    .with_extension(format!("backup-{}.json", unique()));
                fs::rename(&self.path, &backup)
                    .map_err(|e| format!("Could not preserve original history: {e}"))?;
                i.backup = Some(repo_state::display(&backup));
                i.recovery = false;
            }
            "complete" | "reopen" => {
                let task = i
                    .tasks
                    .iter_mut()
                    .find(|t| Some(t.id.as_str()) == task_id)
                    .ok_or("Worktree task not found")?;
                if !matches!(task.status.as_str(), "active" | "completed") {
                    return Err(
                        "Only a created worktree can be marked completed or reopened".into(),
                    );
                }
                task.status = if action == "complete" {
                    "completed"
                } else {
                    "active"
                }
                .into();
            }
            "retry" => {}
            _ => return Err("Unknown worktree action".into()),
        }
        let _ = self.persist(&mut i);
        Ok(Self::view(&i))
    }
    pub fn preview(&self, draft: Draft) -> Result<Preview, String> {
        if !bounded(&draft.title, 200)
            || !bounded(&draft.request, 8000)
            || !bounded(&draft.base, 500)
            || !bounded(&draft.branch, 240)
            || !bounded(&draft.profile_id, 200)
            || !matches!(draft.provider.as_str(), "codex" | "claude" | "shell")
        {
            return Err("Provide a title, request, base, branch and supported agent/shell".into());
        }
        let root = repo_state::root(&repo_state::native_folder(&draft.cwd)?)?;
        let branch = field(&root, &["check-ref-format", "--branch", &draft.branch])?;
        if branch != draft.branch || draft.branch.starts_with('-') {
            return Err("Enter a literal new branch name".into());
        }
        if !read_git(
            &root,
            &[
                "for-each-ref",
                "--format=%(refname)",
                &format!("refs/heads/{branch}"),
            ],
            false,
        )?
        .is_empty()
        {
            return Err("That branch already exists; choose a new branch".into());
        }
        let target = destination(&draft.directory, &root)?;
        let commit = resolve(&root, &draft.base)?;
        let token = unique();
        let preview = Preview {
            token: token.clone(),
            source_dirty: !read_git(
                &root,
                &[
                    "status",
                    "--porcelain=v1",
                    "-z",
                    "--untracked-files=normal",
                    "--ignore-submodules=all",
                ],
                false,
            )?
            .is_empty(),
            task: Task {
                id: unique(),
                title: draft.title.trim().into(),
                request: draft.request,
                repository: repo_state::display(&root),
                common_dir: common(&root)?,
                directory: repo_state::display(&target),
                branch,
                base: draft.base,
                commit,
                provider: draft.provider,
                profile_id: draft.profile_id,
                created_at: repo_state::now(),
                status: "creating".into(),
                error: None,
            },
        };
        let mut pending = self.pending.lock().unwrap();
        pending.retain(|_, p| p.prepared.elapsed() < Duration::from_secs(600));
        if pending.len() >= 16 {
            return Err("Too many worktree previews; close old previews or try again later".into());
        }
        pending.insert(
            token,
            Pending {
                preview: preview.clone(),
                prepared: Instant::now(),
            },
        );
        Ok(preview)
    }
    pub fn cancel(&self, token: &str) {
        self.pending.lock().unwrap().remove(token);
    }
    pub fn create(&self, token: &str) -> Result<Snapshot, String> {
        let pending = self
            .pending
            .lock()
            .unwrap()
            .remove(token)
            .ok_or("Preview expired; review the task again")?;
        if pending.prepared.elapsed() > Duration::from_secs(600) {
            return Err("Preview expired; review the task again".into());
        }
        let mut task = pending.preview.task;
        let root = fs::canonicalize(&task.repository).map_err(|e| e.to_string())?;
        if common(&root)? != task.common_dir || resolve(&root, &task.base)? != task.commit {
            return Err("Repository or base changed; review a new preview".into());
        }
        let target = destination(&task.directory, &root)?;
        if repo_state::display(&target) != task.directory {
            return Err("Destination parent changed; review a new preview".into());
        }
        let mut i = self.inner.lock().unwrap();
        if i.tasks.len() >= 200 {
            return Err("Worktree history is full (200 tasks); no worktree was created".into());
        }
        if i.error.is_some() {
            return Err("Resolve the worktree history save error before creating a task".into());
        }
        i.tasks.insert(0, task.clone());
        if let Err(e) = self.persist(&mut i) {
            i.tasks.remove(0);
            return Err(format!("No worktree created: {e}"));
        }
        let outcome = self.checkout(&root, &target, &task);
        task.status = if outcome.is_ok() { "active" } else { "failed" }.into();
        task.error = outcome.err().map(|e| {
            format!("{e}. Branch and directory were preserved; inspect them before retrying")
        });
        i.tasks[0] = task;
        let _ = self.persist(&mut i);
        Ok(Self::view(&i))
    }
    fn checkout(&self, root: &Path, target: &Path, task: &Task) -> Result<(), String> {
        let hooks = self
            .path
            .parent()
            .ok_or("No worktree data folder")?
            .join(format!("disabled-hooks-{}", unique()));
        fs::create_dir(&hooks).map_err(|e| e.to_string())?;
        let run = (|| {
            fs::create_dir(target)
                .map_err(|e| format!("Could not reserve the new directory: {e}"))?;
            let mut config = vec![
                format!("core.hooksPath={}", repo_state::display(&hooks)),
                "core.symlinks=false".into(),
            ];
            let call = |dir: &Path, args: &[&str], configs: &[String]| {
                repo_state::git_configured(
                    dir,
                    args,
                    None,
                    false,
                    configs,
                    Duration::from_secs(120),
                )
            };
            call(
                root,
                &[
                    "worktree",
                    "add",
                    "--no-checkout",
                    "-b",
                    &task.branch,
                    "--",
                    &repo_state::display(target),
                    &task.commit,
                ],
                &config,
            )?;
            // Disable every configured checkout filter, including required/process filters.
            config.extend(repo_state::disabled_filters(target)?);
            call(target, &["reset", "--hard", &task.commit, "--"], &config)?;
            Ok(())
        })();
        let _ = fs::remove_dir(hooks);
        run
    }
    pub fn details(&self, id: &str) -> Result<Details, String> {
        let task = self
            .inner
            .lock()
            .unwrap()
            .tasks
            .iter()
            .find(|t| t.id == id)
            .cloned()
            .ok_or("Worktree task not found")?;
        let root = repo_state::root(&repo_state::native_folder(&task.directory)?)?;
        if repo_state::display(&root) != task.directory || common(&root)? != task.common_dir {
            return Err("This directory is no longer the recorded worktree".into());
        }
        let status = read_git(
            &root,
            &[
                "status",
                "--porcelain=v1",
                "-z",
                "--untracked-files=normal",
                "--ignore-submodules=all",
            ],
            false,
        )?;
        let mut changed = 0;
        let mut untracked = 0;
        let mut entries = status.split(|b| *b == 0).filter(|b| !b.is_empty());
        while let Some(entry) = entries.next() {
            if entry.starts_with(b"??") {
                untracked += 1;
            } else {
                changed += 1;
                if entry.iter().take(2).any(|c| matches!(c, b'R' | b'C')) {
                    entries.next();
                }
            }
        }
        let summary = field(
            &root,
            &[
                "diff",
                "--no-ext-diff",
                "--no-textconv",
                "--stat",
                &task.commit,
                "--",
            ],
        )?;
        Ok(Details {
            branch: field(&root, &["rev-parse", "--abbrev-ref", "HEAD"])?,
            head: resolve(&root, "HEAD")?,
            changed,
            untracked,
            commits: field(
                &root,
                &["rev-list", "--count", &format!("{}..HEAD", task.commit)],
            )?,
            summary_truncated: summary.chars().count() > 12000,
            summary: summary.chars().take(12000).collect(),
        })
    }
}
