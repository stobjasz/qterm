//! Adds or removes qterm's hooks in Claude Code's settings.json: Notification
//! (Claude is waiting for you), Stop (a turn ended: Claude's last reply, shown on
//! the tab), StopFailure (a turn ended on an API error) and SessionStart (which session and transcript a pane runs, for its token use). Everything else in the file is kept, in its
//! original order (serde_json's preserve_order), and the previous file is backed
//! up before each change.

use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::{json, Map, Value};

use crate::alerts::HOOK_ARG;

/// The hook events qterm listens to, all handled by the same command.
const EVENTS: [&str; 4] = ["Notification", "SessionStart", "Stop", "StopFailure"];

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HookStatus {
    pub installed: bool,
    /// Installed and pointing at this qterm (the exe may have moved since).
    pub current: bool,
    pub settings_path: String,
}

pub fn settings_path(claude_home: &Path) -> PathBuf {
    claude_home.join("settings.json")
}

/// The hook command for this exe. Forward slashes work in both bash and cmd.
pub fn command_for(exe: &Path) -> String {
    format!("\"{}\" {HOOK_ARG}", exe.to_string_lossy().replace('\\', "/"))
}

/// Installed: any of qterm's hooks is there. Current: every event has this exe's
/// command (an older qterm set up only Notification, so it needs an update).
pub fn status(settings: &Path, command: &str) -> Result<HookStatus, String> {
    let doc = read(settings)?;
    Ok(HookStatus {
        installed: EVENTS.iter().any(|event| !qterm_commands(&doc, event).is_empty()),
        current: EVENTS.iter().all(|event| qterm_commands(&doc, event).iter().any(|c| c == command)),
        settings_path: settings.to_string_lossy().into_owned(),
    })
}

/// Adds (or re-points) the hook; any older qterm entries are replaced.
pub fn install(settings: &Path, command: &str) -> Result<(), String> {
    let mut doc = read(settings)?;
    remove_ours(&mut doc);
    let root = doc.as_object_mut().ok_or("settings.json is not a JSON object")?;
    let hooks = root.entry("hooks").or_insert_with(|| json!({})).as_object_mut().ok_or("\"hooks\" is not an object")?;
    for event in EVENTS {
        hooks
            .entry(event)
            .or_insert_with(|| json!([]))
            .as_array_mut()
            .ok_or(format!("\"hooks.{event}\" is not a list"))?
            .push(json!({ "matcher": "", "hooks": [{ "type": "command", "command": command }] }));
    }
    write(settings, &doc)
}

pub fn remove(settings: &Path) -> Result<(), String> {
    let mut doc = read(settings)?;
    if remove_ours(&mut doc) {
        write(settings, &doc)?;
    }
    Ok(())
}

fn is_ours(command: &str) -> bool {
    command.contains(HOOK_ARG)
}

fn qterm_commands(doc: &Value, event: &str) -> Vec<String> {
    doc.pointer(&format!("/hooks/{event}"))
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|group| group.get("hooks").and_then(Value::as_array))
        .flatten()
        .filter_map(|hook| hook.get("command").and_then(Value::as_str))
        .filter(|c| is_ours(c))
        .map(str::to_string)
        .collect()
}

/// Drops qterm's hooks, and any matcher group or event list left empty.
fn remove_ours(doc: &mut Value) -> bool {
    let mut changed = false;
    for event in EVENTS {
        changed |= remove_ours_from(doc, event);
    }
    changed
}

fn remove_ours_from(doc: &mut Value, event: &str) -> bool {
    let Some(groups) = doc.pointer_mut(&format!("/hooks/{event}")).and_then(Value::as_array_mut) else {
        return false;
    };
    let before = groups.len();
    let mut changed = false;
    for group in groups.iter_mut() {
        if let Some(hooks) = group.get_mut("hooks").and_then(Value::as_array_mut) {
            let n = hooks.len();
            hooks.retain(|h| !h.get("command").and_then(Value::as_str).is_some_and(is_ours));
            changed |= hooks.len() != n;
        }
    }
    groups.retain(|g| g.get("hooks").and_then(Value::as_array).is_none_or(|h| !h.is_empty()));
    changed |= groups.len() != before;
    if groups.is_empty()
        && let Some(hooks) = doc.get_mut("hooks").and_then(Value::as_object_mut)
    {
        hooks.remove(event);
        if hooks.is_empty() {
            doc.as_object_mut().map(|root| root.remove("hooks"));
        }
    }
    changed
}

pub(crate) fn read(settings: &Path) -> Result<Value, String> {
    match std::fs::read_to_string(settings) {
        Ok(text) if text.trim().is_empty() => Ok(Value::Object(Map::new())),
        Ok(text) => serde_json::from_str(&text)
            .map_err(|e| format!("{} is not valid JSON ({e}); not changing it", settings.display())),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Value::Object(Map::new())),
        Err(e) => Err(format!("could not read {}: {e}", settings.display())),
    }
}

/// Keeps the previous version as settings.json.qterm-backup.
pub(crate) fn write(settings: &Path, doc: &Value) -> Result<(), String> {
    if settings.exists() {
        std::fs::copy(settings, settings.with_extension("json.qterm-backup"))
            .map_err(|e| format!("could not back up {}: {e}", settings.display()))?;
    }
    let text = serde_json::to_string_pretty(doc).map_err(|e| e.to_string())? + "\n";
    crate::claude::write_atomically(settings, &text)
}

#[cfg(test)]
mod tests {
    use super::*;

    const CMD: &str = "\"C:/apps/qterm.exe\" --claude-notify";

    fn fixture(name: &str, content: Option<&str>) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("qterm-hook-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("settings.json");
        if let Some(content) = content {
            std::fs::write(&path, content).unwrap();
        }
        path
    }

    #[test]
    fn installs_next_to_existing_settings_and_hooks_keeping_their_order() {
        let path = fixture(
            "install",
            Some(r#"{"model":"opus","hooks":{"Notification":[{"matcher":"","hooks":[{"type":"command","command":"say hi"}]}],"Stop":[]},"zeta":1}"#),
        );
        install(&path, CMD).unwrap();
        let text = std::fs::read_to_string(&path).unwrap();
        let doc: Value = serde_json::from_str(&text).unwrap();

        let keys: Vec<&String> = doc.as_object().unwrap().keys().collect();
        assert_eq!(keys, ["model", "hooks", "zeta"], "order kept");
        assert_eq!(doc.pointer("/hooks/Notification/0/hooks/0/command").unwrap(), "say hi");
        assert_eq!(doc.pointer("/hooks/Notification/1/hooks/0/command").unwrap(), CMD);
        assert_eq!(doc.pointer("/hooks/SessionStart/0/hooks/0/command").unwrap(), CMD);
        assert!(doc.pointer("/hooks/Stop").is_some());
        assert!(path.with_extension("json.qterm-backup").exists());

        let status = status(&path, CMD).unwrap();
        assert!(status.installed && status.current);
    }

    #[test]
    fn reinstalling_from_a_moved_exe_replaces_the_old_entry() {
        let path = fixture("move", None);
        install(&path, "\"D:/old/qterm.exe\" --claude-notify").unwrap();
        assert_eq!(status(&path, CMD).unwrap(), HookStatus { installed: true, current: false, settings_path: path.to_string_lossy().into() });
        install(&path, CMD).unwrap();
        let doc = read(&path).unwrap();
        assert_eq!(qterm_commands(&doc, "Notification"), [CMD]);
        assert_eq!(qterm_commands(&doc, "SessionStart"), [CMD]);
    }

    #[test]
    fn an_older_notification_only_setup_needs_an_update() {
        let path = fixture("older", Some(&format!(r#"{{"hooks":{{"Notification":[{{"matcher":"","hooks":[{{"type":"command","command":{CMD:?}}}]}}]}}}}"#)));
        let before = status(&path, CMD).unwrap();
        assert!(before.installed && !before.current);
        install(&path, CMD).unwrap();
        assert!(status(&path, CMD).unwrap().current);
        assert_eq!(qterm_commands(&read(&path).unwrap(), "Notification"), [CMD], "not added twice");
    }

    #[test]
    fn removing_leaves_other_hooks_and_cleans_up_empty_parts() {
        let path = fixture("remove", Some(r#"{"hooks":{"Notification":[{"matcher":"","hooks":[{"type":"command","command":"say hi"}]}]}}"#));
        install(&path, CMD).unwrap();
        remove(&path).unwrap();
        let doc = read(&path).unwrap();
        assert_eq!(doc, json!({"hooks":{"Notification":[{"matcher":"","hooks":[{"type":"command","command":"say hi"}]}]}}));

        let fresh = fixture("remove-fresh", None);
        install(&fresh, CMD).unwrap();
        remove(&fresh).unwrap();
        assert_eq!(read(&fresh).unwrap(), json!({}));
    }

    #[test]
    fn refuses_to_touch_invalid_json() {
        let path = fixture("invalid", Some("{ not json"));
        assert!(install(&path, CMD).unwrap_err().contains("not valid JSON"));
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "{ not json");
    }

    #[test]
    fn hook_command_uses_forward_slashes_and_quotes() {
        assert_eq!(command_for(Path::new(r"C:\My Apps\qterm.exe")), "\"C:/My Apps/qterm.exe\" --claude-notify");
    }
}
