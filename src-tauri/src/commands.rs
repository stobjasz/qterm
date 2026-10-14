//! IPC surface. Thin wrappers only; the logic lives in the modules they call.

use serde::Serialize;
use tauri::ipc::{Channel, Response};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::claude::{write_atomically, ClaudeSession, ClaudeStore};
use crate::config::{ConfigState, Snapshot};
use crate::pty::{Profile, SessionId, SessionManager, SpawnRequest};
use crate::window;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PtyExit {
    id: SessionId,
    code: u32,
}

#[tauri::command]
pub fn get_config(config: State<'_, ConfigState>) -> Snapshot {
    config.snapshot()
}

/// Detected shells, SSH hosts (if switched on), then the [[profiles]] from the settings.
pub(crate) fn all_profiles(sessions: &SessionManager, config: &ConfigState) -> Vec<Profile> {
    let config = config.get();
    let mut detected = sessions.detected_profiles().to_vec();
    if config.ssh_profiles {
        detected.extend(crate::pty::ssh_profiles());
    }
    crate::pty::merge_profiles(&detected, &config.profiles)
}

/// Async so the first call, which detects profiles, runs off the main thread.
#[tauri::command]
pub async fn list_profiles(sessions: State<'_, SessionManager>, config: State<'_, ConfigState>) -> Result<Vec<Profile>, String> {
    Ok(all_profiles(&sessions, &config))
}

#[tauri::command]
pub async fn pty_spawn(
    app: AppHandle,
    sessions: State<'_, SessionManager>,
    config: State<'_, ConfigState>,
    request: SpawnRequest,
    on_output: Channel<Response>,
) -> Result<SessionId, String> {
    let inbox = crate::alerts::inbox_dir(&app);
    sessions.spawn_profile(
        &request,
        &all_profiles(&sessions, &config),
        config.get().shell_integration,
        inbox.as_deref(),
        // Raw bytes reach the UI as an ArrayBuffer, with no JSON/base64 encoding.
        move |bytes| on_output.send(Response::new(bytes)).is_ok(),
        move |id, code| {
            let _ = app.emit("pty-exit", PtyExit { id, code });
        },
    )
}

#[tauri::command]
pub fn pty_write(sessions: State<'_, SessionManager>, id: SessionId, data: String) -> Result<(), String> {
    sessions.write(id, &data)
}

/// The UI has processed `bytes` of output; see `pty::flow`.
#[tauri::command]
pub fn pty_ack(sessions: State<'_, SessionManager>, id: SessionId, bytes: usize) {
    sessions.ack(id, bytes);
}

#[tauri::command]
pub fn pty_resize(
    sessions: State<'_, SessionManager>,
    id: SessionId,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    sessions.resize(id, cols, rows)
}

#[tauri::command]
pub fn pty_kill(sessions: State<'_, SessionManager>, id: SessionId) {
    sessions.kill(id);
}

#[tauri::command]
pub fn hide_window(app: AppHandle) {
    window::dismiss(&app);
}

#[tauri::command]
pub fn ui_ready(app: AppHandle) {
    window::ui_ready(&app);
}

/// The tabs and layout saved by the UI (see workspace.ts), if any.
#[tauri::command]
pub fn load_session(app: AppHandle) -> Option<String> {
    std::fs::read_to_string(session_path(&app)?).ok()
}

#[tauri::command]
pub fn save_session(app: AppHandle, session: String) -> Result<(), String> {
    write_atomically(&session_path(&app).ok_or("no config folder")?, &session)
}

fn session_path(app: &AppHandle) -> Option<std::path::PathBuf> {
    Some(app.path().app_config_dir().ok()?.join("session.json"))
}

/// Recent commands and folders (see history.ts), if any.
#[tauri::command]
pub fn load_history(app: AppHandle) -> Option<String> {
    std::fs::read_to_string(history_path(&app)?).ok()
}

#[tauri::command]
pub fn save_history(app: AppHandle, history: String) -> Result<(), String> {
    write_atomically(&history_path(&app).ok_or("no config folder")?, &history)
}

fn history_path(app: &AppHandle) -> Option<std::path::PathBuf> {
    Some(app.path().app_config_dir().ok()?.join("history.json"))
}

/// Named workspaces (see named.ts), if any.
#[tauri::command]
pub fn load_workspaces(app: AppHandle) -> Option<String> {
    std::fs::read_to_string(workspaces_path(&app)?).ok()
}

#[tauri::command]
pub fn save_workspaces(app: AppHandle, workspaces: String) -> Result<(), String> {
    write_atomically(&workspaces_path(&app).ok_or("no config folder")?, &workspaces)
}

fn workspaces_path(app: &AppHandle) -> Option<std::path::PathBuf> {
    Some(app.path().app_config_dir().ok()?.join("workspaces.json"))
}

#[tauri::command]
pub fn list_claude_sessions(store: State<'_, ClaudeStore>) -> Vec<ClaudeSession> {
    store.list()
}

/// Async: finding and reading the transcript is file I/O, kept off the main thread.
#[tauri::command]
pub async fn claude_session_seen(
    app: AppHandle,
    store: State<'_, ClaudeStore>,
    id: String,
    profile_id: String,
    pane_cwd: Option<String>,
) -> Result<Vec<ClaudeSession>, String> {
    let sessions = store.remember(&id, &profile_id, pane_cwd)?;
    let _ = app.emit("claude-sessions-changed", &sessions);
    Ok(sessions)
}

#[tauri::command]
pub fn forget_claude_sessions(
    app: AppHandle,
    store: State<'_, ClaudeStore>,
    ids: Vec<String>,
) -> Result<Vec<ClaudeSession>, String> {
    let sessions = store.forget(&ids)?;
    let _ = app.emit("claude-sessions-changed", &sessions);
    Ok(sessions)
}

/// Settings panel: write these changes into config.toml (see `ConfigState::update`).
#[tauri::command]
pub fn save_config(config: State<'_, ConfigState>, changes: serde_json::Map<String, serde_json::Value>) -> Result<(), String> {
    config.update(&changes)
}

/// Settings → Export: copies config.toml to `path`.
#[tauri::command]
pub fn export_settings(config: State<'_, ConfigState>, path: String) -> Result<(), String> {
    config.export_to(std::path::Path::new(&path))
}

/// Settings → Import: replaces config.toml with `path` if it is valid (old one kept as .bak).
#[tauri::command]
pub fn import_settings(config: State<'_, ConfigState>, path: String) -> Result<(), String> {
    config.import_from(std::path::Path::new(&path))
}

#[tauri::command]
pub fn open_config_file(app: AppHandle) -> Result<(), String> {
    crate::tray::open_config_file(&app)
}

#[tauri::command]
pub fn get_autostart(app: AppHandle) -> bool {
    use tauri_plugin_autostart::ManagerExt;
    app.autolaunch().is_enabled().unwrap_or(false)
}

#[tauri::command]
pub fn set_autostart(app: AppHandle, enabled: bool) -> Result<(), String> {
    crate::tray::set_autostart(&app, enabled)
}

/// Bottom-edge drag in progress: resize to `height` CSS pixels; returns the share.
#[tauri::command]
pub fn resize_console(app: AppHandle, height: f64) -> Result<f64, String> {
    window::resize_height(&app, height)
}

/// Bottom-edge drag finished (or reset): remember the height as a share of the work area.
#[tauri::command]
pub fn save_console_height(config: State<'_, ConfigState>, share: f64) -> Result<(), String> {
    let share = (share.clamp(0.1, 1.0) * 100.0).round() / 100.0;
    let mut changes = serde_json::Map::new();
    changes.insert("height".into(), share.into());
    config.update(&changes)
}

/// Which of these terminal file references exist (resolved against `cwd`).
#[tauri::command]
pub async fn resolve_files(paths: Vec<String>, cwd: Option<String>) -> Vec<Option<String>> {
    crate::editor::resolve_files(&paths, cwd.as_deref())
}

#[tauri::command]
pub fn open_in_editor(config: State<'_, ConfigState>, file: String, line: Option<u32>, col: Option<u32>) -> Result<(), String> {
    crate::editor::open(&config.get().editor, &file, line, col)
}

/// A pane's output to a file: where the user chose, or (no path) a new file in the
/// temp folder for the editor. Returns where it went.
#[tauri::command]
pub fn save_output(path: Option<String>, contents: String) -> Result<String, String> {
    let path = match path {
        Some(path) => std::path::PathBuf::from(path),
        None => {
            let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
            std::env::temp_dir().join(format!("qterm-output-{stamp}.txt"))
        }
    };
    std::fs::write(&path, contents).map_err(|e| format!("could not write {}: {e}", path.display()))?;
    Ok(path.to_string_lossy().into_owned())
}

/// The UI decided the user isn't looking at this pane: show a Windows notification.
#[tauri::command]
pub fn show_claude_alert(app: AppHandle, alert: crate::alerts::Alert) -> Result<(), String> {
    crate::alerts::show_notification(&app, &alert)
}

/// Panes waiting for the user, for the tray tooltip.
#[tauri::command]
pub fn set_attention_count(app: AppHandle, count: usize) {
    crate::tray::set_attention(&app, count);
}

fn hook_paths() -> Result<(std::path::PathBuf, String), String> {
    let home = crate::claude::claude_home().ok_or("no home folder for Claude Code")?;
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    Ok((crate::claude_hook::settings_path(&home), crate::claude_hook::command_for(&exe)))
}

#[tauri::command]
pub fn claude_hook_status() -> Result<crate::claude_hook::HookStatus, String> {
    let (settings, command) = hook_paths()?;
    crate::claude_hook::status(&settings, &command)
}

#[tauri::command]
pub fn install_claude_hook() -> Result<crate::claude_hook::HookStatus, String> {
    let (settings, command) = hook_paths()?;
    crate::claude_hook::install(&settings, &command)?;
    crate::claude_hook::status(&settings, &command)
}

#[tauri::command]
pub fn remove_claude_hook() -> Result<crate::claude_hook::HookStatus, String> {
    let (settings, command) = hook_paths()?;
    crate::claude_hook::remove(&settings)?;
    crate::claude_hook::status(&settings, &command)
}

fn statusline_paths() -> Result<(std::path::PathBuf, std::path::PathBuf), String> {
    let home = crate::claude::claude_home().ok_or("no home folder for Claude Code")?;
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    Ok((crate::claude_hook::settings_path(&home), exe))
}

#[tauri::command]
pub fn claude_statusline_status() -> Result<crate::claude_statusline::StatuslineStatus, String> {
    let (settings, exe) = statusline_paths()?;
    crate::claude_statusline::status(&settings, &exe)
}

#[tauri::command]
pub fn install_claude_statusline() -> Result<crate::claude_statusline::StatuslineStatus, String> {
    let (settings, exe) = statusline_paths()?;
    crate::claude_statusline::install(&settings, &exe)?;
    crate::claude_statusline::status(&settings, &exe)
}

#[tauri::command]
pub fn remove_claude_statusline() -> Result<crate::claude_statusline::StatuslineStatus, String> {
    let (settings, exe) = statusline_paths()?;
    crate::claude_statusline::remove(&settings)?;
    crate::claude_statusline::status(&settings, &exe)
}

/// The plan usage line for the tray tooltip (None: unknown).
#[tauri::command]
pub fn set_plan_summary(app: AppHandle, summary: Option<String>) {
    crate::tray::set_plan(&app, summary);
}

/// A plan limit crossed 80% or 95%: a Windows notification (clicking it shows the console).
#[tauri::command]
pub fn show_plan_warning(app: AppHandle, title: String, message: String) -> Result<(), String> {
    crate::alerts::show_plain_notification(&app, &title, &message)
}

/// Settings → Settings file: keep config.toml in `folder` (None: the default place).
#[tauri::command]
pub fn set_settings_folder(app: AppHandle, folder: Option<String>) -> Result<crate::config::Relocated, String> {
    crate::set_settings_folder(&app, folder.as_deref().map(std::path::Path::new))
}

/// Shells Windows Terminal has that qterm doesn't (Settings → Import from Windows Terminal).
#[tauri::command]
pub async fn windows_terminal_profiles(
    sessions: State<'_, SessionManager>,
    config: State<'_, ConfigState>,
) -> Result<Vec<crate::wt_import::WtProfile>, String> {
    Ok(crate::wt_import::candidates(&all_profiles(&sessions, &config)))
}

/// Adds the chosen ones as [[profiles]] in config.toml (the watcher applies them).
#[tauri::command]
pub fn import_windows_terminal_profiles(config: State<'_, ConfigState>, profiles: Vec<crate::wt_import::WtProfile>) -> Result<(), String> {
    config.add_profiles(&profiles)
}

/// Saves (or replaces by name) a [[layouts]] entry in config.toml.
#[tauri::command]
pub fn save_layout(config: State<'_, ConfigState>, layout: serde_json::Value) -> Result<(), String> {
    config.save_layout(&layout)
}

#[tauri::command]
pub fn delete_layout(config: State<'_, ConfigState>, name: String) -> Result<(), String> {
    config.delete_layout(&name)
}

/// Every Claude Code session on this machine (the ✳ menu's "All" view).
#[tauri::command]
pub async fn list_all_claude_sessions(index: State<'_, crate::claude::TranscriptIndex>) -> Result<Vec<crate::claude::TranscriptSummary>, String> {
    let home = crate::claude::claude_home().ok_or("no home folder for Claude Code")?;
    Ok(index.scan(&home))
}

/// Sessions with Claude Code running inside them (per-tab status).
#[tauri::command]
pub async fn claude_running(sessions: State<'_, SessionManager>) -> Result<Vec<SessionId>, String> {
    Ok(sessions.running("claude.exe"))
}

#[tauri::command]
pub fn save_scrollback(store: State<'_, crate::scrollback::ScrollbackStore>, pane_id: String, text: String) -> Result<(), String> {
    store.save(&pane_id, &text)
}

#[tauri::command]
pub fn load_scrollback(store: State<'_, crate::scrollback::ScrollbackStore>, pane_id: String) -> Option<String> {
    store.load(&pane_id)
}

/// Token use of the Claude session in a pane: from its transcript (known through the
/// SessionStart hook), else the newest transcript of the pane's folder. None when
/// neither leads to one.
#[tauri::command]
pub async fn claude_usage(
    usage: State<'_, crate::claude_usage::UsageIndex>,
    transcript: Option<String>,
    cwd: Option<String>,
) -> Result<Option<crate::claude_usage::ClaudeUsage>, String> {
    let Some(home) = crate::claude::claude_home() else { return Ok(None) };
    let path = match transcript.map(std::path::PathBuf::from) {
        Some(path) if crate::claude_usage::is_transcript(&home, &path) => Some(path),
        Some(path) => return Err(format!("not a Claude Code transcript: {}", path.display())),
        None => cwd.as_deref().and_then(|cwd| crate::claude_usage::newest_transcript(&home, cwd)),
    };
    path.map(|path| usage.usage(&path)).transpose()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    version: String,
    /// The portable exe (updates by replacing itself), not an installed copy.
    portable: bool,
}

#[tauri::command]
pub fn app_info(app: AppHandle) -> AppInfo {
    AppInfo { version: app.package_info().version.to_string(), portable: crate::updater::is_portable() }
}

/// Settings → "Check now": the newer version, if there is one.
#[tauri::command]
pub async fn check_update(app: AppHandle) -> Result<Option<crate::updater::UpdateInfo>, String> {
    crate::updater::check(&app).await
}

/// Installs the update found (the UI has saved tabs and output first); qterm restarts.
#[tauri::command]
pub async fn install_update(app: AppHandle) -> Result<(), String> {
    crate::updater::install(&app).await
}

/// How Windows' sudo is set up: admin tabs need it Inline.
#[tauri::command]
pub fn sudo_status() -> crate::elevation::SudoMode {
    crate::elevation::sudo_mode()
}

/// Windows' Settings page where sudo is switched on and set to Inline.
#[tauri::command]
pub fn open_sudo_settings(app: AppHandle) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    app.opener().open_url("ms-settings:developers", None::<&str>).map_err(|e| e.to_string())
}

/// Opens a shell as administrator in its own window (when admin tabs aren't possible).
#[tauri::command]
pub fn open_elevated_window(
    sessions: State<'_, SessionManager>,
    config: State<'_, ConfigState>,
    profile_id: String,
    cwd: Option<String>,
) -> Result<(), String> {
    let profiles = all_profiles(&sessions, &config);
    let profile = profiles.iter().find(|p| p.id == profile_id).ok_or_else(|| format!("unknown profile {profile_id}"))?;
    crate::elevation::open_elevated_window(&profile.command(cwd.as_deref(), false))
}

/// Deletes saved output: of these panes, or of all when `pane_ids` is None.
#[tauri::command]
pub fn delete_scrollback(store: State<'_, crate::scrollback::ScrollbackStore>, pane_ids: Option<Vec<String>>) {
    store.delete(pane_ids.as_deref());
}

#[tauri::command]
pub fn scrollback_usage(store: State<'_, crate::scrollback::ScrollbackStore>) -> crate::scrollback::Usage {
    store.usage()
}

#[tauri::command]
pub fn prune_scrollback(store: State<'_, crate::scrollback::ScrollbackStore>, keep: Vec<String>) {
    store.prune(&keep);
}

/// The UI has saved what it needs after "quit-requested"; exit now.
/// The first start after an update (once): from which version to which.
#[tauri::command]
pub fn take_version_change(app: AppHandle) -> Option<crate::whats_new::VersionChange> {
    crate::whats_new::take_change(&app)
}

/// The 📌 button: pinned open, the console ignores hide-on-blur and the hotkey's hide.
#[tauri::command]
pub fn set_pinned(app: AppHandle, pinned: bool) {
    window::set_pinned(&app, pinned);
}

/// The folder qterm was started with (`--open-here`, from Explorer's menu), once.
#[tauri::command]
pub fn take_open_here(pending: State<'_, crate::explorer::PendingOpenHere>) -> Option<String> {
    pending.0.lock().unwrap().take()
}

/// An error from the UI, for the log file.
#[tauri::command]
pub fn log_ui(message: String) {
    crate::qlog!("UI: {message}");
}

/// Settings → "Copy diagnostics".
#[tauri::command]
pub fn diagnostics(app: AppHandle) -> String {
    crate::diagnostics::report(&app)
}

/// Settings and tray → "Open logs": the log folder in Explorer.
#[tauri::command]
pub fn open_logs(app: AppHandle) -> Result<(), String> {
    crate::tray::open_logs(&app)
}

#[tauri::command]
pub fn quit_now(app: AppHandle) {
    app.exit(0);
}
