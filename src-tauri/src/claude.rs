//! Claude Code sessions qterm has seen in its terminals ("claude --resume <id>"),
//! kept so they can be resumed later in the folder they ran in.
//!
//! The folder and a title come from Claude Code's own transcript,
//! `<claude home>/projects/<encoded folder>/<id>.jsonl`. Its first `cwd` is
//! where the session was started, which is where `claude --resume` must run.

use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

const FILE_NAME: &str = "claude-sessions.json";
/// Oldest entries drop off beyond this.
const MAX_SESSIONS: usize = 200;
const TITLE_MAX_CHARS: usize = 80;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeSession {
    pub id: String,
    /// Where to resume: from the transcript, else the folder the pane reported.
    pub cwd: Option<String>,
    pub title: Option<String>,
    /// The shell profile of the pane it was seen in.
    pub profile_id: String,
    /// Unix milliseconds.
    pub seen_at: u64,
}

pub struct ClaudeStore {
    path: PathBuf,
    claude_home: Option<PathBuf>,
    sessions: Mutex<Vec<ClaudeSession>>,
}

impl ClaudeStore {
    pub fn load(config_dir: &Path, claude_home: Option<PathBuf>) -> Self {
        let path = config_dir.join(FILE_NAME);
        let sessions = std::fs::read_to_string(&path)
            .ok()
            .and_then(|text| serde_json::from_str(&text).ok())
            .unwrap_or_default();
        Self { path, claude_home, sessions: Mutex::new(sessions) }
    }

    /// Newest first.
    pub fn list(&self) -> Vec<ClaudeSession> {
        self.sessions.lock().unwrap().clone()
    }

    /// Records a sighting (again moving it to the top) and returns the new list.
    pub fn remember(&self, id: &str, profile_id: &str, pane_cwd: Option<String>) -> Result<Vec<ClaudeSession>, String> {
        if !is_session_id(id) {
            return Err(format!("not a Claude session id: {id:?}"));
        }
        let id = id.to_ascii_lowercase();
        let summary = self
            .claude_home
            .as_deref()
            .and_then(|home| find_transcript(home, &id))
            .map(|path| summarize(&path, &id));
        let (cwd, title) = summary.map(|s| (s.cwd, s.title)).unwrap_or_default();
        let session = ClaudeSession {
            cwd: cwd.or(pane_cwd),
            title,
            profile_id: profile_id.to_string(),
            seen_at: now_ms(),
            id,
        };

        let mut sessions = self.sessions.lock().unwrap();
        sessions.retain(|s| s.id != session.id);
        sessions.insert(0, session);
        sessions.truncate(MAX_SESSIONS);
        self.save(&sessions)?;
        Ok(sessions.clone())
    }

    /// Forgets several at once (e.g. a whole folder) with a single write.
    pub fn forget(&self, ids: &[String]) -> Result<Vec<ClaudeSession>, String> {
        let mut sessions = self.sessions.lock().unwrap();
        sessions.retain(|s| !ids.contains(&s.id));
        self.save(&sessions)?;
        Ok(sessions.clone())
    }

    fn save(&self, sessions: &[ClaudeSession]) -> Result<(), String> {
        let json = serde_json::to_string_pretty(sessions).map_err(|e| e.to_string())?;
        write_atomically(&self.path, &json)
    }
}

/// Where Claude Code keeps its data: `CLAUDE_CONFIG_DIR`, else `~/.claude`.
pub fn claude_home() -> Option<PathBuf> {
    std::env::var_os("CLAUDE_CONFIG_DIR")
        .or_else(|| std::env::var_os("USERPROFILE").map(|home| Path::new(&home).join(".claude").into()))
        .map(PathBuf::from)
}

/// A UUID: 8-4-4-4-12 hex digits. Also what keeps the id safe to use as a file name.
fn is_session_id(id: &str) -> bool {
    let groups: Vec<&str> = id.split('-').collect();
    groups.len() == 5
        && groups.iter().zip([8, 4, 4, 4, 12]).all(|(g, len)| g.len() == len && g.bytes().all(|b| b.is_ascii_hexdigit()))
}

fn find_transcript(claude_home: &Path, id: &str) -> Option<PathBuf> {
    std::fs::read_dir(claude_home.join("projects"))
        .ok()?
        .flatten()
        .map(|project| project.path().join(format!("{id}.jsonl")))
        .find(|candidate| candidate.is_file())
}

/// One transcript, summarized for the session browser.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptSummary {
    pub id: String,
    /// Where the session started: where `claude --resume` must run.
    pub cwd: Option<String>,
    pub title: Option<String>,
    pub git_branch: Option<String>,
    /// Messages the user typed (tool results and internal records don't count).
    pub prompts: usize,
    pub last_prompt: Option<String>,
    /// Last change of the transcript, Unix milliseconds.
    pub modified: u64,
}

/// Reads a transcript once, parsing only the lines that can matter (they get large):
/// first `cwd`, latest `aiTitle`/`lastPrompt`/`gitBranch`, and typed messages.
fn summarize(path: &Path, id: &str) -> TranscriptSummary {
    let mut summary = TranscriptSummary {
        id: id.to_string(),
        cwd: None,
        title: None,
        git_branch: None,
        prompts: 0,
        last_prompt: None,
        modified: modified_ms(path),
    };
    let Ok(file) = std::fs::File::open(path) else { return summary };
    let mut ai_title = None;
    for line in BufReader::new(file).lines().map_while(Result::ok) {
        let wants_cwd = summary.cwd.is_none() && line.contains("\"cwd\"");
        let is_user = line.contains("\"type\":\"user\"");
        let wanted = wants_cwd
            || is_user
            || line.contains("\"aiTitle\"")
            || line.contains("\"lastPrompt\"")
            || line.contains("\"gitBranch\"");
        if !wanted {
            continue;
        }
        let Ok(record) = serde_json::from_str::<serde_json::Value>(&line) else { continue };
        let text = |key: &str| record.get(key).and_then(|v| v.as_str()).map(str::to_string);
        if wants_cwd {
            summary.cwd = text("cwd");
        }
        ai_title = text("aiTitle").or(ai_title);
        summary.last_prompt = text("lastPrompt").or(summary.last_prompt.take());
        summary.git_branch = text("gitBranch").filter(|b| !b.is_empty()).or(summary.git_branch.take());
        let typed = is_user
            && record.get("isMeta").and_then(|v| v.as_bool()) != Some(true)
            && record.pointer("/message/content").is_some_and(|c| c.is_string());
        if typed {
            summary.prompts += 1;
        }
    }
    summary.last_prompt = summary.last_prompt.map(|p| shorten(p.trim(), TITLE_MAX_CHARS * 2));
    summary.title = ai_title
        .or_else(|| summary.last_prompt.clone())
        .map(|t| shorten(t.trim(), TITLE_MAX_CHARS))
        .filter(|t| !t.is_empty());
    summary
}

fn modified_ms(path: &Path) -> u64 {
    std::fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or_default()
}

/// Every Claude Code session on this machine, summarized once and cached until its
/// transcript changes.
#[derive(Default)]
pub struct TranscriptIndex {
    cache: Mutex<HashMap<PathBuf, (u64, u64, TranscriptSummary)>>,
}

impl TranscriptIndex {
    /// Newest first; sessions without a typed message (aborted starts) are left out.
    pub fn scan(&self, claude_home: &Path) -> Vec<TranscriptSummary> {
        let Ok(projects) = std::fs::read_dir(claude_home.join("projects")) else { return Vec::new() };
        let mut cache = self.cache.lock().unwrap();
        let mut found = Vec::new();
        for project in projects.flatten() {
            let Ok(files) = std::fs::read_dir(project.path()) else { continue };
            for file in files.flatten() {
                let path = file.path();
                let Some(id) = path.file_stem().and_then(|s| s.to_str()).filter(|s| is_session_id(s)) else { continue };
                if path.extension().is_none_or(|e| e != "jsonl") {
                    continue;
                }
                let (modified, size) = (modified_ms(&path), file.metadata().map(|m| m.len()).unwrap_or_default());
                let summary = match cache.get(&path) {
                    Some((m, s, summary)) if *m == modified && *s == size => summary.clone(),
                    _ => {
                        let summary = summarize(&path, id);
                        cache.insert(path.clone(), (modified, size, summary.clone()));
                        summary
                    }
                };
                found.push(summary);
            }
        }
        found.retain(|s| s.prompts > 0);
        found.sort_by_key(|s| std::cmp::Reverse(s.modified));
        found
    }
}

fn shorten(text: &str, max: usize) -> String {
    let line = text.lines().next().unwrap_or_default();
    match line.char_indices().nth(max) {
        Some((cut, _)) => format!("{}…", &line[..cut]),
        None => line.to_string(),
    }
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or_default()
}

/// Write beside the target and rename, so a crash never leaves half a file.
pub fn write_atomically(path: &Path, text: &str) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let partial = path.with_extension("partial");
    std::fs::write(&partial, text)
        .and_then(|()| std::fs::rename(&partial, path))
        .map_err(|e| format!("could not write {}: {e}", path.display()))
}

#[cfg(test)]
mod tests {
    use super::*;

    const ID: &str = "4c766d1a-f139-42df-90f0-a04fe20d3056";

    struct Fixture {
        root: PathBuf,
    }

    impl Fixture {
        fn new(name: &str) -> Self {
            let root = std::env::temp_dir().join(format!("qterm-claude-{name}-{}", std::process::id()));
            let _ = std::fs::remove_dir_all(&root);
            std::fs::create_dir_all(root.join("config")).unwrap();
            Self { root }
        }

        fn transcript(&self, id: &str, lines: &[&str]) {
            let project = self.root.join("claude/projects/C--work-app");
            std::fs::create_dir_all(&project).unwrap();
            std::fs::write(project.join(format!("{id}.jsonl")), lines.join("\n")).unwrap();
        }

        fn store(&self) -> ClaudeStore {
            ClaudeStore::load(&self.root.join("config"), Some(self.root.join("claude")))
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.root);
        }
    }

    #[test]
    fn takes_the_start_folder_and_latest_title_from_the_transcript() {
        let fx = Fixture::new("transcript");
        fx.transcript(ID, &[
            r#"{"type":"user","cwd":"C:\\work\\app","sessionId":"x"}"#,
            r#"{"type":"ai-title","aiTitle":"First idea"}"#,
            r#"{"type":"user","cwd":"C:\\work\\app\\src"}"#,
            "not json at all",
            r#"{"type":"ai-title","aiTitle":"Fix the login flow"}"#,
        ]);
        let list = fx.store().remember(ID, "pwsh", Some(r"C:\elsewhere".into())).unwrap();
        assert_eq!(list[0].cwd.as_deref(), Some(r"C:\work\app"));
        assert_eq!(list[0].title.as_deref(), Some("Fix the login flow"));
        assert_eq!(list[0].profile_id, "pwsh");
    }

    #[test]
    fn falls_back_to_the_pane_folder_and_last_prompt() {
        let fx = Fixture::new("fallback");
        fx.transcript(ID, &[r#"{"type":"last-prompt","lastPrompt":"add dark mode\nplease"}"#]);
        let list = fx.store().remember(ID, "cmd", Some(r"C:\pane".into())).unwrap();
        assert_eq!(list[0].cwd.as_deref(), Some(r"C:\pane"));
        assert_eq!(list[0].title.as_deref(), Some("add dark mode"));

        let other = "0b62fa9b-7001-4bed-a5e0-7d951d9700b1";
        let list = fx.store().remember(other, "cmd", None).unwrap();
        assert_eq!((list[0].cwd.clone(), list[0].title.clone()), (None, None), "no transcript at all");
    }

    #[test]
    fn newest_first_without_duplicates_and_persisted() {
        let fx = Fixture::new("order");
        let other = "0b62fa9b-7001-4bed-a5e0-7d951d9700b1";
        let store = fx.store();
        store.remember(ID, "pwsh", None).unwrap();
        store.remember(other, "pwsh", None).unwrap();
        let list = store.remember(&ID.to_uppercase(), "pwsh", None).unwrap();
        assert_eq!(list.iter().map(|s| s.id.as_str()).collect::<Vec<_>>(), [ID, other]);

        let reloaded = fx.store().list();
        assert_eq!(reloaded, list);
        assert_eq!(fx.store().forget(&[ID.to_string()]).unwrap().len(), 1);
        assert!(fx.store().forget(&[ID.to_string(), other.to_string()]).unwrap().is_empty());
    }

    #[test]
    fn rejects_anything_but_a_session_id() {
        let fx = Fixture::new("reject");
        for bad in ["../../secrets", "4c766d1a-f139-42df-90f0-a04fe20d305", "4c766d1a_f139_42df_90f0_a04fe20d3056"] {
            assert!(fx.store().remember(bad, "pwsh", None).is_err(), "{bad}");
        }
    }

    #[test]
    fn caps_the_list() {
        let fx = Fixture::new("cap");
        let store = fx.store();
        for i in 0..MAX_SESSIONS + 5 {
            store.remember(&format!("00000000-0000-0000-0000-{i:012}"), "pwsh", None).unwrap();
        }
        assert_eq!(store.list().len(), MAX_SESSIONS);
    }

    #[test]
    fn summarizes_every_transcript_and_caches_until_it_changes() {
        let fx = Fixture::new("index");
        let other = "0b62fa9b-7001-4bed-a5e0-7d951d9700b1";
        fx.transcript(ID, &[
            r#"{"type":"user","cwd":"C:\\work\\app","gitBranch":"main","message":{"role":"user","content":"add login"}}"#,
            r#"{"type":"user","isMeta":true,"message":{"role":"user","content":"<meta>"}}"#,
            r#"{"type":"user","message":{"role":"user","content":[{"type":"tool_result"}]}}"#,
            r#"{"type":"user","gitBranch":"feat/login","message":{"role":"user","content":"now tests"}}"#,
            r#"{"type":"ai-title","aiTitle":"Login feature"}"#,
            r#"{"type":"last-prompt","lastPrompt":"now tests"}"#,
        ]);
        fx.transcript(other, &[r#"{"type":"system","cwd":"C:\\x"}"#]);
        let index = TranscriptIndex::default();
        let home = fx.root.join("claude");

        let all = index.scan(&home);
        assert_eq!(all.len(), 1, "a session without typed messages is left out");
        let s = &all[0];
        assert_eq!((s.cwd.as_deref(), s.title.as_deref()), (Some(r"C:\work\app"), Some("Login feature")));
        assert_eq!((s.git_branch.as_deref(), s.prompts, s.last_prompt.as_deref()), (Some("feat/login"), 2, Some("now tests")));

        std::thread::sleep(std::time::Duration::from_millis(20));
        fx.transcript(ID, &[r#"{"type":"user","cwd":"C:\\other","message":{"role":"user","content":"hi"}}"#]);
        assert_eq!(index.scan(&home)[0].cwd.as_deref(), Some(r"C:\other"), "re-read after a change");
    }

    #[test]
    fn shortens_long_titles_on_a_char_boundary() {
        assert_eq!(shorten("żółw".repeat(30).as_str(), 5), "żółwż…");
        assert_eq!(shorten("short", 80), "short");
    }
}
