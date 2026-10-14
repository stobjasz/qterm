//! Claude Code's status line, relayed to qterm: Claude Code runs its status line
//! command with the session's figures on stdin (context, cost, the plan's 5-hour and
//! 7-day usage, prompt cache). With this set up, that command is qterm's own exe with
//! `--claude-statusline`: it drops the figures in the inbox of the qterm whose pane
//! runs the session (like the hooks, see alerts.rs) and prints the status line.
//!
//! A status line of your own keeps working: qterm goes first in a pipe,
//! `qterm --claude-statusline --pass | <your command>`, and passes the input on
//! unchanged. Removing qterm's puts your command back as it was.

use std::io::{Read, Write};
use std::path::Path;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

pub const STATUSLINE_ARG: &str = "--claude-statusline";
const PASS_ARG: &str = "--pass";
const MAX_INPUT: u64 = 1 << 20;
const INPUT_TIMEOUT: Duration = Duration::from_secs(5);

/// A plan usage window (5-hour or 7-day).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Limit {
    pub used_percent: f64,
    /// Unix seconds.
    pub resets_at: Option<u64>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Cache {
    pub warm: bool,
    /// Unix seconds when the cached prefix goes cold.
    pub expires_at: Option<u64>,
}

/// What a status line run tells qterm about the session in a pane.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StatuslineUsage {
    pub pane_id: String,
    pub session_id: Option<String>,
    pub model_id: Option<String>,
    pub model_name: Option<String>,
    pub context_tokens: Option<u64>,
    pub context_limit: Option<u64>,
    pub context_percent: Option<f64>,
    pub cost_usd: Option<f64>,
    pub five_hour: Option<Limit>,
    pub seven_day: Option<Limit>,
    pub cache: Option<Cache>,
}

/// Reads Claude Code's status line input.
pub fn usage_from_input(pane_id: &str, input: &Value) -> StatuslineUsage {
    let num = |path: &str| input.pointer(path).and_then(Value::as_f64);
    let int = |path: &str| input.pointer(path).and_then(Value::as_u64);
    let text = |path: &str| input.pointer(path).and_then(Value::as_str).map(str::to_string);
    let limit = |name: &str| {
        num(&format!("/rate_limits/{name}/used_percentage"))
            .map(|used_percent| Limit { used_percent, resets_at: int(&format!("/rate_limits/{name}/resets_at")) })
    };
    StatuslineUsage {
        pane_id: pane_id.to_string(),
        session_id: text("/session_id"),
        model_id: text("/model/id"),
        model_name: text("/model/display_name"),
        context_tokens: int("/context_window/total_input_tokens"),
        context_limit: int("/context_window/context_window_size"),
        context_percent: num("/context_window/used_percentage"),
        cost_usd: num("/cost/total_cost_usd"),
        five_hour: limit("five_hour"),
        seven_day: limit("seven_day"),
        cache: input.pointer("/prompt_cache/warm").and_then(Value::as_bool).map(|warm| Cache { warm, expires_at: int("/prompt_cache/expires_at") }),
    }
}

/// qterm's own status line: model, context, plan usage.
pub fn default_line(usage: &StatuslineUsage) -> String {
    let mut parts: Vec<String> = Vec::new();
    if let Some(model) = &usage.model_name {
        parts.push(model.clone());
    }
    if let Some(percent) = usage.context_percent {
        parts.push(format!("{percent:.0}% context"));
    }
    if let Some(limit) = &usage.five_hour {
        parts.push(format!("5h {:.0}%", limit.used_percent));
    }
    if let Some(limit) = &usage.seven_day {
        parts.push(format!("7d {:.0}%", limit.used_percent));
    }
    parts.join(" · ")
}

/// Status line mode: never fails loudly. Outside qterm it only prints (or passes on).
pub fn run(args: &[String]) {
    let pass = args.iter().any(|a| a == PASS_ARG);
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let mut input = String::new();
        let ok = std::io::stdin().take(MAX_INPUT).read_to_string(&mut input).is_ok();
        let _ = tx.send(ok.then_some(input));
    });
    let Ok(Some(input)) = rx.recv_timeout(INPUT_TIMEOUT) else { return };
    let parsed: Value = serde_json::from_str(&input).unwrap_or(Value::Null);
    let pane = std::env::var(crate::alerts::PANE_ENV).ok();
    let usage = usage_from_input(pane.as_deref().unwrap_or(""), &parsed);
    if pane.is_some() {
        crate::alerts::deliver_usage(&usage);
    }
    let mut out = std::io::stdout();
    let _ = if pass { out.write_all(input.as_bytes()) } else { writeln!(out, "{}", default_line(&usage)) };
}

// --- settings.json: install, remove, status ------------------------------------------

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatuslineStatus {
    /// qterm's status line is set (for any qterm location).
    pub installed: bool,
    /// Set and pointing at this qterm.
    pub current: bool,
    /// A status line of the user's own: the one qterm passes the input on to, or the
    /// one that would be kept when setting qterm's up.
    pub own_command: Option<String>,
}

/// The command for this exe. Quoted only when the path has a space: a quoted program
/// doesn't start a PowerShell command line, and Claude Code uses PowerShell on PCs
/// without Git Bash.
pub fn command_for(exe: &Path, own: Option<&str>) -> String {
    let path = exe.to_string_lossy().replace('\\', "/");
    let program = if path.contains(' ') { format!("\"{path}\"") } else { path };
    match own {
        Some(own) => format!("{program} {STATUSLINE_ARG} {PASS_ARG} | {own}"),
        None => format!("{program} {STATUSLINE_ARG}"),
    }
}

/// qterm's part of a status line command, and the user's own command after it, if any.
fn split_ours(command: &str) -> Option<Option<String>> {
    if !command.contains(STATUSLINE_ARG) {
        return None;
    }
    Some(command.split_once(" | ").map(|(_, own)| own.trim().to_string()).filter(|own| !own.is_empty()))
}

fn current_command(doc: &Value) -> Option<String> {
    doc.pointer("/statusLine/command").and_then(Value::as_str).map(str::to_string)
}

pub fn status(settings: &Path, exe: &Path) -> Result<StatuslineStatus, String> {
    let doc = crate::claude_hook::read(settings)?;
    let command = current_command(&doc);
    Ok(match command.as_deref().map(|c| (c, split_ours(c))) {
        Some((command, Some(own))) => StatuslineStatus {
            installed: true,
            current: command == command_for(exe, own.as_deref()),
            own_command: own,
        },
        Some((command, None)) => StatuslineStatus { installed: false, current: false, own_command: Some(command.to_string()) },
        None => StatuslineStatus { installed: false, current: false, own_command: None },
    })
}

pub fn install(settings: &Path, exe: &Path) -> Result<(), String> {
    let mut doc = crate::claude_hook::read(settings)?;
    let own = match current_command(&doc) {
        Some(command) => split_ours(&command).unwrap_or(Some(command)),
        None => None,
    };
    let root = doc.as_object_mut().ok_or("settings.json is not a JSON object")?;
    let line = root.entry("statusLine").or_insert_with(|| json!({ "type": "command" }));
    let line = line.as_object_mut().ok_or("\"statusLine\" is not an object")?;
    line.insert("type".into(), json!("command"));
    line.insert("command".into(), json!(command_for(exe, own.as_deref())));
    crate::claude_hook::write(settings, &doc)
}

/// Removes qterm's part: the user's own status line comes back, or none is left.
pub fn remove(settings: &Path) -> Result<(), String> {
    let mut doc = crate::claude_hook::read(settings)?;
    let Some(own) = current_command(&doc).and_then(|c| split_ours(&c)) else { return Ok(()) };
    let root = doc.as_object_mut().ok_or("settings.json is not a JSON object")?;
    match own {
        Some(own) => {
            if let Some(line) = root.get_mut("statusLine").and_then(Value::as_object_mut) {
                line.insert("command".into(), json!(own));
            }
        }
        None => {
            root.remove("statusLine");
        }
    }
    crate::claude_hook::write(settings, &doc)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(name: &str, content: Option<&str>) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("qterm-statusline-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("settings.json");
        if let Some(content) = content {
            std::fs::write(&path, content).unwrap();
        }
        path
    }

    const EXE: &str = r"C:\Users\me\AppData\Local\qterm\qterm.exe";

    #[test]
    fn quotes_the_exe_only_when_it_has_a_space() {
        assert_eq!(command_for(Path::new(EXE), None), "C:/Users/me/AppData/Local/qterm/qterm.exe --claude-statusline");
        assert_eq!(
            command_for(Path::new(r"C:\My Apps\qterm.exe"), Some("bash ~/.claude/line.sh")),
            "\"C:/My Apps/qterm.exe\" --claude-statusline --pass | bash ~/.claude/line.sh"
        );
    }

    #[test]
    fn keeps_an_own_status_line_behind_qterms_and_restores_it() {
        let path = fixture("own", Some(r#"{"statusLine":{"type":"command","command":"bash ~/.claude/line.sh","padding":1},"model":"opus"}"#));
        install(&path, Path::new(EXE)).unwrap();
        let doc = crate::claude_hook::read(&path).unwrap();
        assert_eq!(
            doc.pointer("/statusLine/command").unwrap(),
            "C:/Users/me/AppData/Local/qterm/qterm.exe --claude-statusline --pass | bash ~/.claude/line.sh"
        );
        assert_eq!(doc.pointer("/statusLine/padding").unwrap(), 1, "other fields kept");
        let s = status(&path, Path::new(EXE)).unwrap();
        assert!(s.installed && s.current);
        assert_eq!(s.own_command.as_deref(), Some("bash ~/.claude/line.sh"));

        // Setting up again (e.g. from a moved exe) doesn't nest qterm twice.
        install(&path, Path::new(r"D:\qterm.exe")).unwrap();
        assert_eq!(
            current_command(&crate::claude_hook::read(&path).unwrap()).unwrap(),
            "D:/qterm.exe --claude-statusline --pass | bash ~/.claude/line.sh"
        );

        remove(&path).unwrap();
        let doc = crate::claude_hook::read(&path).unwrap();
        assert_eq!(doc, json!({"statusLine":{"type":"command","command":"bash ~/.claude/line.sh","padding":1},"model":"opus"}));
    }

    #[test]
    fn without_an_own_status_line_removing_leaves_none() {
        let path = fixture("none", None);
        assert_eq!(status(&path, Path::new(EXE)).unwrap(), StatuslineStatus { installed: false, current: false, own_command: None });
        install(&path, Path::new(EXE)).unwrap();
        assert!(status(&path, Path::new(EXE)).unwrap().current);
        remove(&path).unwrap();
        assert_eq!(crate::claude_hook::read(&path).unwrap(), json!({}));
    }

    #[test]
    fn reads_the_figures_claude_code_passes() {
        let input = json!({
            "session_id": "s1",
            "model": {"id": "claude-opus-5-5", "display_name": "Opus 5.5"},
            "cost": {"total_cost_usd": 1.25},
            "context_window": {"total_input_tokens": 52000, "context_window_size": 1000000, "used_percentage": 5.2},
            "rate_limits": {"five_hour": {"used_percentage": 23.5, "resets_at": 1791970000u64}, "seven_day": {"used_percentage": 41}},
            "prompt_cache": {"warm": true, "expires_at": 1791960300u64}
        });
        let usage = usage_from_input("pane-1", &input);
        assert_eq!(usage.model_name.as_deref(), Some("Opus 5.5"));
        assert_eq!(usage.context_tokens, Some(52000));
        assert_eq!(usage.five_hour, Some(Limit { used_percent: 23.5, resets_at: Some(1791970000) }));
        assert_eq!(usage.seven_day, Some(Limit { used_percent: 41.0, resets_at: None }));
        assert_eq!(usage.cache, Some(Cache { warm: true, expires_at: Some(1791960300) }));
        assert_eq!(default_line(&usage), "Opus 5.5 · 5% context · 5h 24% · 7d 41%");
        // Nothing known: an empty line, not a crash.
        assert_eq!(default_line(&usage_from_input("p", &Value::Null)), "");
    }
}
