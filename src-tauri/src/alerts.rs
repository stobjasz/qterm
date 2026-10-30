//! "Claude needs you" alerts. Claude Code runs its Notification hook, which is
//! qterm's own exe with `--claude-notify` (see claude_hook.rs). That short-lived
//! process reads the hook's JSON from stdin, tags it with the pane it came from
//! (`QTERM_PANE`, set on every shell qterm starts), drops it in an inbox folder
//! and exits. The running qterm watches the inbox and tells the UI, which decides
//! whether a Windows notification is needed.

use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::{Duration, SystemTime};

use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use crate::agent_health::{Health, Provider};
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

/// Claude finished a turn in a pane (its Stop hook): what it said last.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Reply {
    pub pane_id: String,
    pub session_id: Option<String>,
    pub message: String,
}

/// A reply longer than this is cut (the UI shows only its start anyway).
const MAX_REPLY: usize = 4000;

/// What the hook leaves in the inbox.
#[derive(Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
enum InboxMessage {
    Alert(Alert),
    Session(PaneSession),
    /// From the status line relay (claude_statusline.rs).
    Usage(crate::claude_statusline::StatuslineUsage),
    Reply(Reply),
    CodexAlert(Alert),
    CodexSession(PaneSession),
    CodexReply(Reply),
    CodexActivity(CodexActivity),
    Probe { provider: Provider, nonce: String },
}

#[derive(Debug, PartialEq, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexActivity { pub pane_id: String, pub session_id: Option<String>, pub busy: bool }

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
    probe_nonce: Option<String>,
    tool_name: Option<String>,
    tool_input: Option<serde_json::Value>,
}

fn probe(hook: &HookInput, provider: Provider) -> Option<InboxMessage> {
    if hook.hook_event_name.as_deref() != Some("QtermDeliveryProbe") { return None; }
    let nonce = hook.probe_nonce.as_ref().filter(|n| !n.is_empty() && n.len() <= 128 && n.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-'))?;
    Some(InboxMessage::Probe { provider, nonce: nonce.clone() })
}

/// Hook mode: never fails loudly, since a failing hook would bother Claude Code.
/// Outside qterm (no `QTERM_PANE`) it does nothing at all.
pub fn run_hook() { run_provider_hook(false) }

pub fn run_codex_hook() {
    run_provider_hook(true);
    println!("{{}}");
}

fn run_provider_hook(codex: bool) {
    let Ok(pane_id) = std::env::var(PANE_ENV) else { return };
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let mut input = String::new();
        let ok = std::io::stdin().take(MAX_INPUT).read_to_string(&mut input).is_ok();
        let _ = tx.send(ok.then_some(input));
    });
    let Ok(Some(input)) = rx.recv_timeout(INPUT_TIMEOUT) else { return };
    let message = if codex { message_from_codex_hook(&pane_id, &input) } else { message_from_hook(&pane_id, &input) };
    let Some(message) = message else { return };
    if let Some(inbox) = hook_inbox() {
        let cwd = serde_json::from_str::<serde_json::Value>(&input).ok().and_then(|v| v.get("cwd").and_then(|s| s.as_str()).map(|s| s.chars().take(4096).collect::<String>()));
        let _ = deliver_context(&inbox, &message, cwd.as_deref());
    }
}

fn message_from_codex_hook(pane_id: &str, input: &str) -> Option<InboxMessage> {
    let hook: HookInput = serde_json::from_str(input).ok()?;
    if hook.hook_event_name.as_deref() == Some("QtermDeliveryProbe") { return probe(&hook, Provider::Codex); }
    let session_id = hook.session_id.filter(|id| crate::codex::valid_id(id));
    match hook.hook_event_name.as_deref()? {
        "SessionStart" => Some(InboxMessage::CodexSession(PaneSession {
            pane_id: pane_id.into(), session_id: session_id?, transcript_path: None,
        })),
        "UserPromptSubmit" | "PostToolUse" | "Interrupt" => Some(InboxMessage::CodexActivity(CodexActivity {
            pane_id: pane_id.into(), session_id, busy: hook.hook_event_name.as_deref() != Some("Interrupt"),
        })),
        "PermissionRequest" => {
            let tool = hook.tool_name.as_deref().unwrap_or("a tool");
            let mut message = format!("Codex requested an approval check for {tool}. Hooks or automatic review may handle it; a question for you has not been confirmed.");
            for (field, label) in [("description", "Reason"), ("command", "Command")] {
                if let Some(text) = hook.tool_input.as_ref().and_then(|v| v.get(field)).and_then(|v| v.as_str()).filter(|s| !s.trim().is_empty()) { message.push_str(&format!("\n{label}: {text}")); }
            }
            Some(InboxMessage::CodexAlert(Alert { pane_id: pane_id.into(), session_id, title: Some("Codex approval check".into()),
                message: message.chars().take(MAX_REPLY).collect(), kind: Some("codex:approval".into()) }))
        }
        "Stop" => Some(InboxMessage::CodexReply(Reply {
            pane_id: pane_id.into(), session_id,
            message: hook.last_assistant_message.unwrap_or_default().chars().take(MAX_REPLY).collect(),
        })),
        _ => None,
    }
}

fn message_from_hook(pane_id: &str, input: &str) -> Option<InboxMessage> {
    let hook: HookInput = serde_json::from_str(input).ok()?;
    if hook.hook_event_name.as_deref() == Some("QtermDeliveryProbe") { return probe(&hook, Provider::Claude); }
    if hook.hook_event_name.as_deref() == Some("SessionStart") {
        return Some(InboxMessage::Session(PaneSession {
            pane_id: pane_id.to_string(),
            session_id: hook.session_id?,
            transcript_path: hook.transcript_path,
        }));
    }
    if hook.hook_event_name.as_deref() == Some("Stop") {
        let message = hook.last_assistant_message.filter(|m| !m.trim().is_empty()).unwrap_or_default();
        let message = match message.char_indices().nth(MAX_REPLY) {
            Some((cut, _)) => format!("{}…", &message[..cut]),
            None => message,
        };
        return Some(InboxMessage::Reply(Reply { pane_id: pane_id.to_string(), session_id: hook.session_id, message }));
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
    deliver_context(inbox, message, None)
}

fn deliver_context(inbox: &Path, message: &InboxMessage, cwd: Option<&str>) -> std::io::Result<()> {
    std::fs::create_dir_all(inbox)?;
    let name = format!("{}-{}", std::process::id(), uuid_like());
    let partial = inbox.join(format!("{name}.partial"));
    let mut value = serde_json::to_value(message)?;
    if let Some(cwd) = cwd { value["qtermCwd"] = cwd.into(); }
    std::fs::write(&partial, serde_json::to_vec(&value)?)?;
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
struct Delivery { message: InboxMessage, cwd: Option<String> }

fn take_inbox(inbox: &Path) -> Vec<Delivery> {
    let Ok(entries) = std::fs::read_dir(inbox) else { return Vec::new() };
    let mut files: Vec<PathBuf> = entries
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|ext| ext == "json"))
        .collect();
    // Hook processes have different/reused PIDs. Their file names are not an
    // event order: a Stop must not be delivered before an earlier activity event.
    files.sort_by_cached_key(|path| (
        path.metadata().and_then(|m| m.modified()).unwrap_or(SystemTime::UNIX_EPOCH),
        path.file_name().map(|name| name.to_os_string()),
    ));
    files
        .into_iter()
        .filter_map(|file| {
            let bytes = std::fs::read(&file).ok();
            let _ = std::fs::remove_file(&file);
            let bytes = bytes?;
            let cwd = serde_json::from_slice::<serde_json::Value>(&bytes).ok().and_then(|v| v.get("qtermCwd").and_then(|s| s.as_str()).map(str::to_owned));
            serde_json::from_slice(&bytes)
                .ok()
                .or_else(|| serde_json::from_slice(&bytes).ok().map(InboxMessage::Alert))
                .map(|message| Delivery { message, cwd })
        })
        .collect()
}

/// Watches the inbox and emits each alert to the UI as `claude-attention`, each
/// session start as `claude-session-start`, and each finished turn as `claude-reply`.
/// Recover leftover deliveries into durable history without replaying live status.
pub fn watch_inbox(app: AppHandle) -> notify::Result<RecommendedWatcher> {
    let inbox = inbox_dir(&app).ok_or_else(|| notify::Error::generic("no local data folder"))?;
    std::fs::create_dir_all(&inbox).map_err(notify::Error::io)?;
    for Delivery { message, cwd } in take_inbox(&inbox) { record_attention(&app, &message, cwd.as_deref()); }

    let (tx, rx) = std::sync::mpsc::channel::<()>();
    let mut watcher = notify::recommended_watcher(move |_event: notify::Result<notify::Event>| {
        let _ = tx.send(());
    })?;
    watcher.watch(&inbox, RecursiveMode::NonRecursive)?;
    std::thread::spawn(move || {
        while rx.recv().is_ok() {
            while rx.recv_timeout(Duration::from_millis(30)).is_ok() {}
            for Delivery { message, cwd } in take_inbox(&inbox) {
                record_attention(&app, &message, cwd.as_deref());
                let event = match &message {
                    InboxMessage::Alert(a) => Some((Provider::Claude, "attention", a.pane_id.as_str(), a.session_id.as_deref())),
                    InboxMessage::Session(s) => Some((Provider::Claude, "session-start", s.pane_id.as_str(), Some(s.session_id.as_str()))),
                    InboxMessage::Usage(u) => Some((Provider::Claude, "statusline", u.pane_id.as_str(), u.session_id.as_deref())),
                    InboxMessage::Reply(r) => Some((Provider::Claude, "reply", r.pane_id.as_str(), r.session_id.as_deref())),
                    InboxMessage::CodexAlert(a) => Some((Provider::Codex, "attention", a.pane_id.as_str(), a.session_id.as_deref())),
                    InboxMessage::CodexSession(s) => Some((Provider::Codex, "session-start", s.pane_id.as_str(), Some(s.session_id.as_str()))),
                    InboxMessage::CodexReply(r) => Some((Provider::Codex, "reply", r.pane_id.as_str(), r.session_id.as_deref())),
                    InboxMessage::CodexActivity(a) => Some((Provider::Codex, "activity", a.pane_id.as_str(), a.session_id.as_deref())),
                    InboxMessage::Probe { .. } => None,
                };
                if let Some((provider, event, pane, session)) = event { app.state::<Health>().record(provider, event, pane, session); }
                let _ = match message {
                    InboxMessage::Alert(alert) => app.emit("claude-attention", alert),
                    InboxMessage::Session(session) => app.emit("claude-session-start", session),
                    InboxMessage::Usage(usage) => app.emit("claude-statusline", usage),
                    InboxMessage::Reply(reply) => app.emit("claude-reply", reply),
                    InboxMessage::CodexAlert(alert) => app.emit("codex-attention", alert),
                    InboxMessage::CodexSession(session) => app.emit("codex-session-start", session),
                    InboxMessage::CodexReply(reply) => app.emit("codex-reply", reply),
                    InboxMessage::CodexActivity(activity) => app.emit("codex-activity", activity),
                    InboxMessage::Probe { provider, nonce } => { app.state::<Health>().acknowledge(provider, &nonce); Ok(()) }
                };
            }
        }
    });
    Ok(watcher)
}

fn record_attention(app: &AppHandle, message: &InboxMessage, cwd: Option<&str>) {
    use crate::agent_inbox::{Kind, Store};
    let store = app.state::<Store>();
    let snapshot = match message {
        InboxMessage::Alert(a) | InboxMessage::CodexAlert(a) => {
            let provider = if matches!(message, InboxMessage::CodexAlert(_)) { Provider::Codex } else { Provider::Claude };
            let kind = if a.kind.as_deref().is_some_and(|k| k.starts_with("stop_failure:")) { Kind::Failure }
                else if provider == Provider::Codex { Kind::Approval }
                else if a.kind.as_deref() == Some("permission_prompt") { Kind::Permission } else { Kind::Input };
            if kind == Kind::Failure { store.continued(provider, &a.pane_id, a.session_id.as_deref()); }
            Some(store.record(provider, &a.pane_id, a.session_id.as_deref(), cwd, kind, a.title.as_deref().unwrap_or("Agent needs attention"), &a.message))
        }
        InboxMessage::Reply(r) | InboxMessage::CodexReply(r) => {
            let provider = if matches!(message, InboxMessage::CodexReply(_)) { Provider::Codex } else { Provider::Claude };
            store.continued(provider, &r.pane_id, r.session_id.as_deref());
            Some(store.record(provider, &r.pane_id, r.session_id.as_deref(), cwd, Kind::Completed, "Turn completed", if r.message.trim().is_empty() { "The agent finished its turn without a reply." } else { &r.message }))
        }
        InboxMessage::CodexActivity(a) if a.busy => store.continued(Provider::Codex, &a.pane_id, a.session_id.as_deref()),
        _ => None,
    };
    if let Some(snapshot) = snapshot { let _ = app.emit("agent-inbox-changed", snapshot); }
}

/// A Windows notification; clicking it brings the console up on that pane.
pub fn show_notification(app: &AppHandle, alert: &Alert) -> Result<(), String> {
    if let Some(result) = record_test_notification(app, serde_json::json!({ "kind": "pane", "alert": alert })) { return result; }
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
    if let Some(result) = record_test_notification(app, serde_json::json!({ "kind": "plain", "title": title, "message": message })) { return result; }
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
        app.config().identifier.clone()
    } else {
        Toast::POWERSHELL_APP_ID.to_string()
    }
}

fn register_app_id(app: &AppHandle) -> Result<(), String> {
    use tauri::Manager;
    let icon = app.path().app_local_data_dir().map_err(|e| e.to_string())?.join("qterm.png");
    // Rewritten when the bundled icon changed, so an upgrade doesn't keep the old one.
    let png: &[u8] = include_bytes!("../icons/128x128.png");
    if std::fs::read(&icon).ok().as_deref() != Some(png) {
        std::fs::write(&icon, png).map_err(|e| e.to_string())?;
    }
    let key = windows_registry::CURRENT_USER
        .create(format!(r"Software\Classes\AppUserModelId\{}", app.config().identifier))
        .map_err(|e| e.to_string())?;
    key.set_string("DisplayName", "qterm").map_err(|e| e.to_string())?;
    key.set_string("IconUri", icon.to_string_lossy()).map_err(|e| e.to_string())?;
    Ok(())
}

/// Desktop scenarios use real hooks and notification IPC, but must never send
/// synthetic questions to the user's desktop or register the production app ID.
fn record_test_notification(app: &AppHandle, mut payload: serde_json::Value) -> Option<Result<(), String>> {
    if app.config().identifier != "dev.qterm.e2e" { return None; }
    Some((|| {
        use std::io::Write;
        static LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
        let _guard = LOCK.lock().unwrap();
        let dir = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        payload["suppressed"] = true.into();
        let mut file = std::fs::OpenOptions::new().create(true).append(true).open(dir.join("notification-attempts.jsonl")).map_err(|e| e.to_string())?;
        writeln!(file, "{payload}").map_err(|e| e.to_string())
    })())
}

#[cfg(test)]
mod tests {
    #[test]
    fn inbox_orders_events_by_write_time_instead_of_hook_process_id() {
        let inbox = std::env::temp_dir().join(format!("qterm-inbox-order-{}", std::process::id()));
        std::fs::create_dir_all(&inbox).unwrap();
        let base = SystemTime::now() - Duration::from_secs(100);
        for (name, message, offset) in [("900-first.json", "first", 1), ("100-second.json", "second", 2)] {
            let path = inbox.join(name);
            std::fs::write(&path, serde_json::json!({ "paneId": "pane", "message": message }).to_string()).unwrap();
            std::fs::OpenOptions::new().write(true).open(path).unwrap()
                .set_times(std::fs::FileTimes::new().set_modified(base + Duration::from_secs(offset))).unwrap();
        }
        let messages: Vec<_> = take_inbox(&inbox).into_iter().map(|m| match m.message { InboxMessage::Alert(a) => a.message, _ => panic!("unexpected message") }).collect();
        assert_eq!(messages, ["first", "second"]);
        std::fs::remove_dir(inbox).unwrap();
    }
    #[test]
    fn codex_events_use_separate_provider_messages() {
        let id = "01a1690c-c7b7-7e80-9864-e6971b91db16";
        let input = |event: &str| serde_json::json!({"hook_event_name":event,"session_id":id,"last_assistant_message":"Done."}).to_string();
        assert!(matches!(message_from_codex_hook("p", &input("SessionStart")), Some(InboxMessage::CodexSession(_))));
        assert!(matches!(message_from_codex_hook("p", &input("Stop")), Some(InboxMessage::CodexReply(Reply { message, .. })) if message == "Done."));
        assert!(matches!(message_from_codex_hook("p", &input("PermissionRequest")), Some(InboxMessage::CodexAlert(Alert { kind: Some(kind), .. })) if kind == "codex:approval"));
        assert!(matches!(message_from_codex_hook("p", &input("UserPromptSubmit")), Some(InboxMessage::CodexActivity(CodexActivity { busy: true, .. }))));
        assert!(matches!(message_from_codex_hook("p", &input("Interrupt")), Some(InboxMessage::CodexActivity(CodexActivity { busy: false, .. }))));
        assert!(message_from_codex_hook("p", &input("SubagentStop")).is_none());
        assert!(message_from_codex_hook("p", "{broken").is_none());
        assert!(message_from_codex_hook("p", r#"{"hook_event_name":"SessionStart","session_id":"x;calc"}"#).is_none());
    }

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
    fn a_finished_turn_brings_claudes_last_reply() {
        let input = r#"{"session_id":"s1","hook_event_name":"Stop","stop_hook_active":false,
            "last_assistant_message":"Done: the tests pass.","background_tasks":[],"session_crons":[]}"#;
        assert_eq!(
            message_from_hook("pane-3", input),
            Some(InboxMessage::Reply(Reply { pane_id: "pane-3".into(), session_id: Some("s1".into()), message: "Done: the tests pass.".into() }))
        );
        // A turn of tool calls still completed, even without a reply to display.
        assert!(matches!(message_from_hook("p", r#"{"hook_event_name":"Stop","last_assistant_message":"  "}"#), Some(InboxMessage::Reply(Reply { message, .. })) if message.is_empty()));
        assert!(matches!(message_from_hook("p", r#"{"hook_event_name":"Stop"}"#), Some(InboxMessage::Reply(Reply { message, .. })) if message.is_empty()));
        let long = format!(r#"{{"hook_event_name":"Stop","last_assistant_message":"{}"}}"#, "é".repeat(MAX_REPLY + 10));
        let Some(InboxMessage::Reply(reply)) = message_from_hook("p", &long) else { panic!("a reply") };
        assert_eq!(reply.message.chars().count(), MAX_REPLY + 1, "cut, with an ellipsis");
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
            .map(|m| match m.message {
                InboxMessage::Alert(a) => a.message,
                InboxMessage::Session(s) => s.session_id,
                InboxMessage::Usage(u) => u.pane_id,
                InboxMessage::Reply(r) => r.message,
                other => panic!("unexpected inbox message: {other:?}"),
            })
            .collect();
        assert_eq!(taken, ["first", "second"]);
        assert!(take_inbox(&inbox).is_empty());
        let _ = std::fs::remove_dir_all(&inbox);
    }
}
