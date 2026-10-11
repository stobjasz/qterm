//! Claude Code sessions qterm has seen in its terminals ("claude --resume <id>"),
//! kept so they can be resumed later in the folder they ran in.
//!
//! The folder and a title come from Claude Code's own transcript,
//! `<claude home>/projects/<encoded folder>/<id>.jsonl`. Its first `cwd` is
//! where the session was started, which is where `claude --resume` must run.

use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

const FILE_NAME: &str = "claude-sessions.json";
/// Oldest entries drop off beyond this.
const MAX_SESSIONS: usize = 50;
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
        let (cwd, title) = self
            .claude_home
            .as_deref()
            .and_then(|home| find_transcript(home, &id))
            .map(|path| read_transcript(&path))
            .unwrap_or_default();
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

    pub fn forget(&self, id: &str) -> Result<Vec<ClaudeSession>, String> {
        let mut sessions = self.sessions.lock().unwrap();
        sessions.retain(|s| s.id != id);
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

/// The first `cwd` (where the session started) and the latest title. Lines are only
/// parsed when they can contain what we need; transcripts get large.
fn read_transcript(path: &Path) -> (Option<String>, Option<String>) {
    let Ok(file) = std::fs::File::open(path) else { return (None, None) };
    let (mut cwd, mut ai_title, mut last_prompt) = (None, None, None);
    for line in BufReader::new(file).lines().map_while(Result::ok) {
        let wants_cwd = cwd.is_none() && line.contains("\"cwd\"");
        let wants_title = line.contains("\"aiTitle\"") || line.contains("\"lastPrompt\"");
        if !wants_cwd && !wants_title {
            continue;
        }
        let Ok(record) = serde_json::from_str::<serde_json::Value>(&line) else { continue };
        let text = |key: &str| record.get(key).and_then(|v| v.as_str()).map(str::to_string);
        if wants_cwd {
            cwd = text("cwd");
        }
        ai_title = text("aiTitle").or(ai_title);
        last_prompt = text("lastPrompt").or(last_prompt);
    }
    let title = ai_title.or(last_prompt).map(|t| shorten(t.trim(), TITLE_MAX_CHARS)).filter(|t| !t.is_empty());
    (cwd, title)
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
        assert_eq!(fx.store().forget(ID).unwrap().len(), 1);
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
    fn shortens_long_titles_on_a_char_boundary() {
        assert_eq!(shorten("żółw".repeat(30).as_str(), 5), "żółwż…");
        assert_eq!(shorten("short", 80), "short");
    }
}
