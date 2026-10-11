//! "Claude needs you" alerts. Claude Code runs its Notification hook, which is
//! qterm's own exe with `--claude-notify` (see claude_hook.rs). That short-lived
//! process reads the hook's JSON from stdin, tags it with the pane it came from
//! (`QTERM_PANE`, set on every shell qterm starts), drops it in an inbox folder
//! and exits. The running qterm watches the inbox and tells the UI, which decides
//! whether a Windows notification is needed.

use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::Duration;

use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tauri_winrt_notification::{Sound, Toast};

/// The argument that turns the exe into the hook.
pub const HOOK_ARG: &str = "--claude-notify";
/// Set on every shell qterm starts, so the hook knows which pane it serves.
pub const PANE_ENV: &str = "QTERM_PANE";
/// Same as tauri.conf.json's identifier: the inbox lives in its local data folder,
/// and Windows shows notifications under this app id.
const APP_ID: &str = "dev.qterm.app";
const INBOX: &str = "alerts";
/// Larger hook input than this is not a notification.
const MAX_INPUT: u64 = 1 << 20;
/// Claude Code writes the input and closes the pipe at once; if a caller never
/// closes it, give up instead of lingering.
const INPUT_TIMEOUT: Duration = Duration::from_secs(5);

/// One alert as the UI sees it.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Alert {
    pub pane_id: String,
    pub title: Option<String>,
    pub message: String,
    /// Claude's notification_type, e.g. "permission_prompt" or "idle_prompt".
    pub kind: Option<String>,
    pub session_id: Option<String>,
}

/// The fields of Claude Code's Notification hook input that matter here.
#[derive(Deserialize)]
struct HookInput {
    message: Option<String>,
    title: Option<String>,
    notification_type: Option<String>,
    session_id: Option<String>,
}

/// Hook mode: never fails loudly, since a failing hook would bother Claude Code.
/// Outside qterm (no `QTERM_PANE`) it does nothing at all.
pub fn run_hook() {
    let Ok(pane_id) = std::env::var(PANE_ENV) else { return };
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let mut input = String::new();
        let ok = std::io::stdin().take(MAX_INPUT).read_to_string(&mut input).is_ok();
        let _ = tx.send(ok.then_some(input));
    });
    let Ok(Some(input)) = rx.recv_timeout(INPUT_TIMEOUT) else { return };
    let Some(alert) = alert_from_hook(&pane_id, &input) else { return };
    if let Some(inbox) = inbox_dir() {
        let _ = deliver(&inbox, &alert);
    }
}

fn alert_from_hook(pane_id: &str, input: &str) -> Option<Alert> {
    let hook: HookInput = serde_json::from_str(input).ok()?;
    Some(Alert {
        pane_id: pane_id.to_string(),
        title: hook.title,
        message: hook.message.unwrap_or_else(|| "Claude Code needs your attention".into()),
        kind: hook.notification_type,
        session_id: hook.session_id,
    })
}

fn inbox_dir() -> Option<PathBuf> {
    Some(PathBuf::from(std::env::var_os("LOCALAPPDATA")?).join(APP_ID).join(INBOX))
}

/// Written under a temporary name and renamed, so the watcher never reads half a file.
fn deliver(inbox: &Path, alert: &Alert) -> std::io::Result<()> {
    std::fs::create_dir_all(inbox)?;
    let name = format!("{}-{}", std::process::id(), uuid_like());
    let partial = inbox.join(format!("{name}.partial"));
    std::fs::write(&partial, serde_json::to_vec(alert)?)?;
    std::fs::rename(partial, inbox.join(format!("{name}.json")))
}

fn uuid_like() -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or_default();
    format!("{nanos:x}")
}

/// Reads, deletes and returns the alerts waiting in the inbox, oldest first.
fn take_inbox(inbox: &Path) -> Vec<Alert> {
    let Ok(entries) = std::fs::read_dir(inbox) else { return Vec::new() };
    let mut files: Vec<PathBuf> = entries
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|ext| ext == "json"))
        .collect();
    files.sort();
    files
        .into_iter()
        .filter_map(|file| {
            let alert = std::fs::read(&file).ok().and_then(|bytes| serde_json::from_slice(&bytes).ok());
            let _ = std::fs::remove_file(&file);
            alert
        })
        .collect()
}

/// Watches the inbox and emits each alert to the UI as `claude-attention`.
/// Alerts left over from before this start are stale and dropped.
pub fn watch_inbox(app: AppHandle) -> notify::Result<RecommendedWatcher> {
    let inbox = inbox_dir().ok_or_else(|| notify::Error::generic("no LOCALAPPDATA"))?;
    std::fs::create_dir_all(&inbox).map_err(notify::Error::io)?;
    take_inbox(&inbox);

    let (tx, rx) = std::sync::mpsc::channel::<()>();
    let mut watcher = notify::recommended_watcher(move |_event: notify::Result<notify::Event>| {
        let _ = tx.send(());
    })?;
    watcher.watch(&inbox, RecursiveMode::NonRecursive)?;
    std::thread::spawn(move || {
        while rx.recv().is_ok() {
            while rx.recv_timeout(Duration::from_millis(30)).is_ok() {}
            for alert in take_inbox(&inbox) {
                let _ = app.emit("claude-attention", alert);
            }
        }
    });
    Ok(watcher)
}

/// A Windows notification; clicking it brings the console up on that pane.
pub fn show_notification(app: &AppHandle, alert: &Alert) -> Result<(), String> {
    let app_id = registered_app_id(app);
    let pane = alert.pane_id.clone();
    let app = app.clone();
    Toast::new(&app_id)
        .title(alert.title.as_deref().unwrap_or("Claude Code"))
        .text1(&alert.message)
        .sound(Some(Sound::Default))
        .on_activated(move |_| {
            crate::window::focus_pane(&app, &pane);
            Ok(())
        })
        .show()
        .map_err(|e| format!("could not show the notification: {e}"))
}

/// Windows shows notifications of unpackaged apps under an app id registered in
/// HKCU (name and icon). Registered once per run; PowerShell's id if that fails.
fn registered_app_id(app: &AppHandle) -> String {
    static REGISTERED: OnceLock<bool> = OnceLock::new();
    if *REGISTERED.get_or_init(|| register_app_id(app).is_ok()) {
        APP_ID.to_string()
    } else {
        Toast::POWERSHELL_APP_ID.to_string()
    }
}

fn register_app_id(app: &AppHandle) -> Result<(), String> {
    use tauri::Manager;
    let icon = app.path().app_local_data_dir().map_err(|e| e.to_string())?.join("qterm.png");
    if !icon.exists() {
        std::fs::write(&icon, include_bytes!("../icons/128x128.png")).map_err(|e| e.to_string())?;
    }
    let key = windows_registry::CURRENT_USER
        .create(format!(r"Software\Classes\AppUserModelId\{APP_ID}"))
        .map_err(|e| e.to_string())?;
    key.set_string("DisplayName", "qterm").map_err(|e| e.to_string())?;
    key.set_string("IconUri", icon.to_string_lossy()).map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_claude_codes_hook_input() {
        let input = r#"{"session_id":"abc","cwd":"C:\\x","hook_event_name":"Notification",
            "message":"Claude needs your permission to use Bash","title":"Permission needed",
            "notification_type":"permission_prompt"}"#;
        assert_eq!(
            alert_from_hook("pane-1", input),
            Some(Alert {
                pane_id: "pane-1".into(),
                title: Some("Permission needed".into()),
                message: "Claude needs your permission to use Bash".into(),
                kind: Some("permission_prompt".into()),
                session_id: Some("abc".into()),
            })
        );
    }

    #[test]
    fn tolerates_minimal_or_broken_input() {
        assert_eq!(alert_from_hook("p", "{}").unwrap().message, "Claude Code needs your attention");
        assert!(alert_from_hook("p", "not json").is_none());
    }

    #[test]
    fn inbox_round_trip_in_order_and_emptied() {
        let inbox = std::env::temp_dir().join(format!("qterm-inbox-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&inbox);
        let alert = |m: &str| Alert { pane_id: "p".into(), title: None, message: m.into(), kind: None, session_id: None };
        deliver(&inbox, &alert("first")).unwrap();
        std::thread::sleep(Duration::from_millis(5));
        deliver(&inbox, &alert("second")).unwrap();
        std::fs::write(inbox.join("half.partial"), "{").unwrap();

        let taken: Vec<String> = take_inbox(&inbox).into_iter().map(|a| a.message).collect();
        assert_eq!(taken, ["first", "second"]);
        assert!(take_inbox(&inbox).is_empty());
        let _ = std::fs::remove_dir_all(&inbox);
    }
}
