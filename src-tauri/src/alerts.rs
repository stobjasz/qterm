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
/// Also set on every shell: the inbox of the qterm that started it, so the hook
/// reaches that instance even when several run (a dev or test build has its own
/// identifier, hence its own folder).
pub const INBOX_ENV: &str = "QTERM_INBOX";
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

/// Claude Code started (or resumed, cleared, compacted) a session in a pane: its
/// transcript is where that pane's token use is read from.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaneSession {
    pub pane_id: String,
    pub session_id: String,
    pub transcript_path: Option<String>,
}

/// What the hook leaves in the inbox.
#[derive(Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
enum InboxMessage {
    Alert(Alert),
    Session(PaneSession),
    /// From the status line relay (claude_statusline.rs).
    Usage(crate::claude_statusline::StatuslineUsage),
}

/// The fields of Claude Code's hook input that matter here.
#[derive(Deserialize)]
struct HookInput {
    hook_event_name: Option<String>,
    message: Option<String>,
    title: Option<String>,
    notification_type: Option<String>,
    session_id: Option<String>,
    transcript_path: Option<String>,
    /// StopFailure: the error type ("rate_limit", "overloaded", ...) and its details.
    error: Option<String>,
    error_details: Option<String>,
    last_assistant_message: Option<String>,
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
    let Some(message) = message_from_hook(&pane_id, &input) else { return };
    if let Some(inbox) = hook_inbox() {
        let _ = deliver(&inbox, &message);
    }
}

fn message_from_hook(pane_id: &str, input: &str) -> Option<InboxMessage> {
    let hook: HookInput = serde_json::from_str(input).ok()?;
    if hook.hook_event_name.as_deref() == Some("SessionStart") {
        return Some(InboxMessage::Session(PaneSession {
            pane_id: pane_id.to_string(),
            session_id: hook.session_id?,
            transcript_path: hook.transcript_path,
        }));
    }
    if hook.hook_event_name.as_deref() == Some("StopFailure") {
        let error = hook.error.unwrap_or_else(|| "unknown".into());
        let message = [hook.last_assistant_message, hook.error_details].into_iter().flatten().find(|m| !m.trim().is_empty());
        return Some(InboxMessage::Alert(Alert {
            pane_id: pane_id.to_string(),
            title: Some(format!("Claude stopped: {}", stop_reason(&error))),
            message: message.unwrap_or_else(|| format!("The turn ended with an API error ({error}).")),
            kind: Some(format!("stop_failure:{error}")),
            session_id: hook.session_id,
        }));
    }
    Some(InboxMessage::Alert(Alert {
        pane_id: pane_id.to_string(),
        title: hook.title,
        message: hook.message.unwrap_or_else(|| "Claude Code needs your attention".into()),
        kind: hook.notification_type,
        session_id: hook.session_id,
    }))
}

/// StopFailure's error type, in words.
fn stop_reason(error: &str) -> &str {
    match error {
        "rate_limit" => "rate limit reached",
        "overloaded" => "the API is overloaded",
        "billing_error" => "a billing problem",
        "authentication_failed" | "oauth_org_not_allowed" | "cloud_credential_error" => "sign-in failed",
        "account_on_hold" => "the account is on hold",
        "invalid_request" => "an invalid request",
        "model_not_found" => "the model isn't available",
        "server_error" => "an API server error",
        "max_output_tokens" => "the reply hit its length limit",
        _ => "an API error",
    }
}

/// The status line relay's figures, to the inbox of the qterm running the pane.
pub fn deliver_usage(usage: &crate::claude_statusline::StatuslineUsage) {
    if let Some(inbox) = hook_inbox() {
        let _ = deliver(&inbox, &InboxMessage::Usage(usage.clone()));
    }
}

/// Where the hook delivers: the inbox its shell was given, else the installed
/// qterm's (a shell started before QTERM_INBOX existed).
fn hook_inbox() -> Option<PathBuf> {
    std::env::var_os(INBOX_ENV)
        .map(PathBuf::from)
        .or_else(|| Some(PathBuf::from(std::env::var_os("LOCALAPPDATA")?).join(APP_ID).join(INBOX)))
}

/// This instance's inbox, under its own local data folder.
pub fn inbox_dir(app: &AppHandle) -> Option<PathBuf> {
    use tauri::Manager;
    Some(app.path().app_local_data_dir().ok()?.join(INBOX))
}

/// Written under a temporary name and renamed, so the watcher never reads half a file.
fn deliver(inbox: &Path, message: &InboxMessage) -> std::io::Result<()> {
    std::fs::create_dir_all(inbox)?;
    let name = format!("{}-{}", std::process::id(), uuid_like());
    let partial = inbox.join(format!("{name}.partial"));
    std::fs::write(&partial, serde_json::to_vec(message)?)?;
    std::fs::rename(partial, inbox.join(format!("{name}.json")))
}

fn uuid_like() -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or_default();
    format!("{nanos:x}")
}

/// Reads, deletes and returns the messages waiting in the inbox, oldest first.
/// A bare alert is what a qterm from before SessionStart wrote.
fn take_inbox(inbox: &Path) -> Vec<InboxMessage> {
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
            let bytes = std::fs::read(&file).ok();
            let _ = std::fs::remove_file(&file);
            let bytes = bytes?;
            serde_json::from_slice(&bytes)
                .ok()
                .or_else(|| serde_json::from_slice(&bytes).ok().map(InboxMessage::Alert))
        })
        .collect()
}

/// Watches the inbox and emits each alert to the UI as `claude-attention`, and
/// each session start as `claude-session-start`.
/// Alerts left over from before this start are stale and dropped.
pub fn watch_inbox(app: AppHandle) -> notify::Result<RecommendedWatcher> {
    let inbox = inbox_dir(&app).ok_or_else(|| notify::Error::generic("no local data folder"))?;
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
            for message in take_inbox(&inbox) {
                let _ = match message {
                    InboxMessage::Alert(alert) => app.emit("claude-attention", alert),
                    InboxMessage::Session(session) => app.emit("claude-session-start", session),
                    InboxMessage::Usage(usage) => app.emit("claude-statusline", usage),
                };
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

/// A notification that isn't about a pane (plan limits); clicking it shows the console.
pub fn show_plain_notification(app: &AppHandle, title: &str, message: &str) -> Result<(), String> {
    let app_id = registered_app_id(app);
    let app = app.clone();
    Toast::new(&app_id)
        .title(title)
        .text1(message)
        .sound(Some(Sound::Default))
        .on_activated(move |_| {
            crate::window::show_now(&app);
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
    fn a_stop_failure_becomes_an_alert_with_the_reason() {
        let input = r#"{"session_id":"s1","hook_event_name":"StopFailure","error":"rate_limit",
            "error_details":"429 Too Many Requests","last_assistant_message":"API Error: Rate limit reached"}"#;
        let Some(InboxMessage::Alert(alert)) = message_from_hook("pane-2", input) else { panic!("no alert") };
        assert_eq!(alert.title.as_deref(), Some("Claude stopped: rate limit reached"));
        assert_eq!(alert.message, "API Error: Rate limit reached");
        assert_eq!(alert.kind.as_deref(), Some("stop_failure:rate_limit"));
        // Without a message: the details, else a generic sentence.
        let bare = r#"{"hook_event_name":"StopFailure","error":"overloaded"}"#;
        let Some(InboxMessage::Alert(alert)) = message_from_hook("p", bare) else { panic!("no alert") };
        assert_eq!(alert.title.as_deref(), Some("Claude stopped: the API is overloaded"));
        assert_eq!(alert.message, "The turn ended with an API error (overloaded).");
    }

    #[test]
    fn reads_claude_codes_hook_input() {
        let input = r#"{"session_id":"abc","cwd":"C:\\x","hook_event_name":"Notification",
            "message":"Claude needs your permission to use Bash","title":"Permission needed",
            "notification_type":"permission_prompt"}"#;
        assert_eq!(
            message_from_hook("pane-1", input),
            Some(InboxMessage::Alert(Alert {
                pane_id: "pane-1".into(),
                title: Some("Permission needed".into()),
                message: "Claude needs your permission to use Bash".into(),
                kind: Some("permission_prompt".into()),
                session_id: Some("abc".into()),
            }))
        );
    }

    #[test]
    fn reads_a_session_start() {
        let input = r#"{"session_id":"s-1","transcript_path":"C:\\Users\\me\\.claude\\projects\\x\\s-1.jsonl",
            "cwd":"C:\\x","hook_event_name":"SessionStart","source":"resume"}"#;
        assert_eq!(
            message_from_hook("pane-2", input),
            Some(InboxMessage::Session(PaneSession {
                pane_id: "pane-2".into(),
                session_id: "s-1".into(),
                transcript_path: Some(r"C:\Users\me\.claude\projects\x\s-1.jsonl".into()),
            }))
        );
        assert!(message_from_hook("p", r#"{"hook_event_name":"SessionStart"}"#).is_none(), "no session id, nothing to map");
    }

    #[test]
    fn tolerates_minimal_or_broken_input() {
        let Some(InboxMessage::Alert(alert)) = message_from_hook("p", "{}") else { panic!("an alert") };
        assert_eq!(alert.message, "Claude Code needs your attention");
        assert!(message_from_hook("p", "not json").is_none());
    }

    #[test]
    fn inbox_round_trip_in_order_and_emptied() {
        let inbox = std::env::temp_dir().join(format!("qterm-inbox-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&inbox);
        let alert = |m: &str| Alert { pane_id: "p".into(), title: None, message: m.into(), kind: None, session_id: None };
        deliver(&inbox, &InboxMessage::Alert(alert("first"))).unwrap();
        std::thread::sleep(Duration::from_millis(5));
        // What a qterm from before SessionStart wrote: a bare alert.
        std::fs::write(inbox.join(format!("{}-zz-old.json", std::process::id())), serde_json::to_vec(&alert("second")).unwrap()).unwrap();
        std::fs::write(inbox.join("half.partial"), "{").unwrap();

        let taken: Vec<String> = take_inbox(&inbox)
            .into_iter()
            .map(|m| match m {
                InboxMessage::Alert(a) => a.message,
                InboxMessage::Session(s) => s.session_id,
                InboxMessage::Usage(u) => u.pane_id,
            })
            .collect();
        assert_eq!(taken, ["first", "second"]);
        assert!(take_inbox(&inbox).is_empty());
        let _ = std::fs::remove_dir_all(&inbox);
    }
}
