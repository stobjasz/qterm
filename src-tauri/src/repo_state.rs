//! Repository evidence for an explicitly launched check, never an execution grant.
//! Hash actual file contents (not just status counts or mtimes). Git hooks,
//! external diff/textconv and submodule programs are not invoked.
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeSet,
    fs,
    io::{Read, Write},
    os::windows::process::CommandExt,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{Arc, Mutex},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

const MAX_GIT: usize = 4 * 1024 * 1024;
const MAX_FILES: usize = 20_000;
const MAX_BYTES: u64 = 128 * 1024 * 1024;
const TIMEOUT: Duration = Duration::from_secs(10);
pub fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
pub fn display(path: &Path) -> String {
    let text = path.to_string_lossy();
    text.strip_prefix(r"\\?\UNC\")
        .map(|p| format!(r"\\{p}"))
        .unwrap_or_else(|| text.strip_prefix(r"\\?\").unwrap_or(&text).to_owned())
}
fn flat(path: &Path) -> String {
    display(path)
        .replace('\\', "/")
        .trim_end_matches('/')
        .to_owned()
}
fn norm(path: &Path) -> String {
    flat(path).to_lowercase()
}

fn drain(mut reader: impl Read) -> Result<Vec<u8>, String> {
    let mut kept = Vec::new();
    let mut buffer = [0; 8192];
    let mut overflow = false;
    loop {
        let n = reader.read(&mut buffer).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        if kept.len() + n <= MAX_GIT {
            kept.extend_from_slice(&buffer[..n]);
        } else {
            overflow = true;
        }
    }
    if overflow {
        Err("Git output exceeded the verification limit".into())
    } else {
        Ok(kept)
    }
}

/// Bounded, hidden, built-in read-only Git commands; the optional stdin is data.
pub(crate) fn git(
    root: &Path,
    args: &[&str],
    input: Option<Vec<u8>>,
    allow_missing: bool,
) -> Result<Vec<u8>, String> {
    git_configured(root, args, input, allow_missing, &[], TIMEOUT)
}

/// Shared bounded Git runner. Mutation callers supply explicit hook/filter policy.
pub(crate) fn git_configured(
    root: &Path,
    args: &[&str],
    input: Option<Vec<u8>>,
    allow_missing: bool,
    config: &[String],
    timeout: Duration,
) -> Result<Vec<u8>, String> {
    let overrides: Vec<&str> = config.iter().flat_map(|c| ["-c", c.as_str()]).collect();
    let mut child = Command::new("git")
        .args([
            "--no-pager",
            "--no-optional-locks",
            "-c",
            "core.fsmonitor=false",
            "-c",
            "core.untrackedCache=false",
            "-c",
            "submodule.recurse=false",
        ])
        .args(overrides)
        .args(args)
        .current_dir(root)
        .env("GIT_TERMINAL_PROMPT", "0")
        .creation_flags(0x0800_0000)
        .stdin(if input.is_some() {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Could not inspect repository: {e}"))?;
    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();
    let out = thread::spawn(move || drain(stdout));
    let err = thread::spawn(move || drain(stderr));
    let writer = input.map(|bytes| {
        let mut stdin = child.stdin.take().unwrap();
        thread::spawn(move || stdin.write_all(&bytes))
    });
    let deadline = Instant::now() + timeout;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if Instant::now() < deadline => thread::sleep(Duration::from_millis(10)),
            other => {
                let _ = child.kill();
                let _ = child.wait();
                let _ = out.join();
                let _ = err.join();
                if let Some(writer) = writer {
                    let _ = writer.join();
                }
                return Err(match other {
                    Err(e) => e.to_string(),
                    _ => "Repository inspection timed out".into(),
                });
            }
        }
    };
    if let Some(writer) = writer {
        let _ = writer.join();
    }
    let output = out.join().map_err(|_| "Git output reader stopped")??;
    let error = err.join().map_err(|_| "Git error reader stopped")??;
    if status.success() || (allow_missing && status.code() == Some(1)) {
        Ok(output)
    } else {
        Err(format!(
            "Git repository inspection failed: {}",
            String::from_utf8_lossy(&error)
                .trim()
                .chars()
                .take(1000)
                .collect::<String>()
        ))
    }
}

fn paths(bytes: &[u8]) -> Result<BTreeSet<String>, String> {
    bytes
        .split(|b| *b == 0)
        .filter(|s| !s.is_empty())
        .map(|s| {
            let name = std::str::from_utf8(s).map_err(|_| "Repository path is not UTF-8")?;
            let path = Path::new(name);
            if path.is_absolute()
                || path.components().any(|c| {
                    matches!(
                        c,
                        std::path::Component::ParentDir | std::path::Component::Prefix(_)
                    )
                })
            {
                return Err("Repository path escapes its root".into());
            }
            Ok(name.to_owned())
        })
        .collect()
}

/// Status/diff may invoke clean filters while refreshing the index, even without
/// external diff enabled. Disable every configured filter before automatic reads.
pub(crate) fn disabled_filters(root: &Path) -> Result<Vec<String>, String> {
    let keys = git(
        root,
        &[
            "config",
            "--null",
            "--name-only",
            "--get-regexp",
            r"^filter\..*\.(clean|smudge|process|required)$",
        ],
        None,
        true,
    )?;
    keys.split(|b| *b == 0)
        .filter(|k| !k.is_empty())
        .map(|key| {
            let key = std::str::from_utf8(key).map_err(|_| "Filter config key is not UTF-8")?;
            Ok(format!(
                "{key}={}",
                if key.ends_with(".required") {
                    "false"
                } else {
                    ""
                }
            ))
        })
        .collect()
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub root: String,
    pub head: Option<String>,
    pub branch: Option<String>,
    pub digest: String,
    pub files: usize,
    pub bytes: u64,
    pub captured_at: u64,
}
pub fn root(cwd: &Path) -> Result<PathBuf, String> {
    if !cwd.is_dir() {
        return Err("The command folder is unavailable or is not a native Windows folder".into());
    }
    let text = git(cwd, &["rev-parse", "--show-toplevel"], None, false)?;
    let path = std::str::from_utf8(&text)
        .map_err(|_| "Repository root is not UTF-8")?
        .trim_end_matches(['\r', '\n']);
    fs::canonicalize(path).map_err(|e| format!("Repository folder unavailable: {e}"))
}
pub fn native_folder(cwd: &str) -> Result<PathBuf, String> {
    let bytes = cwd.as_bytes();
    let path = if bytes.len() >= 2
        && bytes[0] == b'/'
        && bytes[1].is_ascii_alphabetic()
        && (bytes.len() == 2 || bytes[2] == b'/')
    {
        format!(
            "{}:{}",
            (bytes[1] as char).to_ascii_uppercase(),
            if bytes.len() == 2 {
                "\\".into()
            } else {
                cwd[2..].replace('/', "\\")
            }
        )
    } else {
        cwd.to_owned()
    };
    fs::canonicalize(path).map_err(|e| format!("Command folder unavailable: {e}"))
}
fn inventory(root: &Path) -> Result<BTreeSet<String>, String> {
    paths(&git(
        root,
        &[
            "ls-files",
            "--cached",
            "--others",
            "--exclude-standard",
            "-z",
        ],
        None,
        false,
    )?)
}
fn identity(root: &Path) -> Result<Vec<u8>, String> {
    let mut out = git(
        root,
        &["rev-parse", "--verify", "--quiet", "HEAD"],
        None,
        true,
    )?;
    out.push(0);
    out.extend(git(root, &["symbolic-ref", "--quiet", "HEAD"], None, true)?);
    out.push(0);
    out.extend(git(root, &["ls-files", "--stage", "-z"], None, false)?);
    Ok(out)
}
fn hash_field(hash: &mut Sha256, bytes: &[u8]) {
    hash.update((bytes.len() as u64).to_le_bytes());
    hash.update(bytes);
}

pub fn capture(root: &Path) -> Result<Snapshot, String> {
    let started = Instant::now();
    let files = inventory(root)?;
    if files.len() > MAX_FILES {
        return Err("Repository exceeds 20000 files; verification state is unavailable".into());
    }
    let before = identity(root)?;
    let mut hash = Sha256::new();
    hash_field(&mut hash, &before);
    let mut total = 0;
    for name in &files {
        if started.elapsed() > TIMEOUT {
            return Err("Repository content hashing timed out".into());
        }
        hash_field(&mut hash, name.as_bytes());
        let path = root.join(name);
        let meta = match fs::symlink_metadata(&path) {
            Ok(meta) => meta,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                hash_field(&mut hash, b"missing");
                continue;
            }
            Err(e) => return Err(format!("Could not read repository file {name}: {e}")),
        };
        if meta.file_type().is_symlink() {
            return Err(format!("Symbolic link target was not captured: {name}"));
        }
        if !meta.is_file() {
            return Err(format!(
                "Repository entry {name} is a directory or submodule; its content was not captured"
            ));
        }
        if total + meta.len() > MAX_BYTES {
            return Err("Repository exceeds 128 MiB; verification state is unavailable".into());
        }
        hash_field(&mut hash, b"file");
        hash.update(meta.len().to_le_bytes());
        let mut file = fs::File::open(&path)
            .map_err(|e| format!("Could not open repository file {name}: {e}"))?;
        let mut read = 0;
        let mut buf = [0; 65536];
        loop {
            let n = file.read(&mut buf).map_err(|e| e.to_string())?;
            if n == 0 {
                break;
            }
            read += n as u64;
            total += n as u64;
            if total > MAX_BYTES || started.elapsed() > TIMEOUT {
                return Err("Repository changed size or exceeded the verification limit".into());
            }
            hash.update(&buf[..n]);
        }
        let after = fs::symlink_metadata(&path).map_err(|e| e.to_string())?;
        if read != meta.len()
            || after.len() != meta.len()
            || after.modified().ok() != meta.modified().ok()
        {
            return Err(format!(
                "Repository file changed while capturing it: {name}"
            ));
        }
    }
    if before != identity(root)? || files != inventory(root)? {
        return Err("Repository changed while its state was captured; retry the check".into());
    }
    let parts: Vec<_> = before.split(|b| *b == 0).collect();
    let field = |at: usize| {
        parts
            .get(at)
            .and_then(|s| std::str::from_utf8(s).ok())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_owned)
    };
    Ok(Snapshot {
        root: display(root),
        head: field(0),
        branch: field(1),
        digest: format!("{:x}", hash.finalize()),
        files: files.len(),
        bytes: total,
        captured_at: now(),
    })
}

struct Changes {
    paths: BTreeSet<PathBuf>,
    error: Option<String>,
    overflow: bool,
    #[cfg(test)]
    observed: u64,
}
pub struct Coverage {
    _watcher: RecommendedWatcher,
    changes: Arc<Mutex<Changes>>,
    root: PathBuf,
    metadata: Vec<String>,
    sources: BTreeSet<String>,
    ignored: Vec<String>,
}
impl Coverage {
    pub fn start(root: &Path) -> Result<Self, String> {
        let sources: BTreeSet<String> = inventory(root)?
            .into_iter()
            .map(|name| norm(&root.join(name)))
            .collect();
        let metadata = ["--git-dir", "--git-common-dir"]
            .into_iter()
            .map(|arg| {
                let bytes = git(
                    root,
                    &["rev-parse", "--path-format=absolute", arg],
                    None,
                    false,
                )?;
                Ok(PathBuf::from(
                    std::str::from_utf8(&bytes)
                        .map_err(|_| "Git metadata path is not UTF-8")?
                        .trim_end_matches(['\r', '\n']),
                ))
            })
            .collect::<Result<BTreeSet<_>, String>>()?;
        let mut ignored = paths(&git(
            root,
            &[
                "ls-files",
                "--others",
                "--ignored",
                "--exclude-standard",
                "--directory",
                "-z",
            ],
            None,
            false,
        )?)?
        .into_iter()
        .filter(|p| p.ends_with('/'))
        .collect::<Vec<_>>();
        // Also resolve common output directories before the compiler creates them.
        let candidates = [
            "target/",
            "src-tauri/target/",
            "node_modules/",
            "dist/",
            "build/",
            "coverage/",
            ".pytest_cache/",
            "__pycache__/",
        ];
        let input = candidates.join("\0") + "\0";
        ignored.extend(paths(&git(
            root,
            &["check-ignore", "--stdin", "-z"],
            Some(input.into_bytes()),
            true,
        )?)?);
        let ignored = ignored
            .into_iter()
            .map(|p| flat(&root.join(p)))
            .collect::<Vec<_>>();
        let changes = Arc::new(Mutex::new(Changes {
            paths: BTreeSet::new(),
            error: None,
            overflow: false,
            #[cfg(test)]
            observed: 0,
        }));
        let pending = changes.clone();
        let excluded = ignored.clone();
        let tracked: BTreeSet<String> = sources.clone();
        let mut watcher =
            notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
                let mut pending = pending.lock().unwrap();
                match event {
                    Err(error) => {
                        pending.error = Some(format!("Repository watcher failed: {error}"))
                    }
                    Ok(event) if event.need_rescan() => {
                        pending.error = Some(
                            "Repository watcher lost events; verification coverage is unknown"
                                .into(),
                        );
                    }
                    Ok(event) if !matches!(event.kind, notify::EventKind::Access(_)) => {
                        #[cfg(test)]
                        {
                            pending.observed += 1;
                        }
                        for path in event.paths {
                            let key = norm(&path);
                            let source = tracked.contains(&key)
                                || tracked.iter().any(|p| p.starts_with(&(key.clone() + "/")));
                            let actual = flat(&path);
                            if !source
                                && excluded
                                    .iter()
                                    .any(|p| actual == *p || actual.starts_with(&(p.clone() + "/")))
                            {
                                continue;
                            }
                            if pending.paths.len() >= 4096 {
                                pending.overflow = true;
                            } else {
                                pending.paths.insert(path);
                            }
                        }
                    }
                    _ => {}
                }
            })
            .map_err(|e| e.to_string())?;
        watcher
            .watch(root, RecursiveMode::Recursive)
            .map_err(|e| format!("Could not watch repository changes: {e}"))?;
        for dir in &metadata {
            if !norm(dir).starts_with(&(norm(root) + "/")) {
                watcher
                    .watch(dir, RecursiveMode::Recursive)
                    .map_err(|e| format!("Could not watch worktree metadata: {e}"))?;
            }
        }
        Ok(Self {
            _watcher: watcher,
            changes,
            root: root.to_path_buf(),
            metadata: metadata.iter().map(|p| norm(p)).collect(),
            sources,
            ignored,
        })
    }
    /// Never reset coverage: an edit followed by restoring the old bytes still
    /// invalidates a check that may have read the intervening content.
    pub fn changed(&self) -> Result<bool, String> {
        let pending = self.changes.lock().unwrap();
        if let Some(error) = &pending.error {
            return Err(error.clone());
        }
        if pending.overflow {
            return Err("Repository changes exceeded watcher coverage".into());
        }
        let mut unknown = Vec::new();
        let base = norm(&self.root);
        for path in &pending.paths {
            let key = norm(path);
            let actual = flat(path);
            if self.sources.contains(&key)
                || self
                    .sources
                    .iter()
                    .any(|p| p.starts_with(&(key.clone() + "/")))
            {
                return Ok(true);
            }
            if self
                .ignored
                .iter()
                .any(|p| actual == *p || actual.starts_with(&(p.clone() + "/")))
            {
                continue;
            }
            if self
                .metadata
                .iter()
                .any(|p| key == *p || key.starts_with(&(p.clone() + "/")))
            {
                return Ok(true);
            }
            if key.starts_with(&(base.clone() + "/")) {
                // Preserve spelling for Git ignore rules, including native
                // directories configured with case-sensitive names.
                unknown.push(
                    actual
                        .split('/')
                        .skip(flat(&self.root).split('/').count())
                        .collect::<Vec<_>>()
                        .join("/"),
                );
            } else {
                return Err("Watcher reported a path outside the repository".into());
            }
        }
        drop(pending);
        if unknown.is_empty() {
            return Ok(false);
        }
        let data = unknown.join("\0") + "\0";
        let ignored = paths(&git(
            &self.root,
            &["check-ignore", "--stdin", "-z"],
            Some(data.into_bytes()),
            true,
        )?)?;
        Ok(unknown.iter().any(|p| !ignored.contains(p)))
    }
}

#[cfg(test)]
pub mod tests {
    use super::*;
    pub struct Repo {
        pub dir: PathBuf,
    }
    impl Repo {
        pub fn new() -> Self {
            let dir =
                std::env::temp_dir().join(format!("qterm-check-{}", crate::run_records::id()));
            fs::create_dir_all(dir.join("src")).unwrap();
            fs::write(
                dir.join(".gitignore"),
                "target/\nnode_modules/\nignored.txt\n",
            )
            .unwrap();
            fs::write(dir.join("src/value.txt"), "one").unwrap();
            let repo = Self { dir };
            repo.git(&["init", "--quiet"]);
            repo.git(&["add", "."]);
            repo.git(&["commit", "--quiet", "-m", "base"]);
            repo
        }
        pub fn git(&self, args: &[&str]) {
            let result = Command::new("git")
                .args([
                    "-c",
                    "user.name=qterm-test",
                    "-c",
                    "user.email=qterm-test@example.invalid",
                    "-c",
                    "commit.gpgSign=false",
                    "-c",
                    "core.fsmonitor=false",
                ])
                .args(args)
                .env("GIT_CONFIG_GLOBAL", "NUL")
                .env("GIT_CONFIG_NOSYSTEM", "1")
                .current_dir(&self.dir)
                .creation_flags(0x0800_0000)
                .output()
                .unwrap();
            assert!(
                result.status.success(),
                "{}",
                String::from_utf8_lossy(&result.stderr)
            );
        }
    }
    impl Drop for Repo {
        fn drop(&mut self) {
            let target = fs::canonicalize(&self.dir).unwrap();
            assert_eq!(
                target.parent(),
                Some(fs::canonicalize(std::env::temp_dir()).unwrap().as_path())
            );
            assert!(
                target
                    .file_name()
                    .unwrap()
                    .to_string_lossy()
                    .starts_with("qterm-check-")
            );
            fs::remove_dir_all(target).unwrap();
        }
    }
    pub fn until(mut ready: impl FnMut() -> bool) {
        let deadline = Instant::now() + Duration::from_secs(3);
        while !ready() {
            assert!(
                Instant::now() < deadline,
                "repository watcher did not report the event"
            );
            thread::sleep(Duration::from_millis(10));
        }
    }
    #[test]
    fn content_staged_state_and_untracked_files_change_the_fingerprint() {
        let repo = Repo::new();
        let root = root(&repo.dir).unwrap();
        let base = capture(&root).unwrap();
        fs::write(root.join("src/value.txt"), "two").unwrap();
        let dirty = capture(&root).unwrap();
        assert_ne!(base.digest, dirty.digest);
        repo.git(&["add", "src/value.txt"]);
        assert_ne!(dirty.digest, capture(&root).unwrap().digest);
        fs::write(root.join("new file.txt"), "untracked").unwrap();
        let untracked = capture(&root).unwrap();
        assert_eq!(untracked.files, base.files + 1);
        fs::write(root.join("ignored.txt"), "ignored dependency").unwrap();
        assert_eq!(untracked.digest, capture(&root).unwrap().digest);
    }
    #[test]
    fn coverage_ignores_build_outputs_but_retains_a_source_edit_after_restore() {
        let repo = Repo::new();
        let root = root(&repo.dir).unwrap();
        let coverage = Coverage::start(&root).unwrap();
        let before = capture(&root).unwrap();
        let observed = coverage.changes.lock().unwrap().observed;
        fs::create_dir(root.join("target")).unwrap();
        fs::write(root.join("target/output.txt"), "output").unwrap();
        until(|| coverage.changes.lock().unwrap().observed > observed);
        assert!(!coverage.changed().unwrap());
        fs::write(root.join("src/value.txt"), "two").unwrap();
        until(|| coverage.changed().unwrap());
        fs::write(root.join("src/value.txt"), "one").unwrap();
        assert_eq!(before.digest, capture(&root).unwrap().digest);
        assert!(coverage.changed().unwrap());
    }
    #[test]
    fn repository_inspection_does_not_run_a_configured_fsmonitor_hook() {
        let repo = Repo::new();
        let marker = repo.dir.join("hook-ran");
        let hook = repo.dir.join("monitor.cmd");
        fs::write(
            &hook,
            format!("@echo off\r\necho called > \"{}\"\r\n", marker.display()),
        )
        .unwrap();
        repo.git(&["config", "core.fsmonitor", &hook.to_string_lossy()]);
        capture(&root(&repo.dir).unwrap()).unwrap();
        assert!(!marker.exists());
    }
    #[test]
    fn hashes_changed_bytes_even_when_size_and_modification_time_match() {
        let repo = Repo::new();
        let root = root(&repo.dir).unwrap();
        let file = root.join("src/value.txt");
        fs::write(&file, "two").unwrap();
        let modified = fs::metadata(&file).unwrap().modified().unwrap();
        let before = capture(&root).unwrap();
        fs::write(&file, "ten").unwrap();
        fs::OpenOptions::new()
            .write(true)
            .open(&file)
            .unwrap()
            .set_times(fs::FileTimes::new().set_modified(modified))
            .unwrap();
        assert_eq!(fs::metadata(&file).unwrap().modified().unwrap(), modified);
        assert_ne!(capture(&root).unwrap().digest, before.digest);
    }
    #[test]
    fn coverage_in_a_linked_worktree_includes_external_git_metadata() {
        let repo = Repo::new();
        let linked = repo.dir.join("linked-worktree");
        repo.git(&[
            "worktree",
            "add",
            "--quiet",
            "-b",
            "linked-check",
            &linked.to_string_lossy(),
        ]);
        let root = root(&linked).unwrap();
        let coverage = Coverage::start(&root).unwrap();
        let before = capture(&root).unwrap();
        repo.git(&[
            "-C",
            &linked.to_string_lossy(),
            "checkout",
            "--quiet",
            "--detach",
        ]);
        until(|| coverage.changed().unwrap());
        assert_ne!(before.digest, capture(&root).unwrap().digest);
    }
}
