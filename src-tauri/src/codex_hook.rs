//! Optional Codex CLI hooks; other user hooks are preserved and backed up.
use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::{Map, Value, json};
use base64::{Engine, engine::general_purpose::STANDARD as BASE64};

pub const HOOK_ARG: &str = "--codex-notify";

/// The hook events qterm listens to, all handled by the same command.
const EVENTS: [&str; 6] = [
    "SessionStart",
    "UserPromptSubmit",
    "PermissionRequest",
    "PostToolUse",
    "Stop",
    "Interrupt",
];

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HookStatus {
    pub installed: bool,
    /// Installed and pointing at this qterm (the exe may have moved since).
    pub current: bool,
    pub settings_path: String,
}

pub fn settings_path(codex_home: &Path) -> PathBuf {
    codex_home.join("hooks.json")
}

/// Codex runs Windows hooks through a shell. An explicit PowerShell invocation
/// works from PowerShell, cmd and bash; encoded input keeps paths literal even
/// when they contain spaces, apostrophes, dollar signs or shell metacharacters.
pub fn command_for(exe: &Path) -> String {
    let path = exe.to_string_lossy().replace('\\', "/").replace('\'', "''");
    let script = format!("& '{path}' {HOOK_ARG}");
    let encoded = BASE64.encode(script.encode_utf16().flat_map(u16::to_le_bytes).collect::<Vec<_>>());
    format!("powershell.exe -NoLogo -NoProfile -NonInteractive -EncodedCommand {encoded}")
}

/// Installed: any of qterm's hooks is there. Current: every event has this exe's
/// command, so incomplete or moved installations can be updated.
pub fn status(settings: &Path, command: &str) -> Result<HookStatus, String> {
    let doc = read(settings)?;
    Ok(HookStatus {
        installed: EVENTS
            .iter()
            .any(|event| !qterm_commands(&doc, event).is_empty()),
        current: EVENTS
            .iter()
            .all(|event| qterm_commands(&doc, event).iter().any(|c| c == command)),
        settings_path: settings.to_string_lossy().into_owned(),
    })
}

/// Adds (or re-points) the hook; any older qterm entries are replaced.
pub fn install(settings: &Path, command: &str) -> Result<(), String> {
    let mut doc = read(settings)?;
    remove_ours(&mut doc);
    let root = doc
        .as_object_mut()
        .ok_or("hooks.json is not a JSON object")?;
    let hooks = root
        .entry("hooks")
        .or_insert_with(|| json!({}))
        .as_object_mut()
        .ok_or("\"hooks\" is not an object")?;
    for event in EVENTS {
        hooks
            .entry(event)
            .or_insert_with(|| json!([]))
            .as_array_mut()
            .ok_or(format!("\"hooks.{event}\" is not a list"))?
            .push(json!({ "hooks": [{ "type": "command", "command": command, "timeout": if event == "Interrupt" { 3 } else { 10 } }] }));
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
    if command.contains(HOOK_ARG) {
        return true;
    }
    let Some(encoded) = command.strip_prefix("powershell.exe -NoLogo -NoProfile -NonInteractive -EncodedCommand ") else {
        return false;
    };
    let Ok(bytes) = BASE64.decode(encoded) else { return false };
    let (pairs, remainder) = bytes.as_chunks::<2>();
    if !remainder.is_empty() { return false; }
    let units = pairs.iter().map(|b| u16::from_le_bytes(*b)).collect::<Vec<_>>();
    String::from_utf16(&units).is_ok_and(|script| script.starts_with("& '") && script.ends_with(&format!("' {HOOK_ARG}")))
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
    let Some(groups) = doc
        .pointer_mut(&format!("/hooks/{event}"))
        .and_then(Value::as_array_mut)
    else {
        return false;
    };
    let before = groups.len();
    let mut changed = false;
    for group in groups.iter_mut() {
        if let Some(hooks) = group.get_mut("hooks").and_then(Value::as_array_mut) {
            let n = hooks.len();
            hooks.retain(|h| {
                !h.get("command")
                    .and_then(Value::as_str)
                    .is_some_and(is_ours)
            });
            changed |= hooks.len() != n;
        }
    }
    groups.retain(|g| {
        g.get("hooks")
            .and_then(Value::as_array)
            .is_none_or(|h| !h.is_empty())
    });
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
        Ok(text) => serde_json::from_str(&text).map_err(|e| {
            format!(
                "{} is not valid JSON ({e}); not changing it",
                settings.display()
            )
        }),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Value::Object(Map::new())),
        Err(e) => Err(format!("could not read {}: {e}", settings.display())),
    }
}

/// Keeps the previous version as hooks.json.qterm-backup.
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
    const CMD: &str = "\"C:/apps/qterm.exe\" --codex-notify";
    #[test]
    fn command_quotes_the_executable_for_powershell_without_outer_shell_expansion() {
        let command = command_for(Path::new("C:\\apps $work\\it's qterm\\qterm.exe"));
        let encoded = command.split("-EncodedCommand ").nth(1).unwrap().split_whitespace().next().unwrap();
        let bytes = BASE64.decode(encoded).unwrap();
        let units = bytes.as_chunks::<2>().0.iter().map(|b| u16::from_le_bytes(*b)).collect::<Vec<_>>();
        assert_eq!(String::from_utf16(&units).unwrap(), "& 'C:/apps $work/it''s qterm/qterm.exe' --codex-notify");
        assert!(is_ours(&command));
    }
    fn fixture(name: &str, contents: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("qterm-codex-hook-{name}-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("hooks.json");
        std::fs::write(&path, contents).unwrap();
        path
    }
    #[test]
    fn install_update_remove_preserve_other_hooks_and_backup() {
        let original = r#"{"description":"Mine","hooks":{"Stop":[{"hooks":[{"type":"command","command":"say hi"}]}],"SubagentStop":[{"hooks":[{"type":"command","command":"other"}]}]}}"#;
        let path = fixture("preserve", original);
        install(&path, CMD).unwrap();
        assert!(status(&path, CMD).unwrap().current);
        assert_eq!(
            std::fs::read_to_string(path.with_extension("json.qterm-backup")).unwrap(),
            original
        );
        install(&path, CMD).unwrap();
        assert_eq!(qterm_commands(&read(&path).unwrap(), "Stop"), [CMD]);
        let moved = "\"D:/moved/qterm.exe\" --codex-notify";
        assert!(!status(&path, moved).unwrap().current);
        install(&path, moved).unwrap();
        assert_eq!(qterm_commands(&read(&path).unwrap(), "Stop"), [moved]);
        remove(&path).unwrap();
        assert_eq!(
            read(&path).unwrap(),
            serde_json::from_str::<Value>(original).unwrap()
        );
        std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }
    #[test]
    fn malformed_files_are_not_overwritten() {
        let path = fixture("invalid", "{broken");
        assert!(install(&path, CMD).is_err());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "{broken");
        std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }
}
