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
pub async fn pty_ready(app:AppHandle,id:SessionId)->Result<(),String>{
    tauri::async_runtime::spawn_blocking(move||app.state::<SessionManager>().ready(id)).await.map_err(|e|e.to_string())?
}

#[tauri::command]
pub fn pty_write(sessions: State<'_, SessionManager>, id: SessionId, data: String,protocol_reply:Option<bool>) -> Result<(), String> {
    sessions.write_input(id, &data,protocol_reply.unwrap_or(false))
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
    environment:Option<String>,
) -> Result<Vec<ClaudeSession>, String> {
    let sessions = store.remember_scoped(&id, &profile_id, pane_cwd,environment)?;
    let _ = app.emit("claude-sessions-changed", &sessions);
    Ok(sessions)
}

#[tauri::command]
pub fn forget_claude_sessions(
    app: AppHandle,
    store: State<'_, ClaudeStore>,
    ids: Option<Vec<String>>,
    references:Option<Vec<crate::session_library::Reference>>,
) -> Result<Vec<ClaudeSession>, String> {
    let sessions = match (ids,references){(Some(ids),None)=>store.forget(&ids)?,(None,Some(references))=>store.forget_scoped(&references)?,_=>return Err("Supply scoped references or legacy native IDs, not both".into())};
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
pub async fn resolve_files(app:AppHandle,paths: Vec<String>, cwd: Option<String>,profile_id:Option<String>,environment:Option<String>) -> Result<Vec<Option<String>>,String> {
    tauri::async_runtime::spawn_blocking(move||{
        if paths.len()>256{return Err("At most 256 file candidates are allowed".into());}
        let profiles=all_profiles(&app.state::<SessionManager>(),&app.state::<ConfigState>());
        if let Some(distro)=crate::wsl::context(profile_id.as_deref(),environment.as_deref(),&profiles)?{crate::wsl::resolve(&distro,cwd.as_deref().ok_or("Linux folder is unknown")?,&paths)}
        else{if cwd.as_deref().is_some_and(|s|s.starts_with('/')&&!s.starts_with("//")){return Err("A Linux folder requires an explicit WSL environment".into());}Ok(crate::editor::resolve_files(&paths,cwd.as_deref()))}
    }).await.map_err(|e|e.to_string())?
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
pub async fn list_all_claude_sessions(app:AppHandle) -> Result<Vec<crate::claude::TranscriptSummary>, String> {tauri::async_runtime::spawn_blocking(move||{
    let config=app.state::<ConfigState>();
    if !config.get().claude_sessions{return Err("Claude session history is disabled".into());}
    let home = absolute_source_home(crate::claude::claude_home()).ok_or("no home folder for Claude Code")?;
    let sessions=app.state::<crate::claude::TranscriptIndex>().scan(&home);if !config.get().claude_sessions{return Err("Claude session history was disabled while scanning".into());}Ok(sessions)
}).await.map_err(|error|error.to_string())?}

/// Sessions with Claude Code running inside them (per-tab status).
/// What still runs in these panes' shells, so closing them can ask first.
#[tauri::command]
pub async fn running_programs(app: AppHandle, ids: Vec<SessionId>) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move||app.state::<SessionManager>().programs(&ids)).await.map_err(|e|e.to_string())?
}

#[tauri::command]
pub async fn provider_processes(app:AppHandle,mut ids:Vec<SessionId>)->Result<Vec<crate::agent_process::Observation>,String>{
    if ids.len()>256 {return Err("At most 256 terminal sessions can be inspected".into());}ids.sort_unstable();ids.dedup();
    tauri::async_runtime::spawn_blocking(move||{
        let sessions=app.state::<SessionManager>();let mut values=crate::agent_process::scan(sessions.process_targets(&ids));
        let alive:std::collections::HashSet<_>=sessions.process_targets(&ids).into_iter().filter(|target|!target.ended).map(|target|target.id).collect();
        for value in &mut values {if !alive.contains(&value.session){value.ended=true;value.providers=Some(vec![]);value.error=None;}}
        values
    }).await.map_err(|error|error.to_string())
}

/// Ends what runs in a pane's shell (the program and everything it started), keeping the shell.
#[tauri::command]
pub async fn stop_programs(app: AppHandle, id: SessionId) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move||app.state::<SessionManager>().stop_programs(id)).await.map_err(|e|e.to_string())?
}

/// Every listening TCP port with its process, and the pane session it runs under, if any.
#[tauri::command]
pub async fn listening_ports(sessions: State<'_, SessionManager>) -> Result<Vec<crate::ports::PortOwner>, String> {
    let processes = crate::procs::snapshot();
    Ok(crate::ports::owners(&crate::ports::listeners(), &processes, &sessions.shells()))
}

/// Ends the process listening on `port` and everything it started, if `pid` still
/// holds that port (ids get reused); returns the names of what ended.
#[tauri::command]
pub async fn end_port_owner(port: u16, pid: u32) -> Result<Vec<String>, String> {
    if !crate::ports::listeners().iter().any(|l| l.port == port && l.pid == pid) {
        return Err(format!("nothing with process id {pid} listens on port {port} any more"));
    }
    let processes = crate::procs::snapshot();
    let ended = crate::procs::terminate(&crate::procs::tree_of(&processes, pid));
    if ended.is_empty() {
        return Err(format!("Windows didn't let qterm end process {pid} (it may belong to the system or another user)"));
    }
    Ok(ended)
}

/// The project a pane's folder is in: git status, scripts and its `.qterm.toml`.
#[tauri::command]
pub async fn project_info(app:AppHandle,cwd: String,profile_id:Option<String>,environment:Option<String>) -> crate::project::ProjectInfo {
    tauri::async_runtime::spawn_blocking(move||{
        let result=(||{let profiles=all_profiles(&app.state::<SessionManager>(),&app.state::<ConfigState>());if let Some(distro)=crate::wsl::context(profile_id.as_deref(),environment.as_deref(),&profiles)?{crate::wsl::project(&distro,&cwd)}else{if cwd.starts_with('/')&&!cwd.starts_with("//"){return Err("A Linux folder requires an explicit WSL environment".into());}Ok(crate::project::info(std::path::Path::new(&cwd)))}})();
        result.unwrap_or_else(|e|crate::project::ProjectInfo{settings_error:Some(format!("Project discovery: {e}")),..Default::default()})
    }).await.unwrap_or_else(|e|crate::project::ProjectInfo{settings_error:Some(e.to_string()),..Default::default()})
}

#[tauri::command]
pub async fn wsl_distributions()->Result<Vec<String>,String>{tauri::async_runtime::spawn_blocking(crate::wsl::distributions).await.map_err(|e|e.to_string())?}
#[tauri::command]
pub async fn wsl_translate_paths(distribution:String,paths:Vec<String>,to_linux:bool)->Result<Vec<String>,String>{tauri::async_runtime::spawn_blocking(move||crate::wsl::translate(&distribution,&paths,to_linux)).await.map_err(|e|e.to_string())?}
#[tauri::command]
pub async fn create_wsl_agent_brief(distribution:String,text:String)->Result<crate::wsl::Brief,String>{tauri::async_runtime::spawn_blocking(move||crate::wsl::brief(&distribution,&text)).await.map_err(|e|e.to_string())?}
#[tauri::command]
pub async fn validate_wsl_folder(distribution:String,cwd:String)->Result<String,String>{tauri::async_runtime::spawn_blocking(move||crate::wsl::call(&distribution,serde_json::json!({"method":"folder","cwd":cwd}))?["cwd"].as_str().map(str::to_owned).ok_or_else(||"WSL returned no validated folder".into())).await.map_err(|e|e.to_string())?}

/// The image on the clipboard, saved as a PNG in the temp folder; None without one.
/// Async: reading the clipboard must stay off the main thread.
#[tauri::command]
pub async fn clipboard_image_file(app: AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_clipboard_manager::ClipboardExt;
    let Ok(image) = app.clipboard().read_image() else { return Ok(None) };
    let path = crate::paste::save_png(&crate::paste::images_dir(), image.rgba(), image.width(), image.height())?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

/// The size toggle: the console fills the work area, or goes back; returns whether it is full.
#[tauri::command]
pub fn toggle_console_size(app: AppHandle) -> bool {
    window::toggle_full(&app)
}

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
/// qterm's first start on this PC (it wrote the default settings): show the welcome hint.
#[tauri::command]
pub fn first_start(config: State<'_, ConfigState>) -> bool {
    config.first_start()
}

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


#[tauri::command]
pub fn list_codex_sessions(store: State<'_, crate::codex::Store>) -> Vec<ClaudeSession> { store.list() }

#[tauri::command]
pub async fn codex_session_seen(app: AppHandle, store: State<'_, crate::codex::Store>, index: State<'_, crate::codex::Index>,
    id: String, profile_id: String, pane_cwd: Option<String>,environment:Option<String>) -> Result<Vec<ClaudeSession>, String> {
    let sessions = store.remember_scoped(&index, &id, &profile_id, pane_cwd,environment)?;
    let _ = app.emit("codex-sessions-changed", &sessions);
    Ok(sessions)
}

#[tauri::command]
pub fn forget_codex_sessions(app: AppHandle, store: State<'_, crate::codex::Store>, ids: Option<Vec<String>>,references:Option<Vec<crate::session_library::Reference>>) -> Result<Vec<ClaudeSession>, String> {
    let sessions = match (ids,references){(Some(ids),None)=>store.forget(&ids)?,(None,Some(references))=>store.forget_scoped(&references)?,_=>return Err("Supply scoped references or legacy native IDs, not both".into())};
    let _ = app.emit("codex-sessions-changed", &sessions); Ok(sessions)
}

#[tauri::command]
pub async fn list_all_codex_sessions(index: State<'_, crate::codex::Index>) -> Result<Vec<crate::claude::TranscriptSummary>, String> {
    Ok(crate::codex::home().map(|h| index.scan(&h)).unwrap_or_default())
}

#[tauri::command]
pub async fn scan_codex_sessions(app: AppHandle) -> Result<crate::codex::ScanResult, String> {
    if !app.state::<ConfigState>().get().codex_sessions{return Err("Codex session history is disabled".into());}
    let home = absolute_source_home(crate::codex::home()).ok_or("No Codex home could be resolved from CODEX_HOME or USERPROFILE")?;
    tauri::async_runtime::spawn_blocking(move || {let result=app.state::<crate::codex::Index>().scan_with_diagnostics(&home);if !app.state::<ConfigState>().get().codex_sessions{return Err("Codex session history was disabled while scanning".to_string());}Ok(result)})
        .await.map_err(|error| error.to_string())?
}

#[tauri::command]
pub fn agent_integration_health(app: AppHandle, provider: crate::agent_health::Provider) -> Result<crate::agent_health::Snapshot, String> {
    app.state::<crate::agent_health::Health>().snapshot(&app, provider)
}

#[tauri::command]
pub async fn test_agent_delivery(app: AppHandle, provider: crate::agent_health::Provider) -> Result<crate::agent_health::Snapshot, String> {
    tauri::async_runtime::spawn_blocking(move || crate::agent_health::test_delivery(&app, provider)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn create_agent_brief(app: AppHandle, text: String) -> Result<crate::agent_brief::Brief, String> {
    let dir = app.path().app_local_data_dir().map_err(|e| e.to_string())?.join("agent-briefs");
    tauri::async_runtime::spawn_blocking(move || crate::agent_brief::create(&dir, &text)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn agent_inbox_snapshot(app: AppHandle) -> crate::agent_inbox::Snapshot {
    app.state::<crate::agent_inbox::Store>().snapshot()
}

#[tauri::command]
pub fn command_runs_snapshot(app: AppHandle) -> crate::run_records::Snapshot { app.state::<crate::run_records::Store>().snapshot() }

#[tauri::command]
pub async fn record_command_run(app: AppHandle, mut run: crate::run_records::Run, ticket: Option<String>) -> Result<crate::run_records::Snapshot, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let access=app.state::<crate::agent_access::Access>();
        let task_ticket=access.queue.record(&mut run)?;
        let recipes=app.state::<crate::recipes::Store>();
        let recipe_ticket=recipes.attest(&mut run)?;
        let id=run.id.clone(); let exit=run.exit_code; let finished=run.finished_at;
        let snapshot = app.state::<crate::run_records::Store>().append(run, recipe_ticket.as_deref().or(task_ticket.as_deref()).or(ticket.as_deref()))?;
        access.completed(&id,exit,finished);
        recipes.completed(&id,exit,finished);
        let _=app.emit("recipe-runs-changed",recipes.snapshot());
        let _=app.emit("agent-access-changed",access.snapshot());
        let _ = app.emit("command-runs-changed", &snapshot); Ok(snapshot)
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn command_runs_action(app: AppHandle, action: crate::run_records::Action) -> Result<crate::run_records::Snapshot, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let snapshot = app.state::<crate::run_records::Store>().act(action)?;
        let _ = app.emit("command-runs-changed", &snapshot); Ok(snapshot)
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn prepare_verification(app: AppHandle, cwd: String, command: String,profile_id:Option<String>,environment:Option<String>) -> Result<crate::run_records::Prepared, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let profiles=all_profiles(&app.state::<SessionManager>(),&app.state::<ConfigState>());
        let store=app.state::<crate::run_records::Store>();
        if let Some(id)=&profile_id{
            let profile=profiles.iter().find(|profile|&profile.id==id).ok_or("The original verification shell is unavailable")?;
            profile.check_environment(environment.as_deref())?;
            if profile.distribution.is_none()&&!profile.native_agent_context(){return Err("This shell cannot prepare repository verification".into());}
        }
        let prepared=if let Some(distribution)=crate::wsl::context(profile_id.as_deref(),environment.as_deref(),&profiles)?{
            let profile=profiles.iter().find(|profile|Some(&profile.id)==profile_id.as_ref()).ok_or("Choose the original WSL profile before preparing verification")?;
            store.prepare_wsl(&distribution,&cwd,&command,profile)?
        }else{store.prepare(&cwd,&command)?};
        if let Some(launch)=&prepared.launch&&let Err(error)=verification_profile(launch,&all_profiles(&app.state::<SessionManager>(),&app.state::<ConfigState>())){store.cancel(&prepared.id);return Err(error);}
        Ok(prepared)
    }).await.map_err(|e| e.to_string())?
}

fn verification_profile(launch:&crate::run_records::VerificationLaunch,profiles:&[Profile])->Result<(),String>{
    let profile=profiles.iter().find(|profile|profile.id==launch.profile_id).ok_or("The reviewed verification shell is unavailable")?;
    profile.check_environment(Some(&launch.environment))?;profile.check_kind(Some("wsl"))?;
    if profile.launch_key()!=launch.profile_key{return Err("The reviewed verification shell configuration changed".into());}Ok(())
}

#[tauri::command]
pub async fn authorize_verification(app:AppHandle,ticket:String,pane_id:String,session:SessionId,cwd:String)->Result<(),String>{
    tauri::async_runtime::spawn_blocking(move||{
        let store=app.state::<crate::run_records::Store>();let context=store.launch_context(&ticket)?;
        let distribution=context.environment.strip_prefix("wsl:").ok_or("Verification environment is unavailable")?;
        let actual=crate::wsl::call(distribution,serde_json::json!({"method":"folder","cwd":cwd}))?.get("cwd").and_then(serde_json::Value::as_str).ok_or("Linux verification folder identity is unavailable")?.to_owned();
        store.authorize_wsl(&ticket,&pane_id,&|launch|{
            if !app.state::<ConfigState>().get().shell_integration{return Err("Shell integration was disabled before verification startup".into());}
            verification_profile(launch,&all_profiles(&app.state::<SessionManager>(),&app.state::<ConfigState>()))?;
            if actual!=launch.cwd||app.state::<SessionManager>().launch_binding(session)!=Some((pane_id.clone(),launch.profile_key.clone())){return Err("The verification pane no longer matches its reviewed shell and folder".into());}Ok(())
        })
    }).await.map_err(|e|e.to_string())?
}

#[tauri::command]
pub fn cancel_verification(app: AppHandle, ticket: String) { app.state::<crate::run_records::Store>().cancel(&ticket); }

#[tauri::command]
pub async fn refresh_verification(app: AppHandle) -> Result<crate::run_records::Snapshot, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let snapshot = app.state::<crate::run_records::Store>().refresh();
        let _ = app.emit("command-runs-changed", &snapshot); snapshot
    }).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn worktree_tasks_snapshot(app: AppHandle) -> Result<crate::worktree_tasks::Snapshot, String> {
    tauri::async_runtime::spawn_blocking(move || app.state::<crate::worktree_tasks::Store>().snapshot()).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub fn agent_access_snapshot(app: AppHandle) -> crate::agent_access::Snapshot { app.state::<crate::agent_access::Access>().snapshot() }

fn absolute_source_home(home:Option<std::path::PathBuf>)->Option<std::path::PathBuf>{home.and_then(|home|{let absolute=if home.is_absolute(){home}else{std::env::current_dir().ok()?.join(home)};Some(absolute.canonicalize().unwrap_or(absolute))})}
fn library_snapshot(app:&AppHandle,refresh:bool)->crate::session_library::Snapshot {
    use crate::session_library::{Enabled,Provider,Scan};let config=app.state::<ConfigState>();let mut scans=vec![];
    if refresh && config.get().claude_sessions {
        let home=absolute_source_home(crate::claude::claude_home());let (sessions,errors)=home.as_deref().map(|home|app.state::<crate::claude::TranscriptIndex>().scan_with_diagnostics(home)).unwrap_or((vec![],vec!["No Claude home is available".into()]));
        scans.push(Scan{provider:Provider::Claude,home:home.map(|p|crate::repo_state::display(&p)),sessions,errors});
    }
    if refresh && config.get().codex_sessions {
        let home=absolute_source_home(crate::codex::home());let (sessions,errors)=home.as_deref().map(|home|{
            let scan=app.state::<crate::codex::Index>().scan_with_diagnostics(home);let mut errors=scan.diagnostics.errors;
            if scan.diagnostics.missing_sessions_folder{errors.push("Codex sessions folder was not found".into());}
            if scan.diagnostics.unrecognized_files>0{errors.push(format!("{} unrecognized Codex files",scan.diagnostics.unrecognized_files));}
            (scan.sessions,errors)
        }).unwrap_or((vec![],vec!["No Codex home is available".into()]));
        scans.push(Scan{provider:Provider::Codex,home:home.map(|p|crate::repo_state::display(&p)),sessions,errors});
    }
    let current=config.get();let enabled=Enabled{claude:current.claude_sessions,codex:current.codex_sessions};
    let remembered=vec![(Provider::Claude,if enabled.claude{app.state::<ClaudeStore>().list()}else{vec![]}),(Provider::Codex,if enabled.codex{app.state::<crate::codex::Store>().list()}else{vec![]})];
    let mut scans:Vec<_>=scans.into_iter().map(|scan|crate::session_library::ScopedScan{environment:"native".into(),signature:String::new(),scan}).collect();
    if refresh{scans.extend(app.state::<crate::wsl_sources::State>().scan(&current));}
    let current=config.get();let enabled=Enabled{claude:current.claude_sessions,codex:current.codex_sessions};
    app.state::<crate::wsl_sources::State>().retain(&current);
    let mut snapshot=app.state::<crate::session_library::Store>().catalog_sources(&remembered,enabled,crate::wsl_sources::configs(&current),scans);snapshot.source_revision=serde_json::to_string(&current.wsl_sources).unwrap();snapshot
}
#[tauri::command]
pub async fn load_session_library(app:AppHandle,refresh:bool)->Result<crate::session_library::Snapshot,String>{tauri::async_runtime::spawn_blocking(move||library_snapshot(&app,refresh)).await.map_err(|e|e.to_string())}
#[tauri::command]
pub async fn resolve_library_session(app:AppHandle,key:String,source_version:Option<String>,require_folder:Option<bool>)->Result<crate::session_library::Entry,String>{tauri::async_runtime::spawn_blocking(move||{
    let entry=library_snapshot(&app,true).entries.into_iter().find(|e|e.key==key&&e.available).ok_or("Session is not available in the enabled transcript sources")?;
    if source_version.is_none()||source_version!=entry.source_version{return Err("The transcript source/home changed; refresh and review the session again".into());}
    validate_library_entry(&app,entry,require_folder.unwrap_or(true))
}).await.map_err(|e|e.to_string())?}
#[tauri::command]
pub async fn resolve_provider_session(app:AppHandle,identity:crate::session_library::Identity)->Result<crate::session_library::Entry,String>{tauri::async_runtime::spawn_blocking(move||{
    identity.validate()?;
    if identity.environment=="unknown"{return Err("This session's environment was not captured. Use Session library to discover and review its source, or copy its UUID for a manual resume".into());}
    let entry=library_snapshot(&app,true).entries.into_iter().find(|entry|entry.identity==identity&&entry.available).ok_or("Session is unavailable in its enabled source. Enable/discover it in Session library, or copy its resume command for a manual handoff")?;
    validate_library_entry(&app,entry,true)
}).await.map_err(|e|e.to_string())?}
fn validate_library_entry(app:&AppHandle,mut entry:crate::session_library::Entry,require_folder:bool)->Result<crate::session_library::Entry,String>{
    let config=app.state::<ConfigState>();let authorization=crate::wsl_sources::authorization(&config.get(),&entry.identity)?;
    if entry.source_config.as_deref()!=Some(authorization.as_str()){return Err("The transcript source settings changed while scanning; review it again".into());}
    if require_folder{let cwd=entry.cwd.as_deref().ok_or("Session folder is unknown")?;entry.launch_cwd=Some(if let Some(distro)=entry.identity.environment.strip_prefix("wsl:"){crate::wsl::call(distro,serde_json::json!({"method":"folder","cwd":cwd}))?["cwd"].as_str().ok_or("WSL returned no validated folder")?.into()}else{crate::repo_state::display(&crate::repo_state::native_folder(cwd)?)});}
    if authorization!=crate::wsl_sources::authorization(&config.get(),&entry.identity)?{return Err("The transcript source settings changed while validating the session".into());}Ok(entry)
}
#[tauri::command]
pub fn session_pins_snapshot(app:AppHandle)->crate::session_library::Pins{app.state::<crate::session_library::Store>().pins()}
#[tauri::command]
pub async fn pin_library_session(app:AppHandle,identity:crate::session_library::Identity,pinned:bool)->Result<crate::session_library::Pins,String>{tauri::async_runtime::spawn_blocking(move||{let pins=app.state::<crate::session_library::Store>().pin(identity,pinned)?;let _=app.emit("session-pins-changed",&pins);Ok(pins)}).await.map_err(|e|e.to_string())?}
#[tauri::command]
pub async fn session_pins_action(app:AppHandle,action:String)->Result<crate::session_library::Pins,String>{tauri::async_runtime::spawn_blocking(move||{let pins=app.state::<crate::session_library::Store>().pins_action(&action)?;let _=app.emit("session-pins-changed",&pins);Ok(pins)}).await.map_err(|e|e.to_string())?}

#[tauri::command]
pub async fn review_recipes(app:AppHandle,cwd:String,profile_id:String)->Result<crate::recipes::Review,String> {
    tauri::async_runtime::spawn_blocking(move || {let profiles=all_profiles(&app.state::<SessionManager>(),&app.state::<ConfigState>());let profile=profiles.iter().find(|p|p.id==profile_id).ok_or("Shell profile not found")?;app.state::<crate::recipes::Store>().review(&cwd,profile)}).await.map_err(|e|e.to_string())?
}
#[tauri::command]
pub fn cancel_recipe_review(app:AppHandle,id:String){app.state::<crate::recipes::Store>().cancel_review(&id);}
#[tauri::command]
pub fn recipe_runs_snapshot(app:AppHandle)->Vec<crate::recipes::Run>{app.state::<crate::recipes::Store>().snapshot()}
#[tauri::command]
pub async fn start_recipe(app:AppHandle,review_id:String,name:String,bindings:std::collections::HashMap<String,String>)->Result<crate::recipes::Run,String>{
    tauri::async_runtime::spawn_blocking(move || {let profiles=all_profiles(&app.state::<SessionManager>(),&app.state::<ConfigState>());let store=app.state::<crate::recipes::Store>();let result=store.start(&review_id,&name,bindings,&profiles,app.state::<ConfigState>().get().shell_integration);let _=app.emit("recipe-runs-changed",store.snapshot());result}).await.map_err(|e|e.to_string())?
}
#[tauri::command]
pub async fn launch_recipe_step(app:AppHandle,id:String,pane_id:String,session:u32,cwd:String)->Result<crate::recipes::Run,String>{
    tauri::async_runtime::spawn_blocking(move || {
        let profiles=all_profiles(&app.state::<SessionManager>(),&app.state::<ConfigState>());let sessions=app.state::<SessionManager>();let records=app.state::<crate::run_records::Store>();let store=app.state::<crate::recipes::Store>();
        let revalidate=|expected:&Profile|{
            if !app.state::<ConfigState>().get().shell_integration{return Err("Shell integration changed before workflow submission".into());}
            let current=all_profiles(&app.state::<SessionManager>(),&app.state::<ConfigState>());
            let actual=current.iter().find(|profile|profile.id==expected.id).ok_or("Reviewed workflow shell is unavailable")?;
            if actual.launch_key()!=expected.launch_key(){return Err("Workflow shell configuration changed; review again".into());}Ok(())
        };
        let result=store.launch(&id,&pane_id,session,crate::recipes::Launch{revalidate:&revalidate,cwd:&cwd,sessions:&sessions,profiles:&profiles,integrate:app.state::<ConfigState>().get().shell_integration,records:&records});let _=app.emit("recipe-runs-changed",store.snapshot());result
    }).await.map_err(|e|e.to_string())?
}
#[derive(serde::Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct RecipeOutput {id:String,pane_id:String,session:u32,sequence:u64,text:String}
#[tauri::command]
pub fn recipe_step_output(app:AppHandle,observation:RecipeOutput)->Result<(),String>{let store=app.state::<crate::recipes::Store>();store.output(&observation.id,&observation.pane_id,observation.session,observation.sequence,&observation.text,&app.state::<SessionManager>())}
#[tauri::command]
pub fn fail_recipe_step(app:AppHandle,id:String,message:String){let store=app.state::<crate::recipes::Store>();store.fail(&id,&message,&app.state::<crate::run_records::Store>());let _=app.emit("recipe-runs-changed",store.snapshot());}
#[tauri::command]
pub fn cancel_recipe_run(app:AppHandle,id:String)->Result<(),String>{let store=app.state::<crate::recipes::Store>();let result=store.cancel_pending(&id);let _=app.emit("recipe-runs-changed",store.snapshot());result}
#[tauri::command]
pub async fn stop_recipe_run(app:AppHandle,id:String)->Result<(),String>{tauri::async_runtime::spawn_blocking(move || {let store=app.state::<crate::recipes::Store>();let result=store.stop(&id,&app.state::<SessionManager>());let _=app.emit("recipe-runs-changed",store.snapshot());result}).await.map_err(|e|e.to_string())?}
#[tauri::command]
pub async fn review_agent_access(app: AppHandle, cwd: String, profile_id: Option<String>,environment:Option<String>) -> Result<crate::agent_access::Review, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let access=app.state::<crate::agent_access::Access>();
        let environment=environment.as_deref().unwrap_or("native");
        let profiles=all_profiles(&app.state::<SessionManager>(),&app.state::<ConfigState>());
        let profile=profile_id.as_ref().map(|id|profiles.iter().find(|p|p.id==*id).ok_or("Shell profile not found")).transpose()?;
        if environment=="native" {if profile.is_some(){access.review_execution(&cwd,profile)}else{access.review(&cwd)}}else{access.review_environment(&cwd,environment,profile)}
    }).await.map_err(|e| e.to_string())?
}
#[tauri::command]
pub fn cancel_agent_access_review(app: AppHandle, id: String) { app.state::<crate::agent_access::Access>().cancel_review(&id); }
#[tauri::command]
pub async fn grant_agent_access(app: AppHandle, review: String, client: String, task_ids: Option<Vec<String>>) -> Result<crate::agent_access::Snapshot, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let handler_app = app.clone();
        let handler = std::sync::Arc::new(move |request:serde_json::Value| {
            let access=handler_app.state::<crate::agent_access::Access>(); let modified=request.get("method").and_then(|v|v.as_str())==Some("tasks.run");
            let profiles=all_profiles(&handler_app.state::<SessionManager>(),&handler_app.state::<ConfigState>());
            let emit=|job:&crate::agent_tasks::Invocation| handler_app.emit("agent-task-queued",&job.id).map_err(|e|e.to_string());
            let context=crate::agent_access::ExecutionContext { profiles:&profiles,integrate:handler_app.state::<ConfigState>().get().shell_integration,emit:&emit };
            let result=access.request_execution(request,&handler_app.state::<crate::run_records::Store>(),Some(context));
            if modified { let _=handler_app.emit("agent-access-changed",access.snapshot()); } result
        });
        let access=app.state::<crate::agent_access::Access>(); let ids=task_ids.unwrap_or_default();
        let snapshot=if ids.is_empty() { access.grant(&review,&client,handler)? } else {
            if !app.state::<ConfigState>().get().shell_integration { return Err("Enable shell integration before granting task execution".into()); }
            let profile_id=access.review_profile(&review).ok_or("No shell was reviewed")?;
            let profiles=all_profiles(&app.state::<SessionManager>(),&app.state::<ConfigState>());
            let profile=profiles.iter().find(|p|p.id==profile_id).ok_or("Reviewed shell is unavailable")?;
            access.grant_selected(&review,&client,&ids,Some(profile),handler)?
        };
        let _ = app.emit("agent-access-changed", &snapshot); Ok(snapshot)
    }).await.map_err(|e| e.to_string())?
}
#[tauri::command]
pub fn revoke_agent_access(app: AppHandle, id: String) -> Result<crate::agent_access::Snapshot, String> {
    let snapshot = app.state::<crate::agent_access::Access>().revoke(&id)?; let _ = app.emit("agent-access-changed", &snapshot); Ok(snapshot)
}
#[tauri::command]
pub fn publish_agent_panes(app: AppHandle, panes: Vec<crate::agent_access::Pane>) -> Result<(), String> { app.state::<crate::agent_access::Access>().publish(panes) }

#[tauri::command]
pub async fn claim_agent_task(app:AppHandle,id:String,pane_id:String)->Result<crate::agent_tasks::Invocation,String> {
    tauri::async_runtime::spawn_blocking(move || {
        let access=app.state::<crate::agent_access::Access>(); let profiles=all_profiles(&app.state::<SessionManager>(),&app.state::<ConfigState>());
        let result=access.claim(&id,&pane_id,&profiles,app.state::<ConfigState>().get().shell_integration);
        if let Err(e)=&result && access.queue.get(&id).is_ok_and(|j|j.state=="queued") { access.fail(&id,e,&app.state::<crate::run_records::Store>()); }
        let _=app.emit("agent-access-changed",access.snapshot()); result
    }).await.map_err(|e|e.to_string())?
}
#[tauri::command]
pub async fn launch_agent_task(app:AppHandle,id:String,pane_id:String,session:u32,cwd:String)->Result<crate::agent_tasks::Invocation,String> {
    tauri::async_runtime::spawn_blocking(move || {
        let access=app.state::<crate::agent_access::Access>(); let profiles=all_profiles(&app.state::<SessionManager>(),&app.state::<ConfigState>());
        let sessions=app.state::<SessionManager>(); let records=app.state::<crate::run_records::Store>();
        let revalidate=|expected:&Profile|{
            if !app.state::<ConfigState>().get().shell_integration{return Err("Shell integration changed before task submission".into());}
            let current=all_profiles(&app.state::<SessionManager>(),&app.state::<ConfigState>());
            let actual=current.iter().find(|profile|profile.id==expected.id).ok_or("Reviewed task shell is unavailable")?;
            if actual.launch_key()!=expected.launch_key(){return Err("Task shell configuration changed; review again".into());}Ok(())
        };
        let context=crate::agent_access::LaunchContext {revalidate:&revalidate,cwd:&cwd,sessions:&sessions,profiles:&profiles,integrate:app.state::<ConfigState>().get().shell_integration,records:&records};
        let result=access.launch(&id,&pane_id,session,context);
        if let Err(e)=&result { access.fail(&id,e,&app.state::<crate::run_records::Store>()); }
        let _=app.emit("agent-access-changed",access.snapshot()); result
    }).await.map_err(|e|e.to_string())?
}
#[tauri::command]
pub fn fail_agent_task(app:AppHandle,id:String,message:String) { let access=app.state::<crate::agent_access::Access>(); access.fail(&id,&message,&app.state::<crate::run_records::Store>()); let _=app.emit("agent-access-changed",access.snapshot()); }
#[tauri::command]
pub async fn stop_agent_task(app:AppHandle,id:String)->Result<(),String> { tauri::async_runtime::spawn_blocking(move || { let access=app.state::<crate::agent_access::Access>(); let result=access.stop(&id,&app.state::<SessionManager>(),&app.state::<crate::run_records::Store>()); let _=app.emit("agent-access-changed",access.snapshot()); result }).await.map_err(|e|e.to_string())? }
#[tauri::command]
pub async fn preview_worktree_task(app: AppHandle, draft: crate::worktree_tasks::Draft) -> Result<crate::worktree_tasks::Preview, String> {
    tauri::async_runtime::spawn_blocking(move || {let profiles=all_profiles(&app.state::<SessionManager>(),&app.state::<ConfigState>());let profile=profiles.iter().find(|p|p.id==draft.profile_id).ok_or("The selected shell is unavailable")?;app.state::<crate::worktree_tasks::Store>().preview_profile(draft,profile)}).await.map_err(|e| e.to_string())?
}
#[tauri::command]
pub fn cancel_worktree_preview(app: AppHandle, token: String) { app.state::<crate::worktree_tasks::Store>().cancel(&token); }
#[tauri::command]
pub async fn create_worktree_task(app: AppHandle, token: String) -> Result<crate::worktree_tasks::Snapshot, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let store = app.state::<crate::worktree_tasks::Store>(); let result = store.create_reviewed(&token,&||all_profiles(&app.state::<SessionManager>(),&app.state::<ConfigState>()));
        let _ = app.emit("worktree-tasks-changed", store.snapshot()); result
    }).await.map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn worktree_task_action(app: AppHandle, action: String, task_id: Option<String>) -> Result<crate::worktree_tasks::Snapshot, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let store = app.state::<crate::worktree_tasks::Store>(); let result = store.action(&action, task_id.as_deref());
        let _ = app.emit("worktree-tasks-changed", store.snapshot()); result
    }).await.map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn worktree_task_details(app: AppHandle, task_id: String) -> Result<crate::worktree_tasks::Details, String> {
    tauri::async_runtime::spawn_blocking(move || app.state::<crate::worktree_tasks::Store>().details(&task_id)).await.map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn prepare_worktree_open(app:AppHandle,task_id:String,agent:bool)->Result<crate::worktree_tasks::Task,String>{
    tauri::async_runtime::spawn_blocking(move||app.state::<crate::worktree_tasks::Store>().prepare_open(&task_id,agent,&||all_profiles(&app.state::<SessionManager>(),&app.state::<ConfigState>()))).await.map_err(|e|e.to_string())?
}
#[tauri::command]
pub async fn validate_worktree_startup(app:AppHandle,task_id:String,pane_id:String,session:SessionId,cwd:String)->Result<(),String>{
    tauri::async_runtime::spawn_blocking(move||{
        if !app.state::<ConfigState>().get().shell_integration{return Err("Shell integration was disabled before task startup".into());}
        let task=app.state::<crate::worktree_tasks::Store>().prepare_open(&task_id,true,&||all_profiles(&app.state::<SessionManager>(),&app.state::<ConfigState>()))?;
        let actual=if let Some(distro)=task.environment.as_deref().and_then(|e|e.strip_prefix("wsl:")){crate::wsl::call(distro,serde_json::json!({"method":"folder","cwd":cwd}))?.get("cwd").and_then(serde_json::Value::as_str).ok_or("Missing Linux folder identity")?.to_owned()}else{crate::repo_state::display(&crate::repo_state::native_folder(&cwd)?)};
        if actual!=task.directory{return Err("The task shell changed its reviewed folder".into());}
        let profiles=all_profiles(&app.state::<SessionManager>(),&app.state::<ConfigState>());crate::worktree_tasks::Store::validate_profile(&task,&profiles)?;
        let profile=profiles.iter().find(|p|p.id==task.profile_id).ok_or("Task shell is unavailable")?;
        if app.state::<SessionManager>().launch_binding(session)!=Some((pane_id,profile.launch_key())){return Err("The task shell no longer matches its reviewed launch configuration".into());}Ok(())
    }).await.map_err(|e|e.to_string())?
}

#[tauri::command]
pub async fn agent_inbox_action(app: AppHandle, action: crate::agent_inbox::Action, ids: Vec<String>) -> Result<crate::agent_inbox::Snapshot, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let snapshot = app.state::<crate::agent_inbox::Store>().act(action, &ids)?;
        let _ = app.emit("agent-inbox-changed", &snapshot);
        Ok(snapshot)
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn codex_usage_many(app: AppHandle, ids: Vec<String>) -> Result<Vec<crate::codex::Usage>, String> {
    if ids.len() > 256 || ids.iter().any(|id| !crate::codex::valid_id(id)) {
        return Err("Expected at most 256 valid Codex session ids".into());
    }
    let home = crate::codex::home().ok_or("No home folder for Codex")?;
    tauri::async_runtime::spawn_blocking(move || app.state::<crate::codex::Index>().usage_many(&home, &ids))
        .await.map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn codex_running(sessions: State<'_, SessionManager>) -> Result<Vec<SessionId>, String> { Ok(sessions.running("codex.exe")) }

#[tauri::command]
pub async fn codex_usage(index: State<'_, crate::codex::Index>, id: String) -> Result<Option<crate::codex::Usage>, String> {
    if !crate::codex::valid_id(&id) { return Err("invalid Codex session id".into()) }
    Ok(crate::codex::home().and_then(|h| index.usage(&h, &id)))
}

#[tauri::command]
pub fn set_codex_plan_summary(app: AppHandle, summary: Option<String>) {
    crate::tray::set_codex_plan(&app, summary);
}

fn codex_hook_paths() -> Result<(std::path::PathBuf, String), String> {
    let home = crate::codex::home().ok_or("no home folder for Codex")?;
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    Ok((crate::codex_hook::settings_path(&home), crate::codex_hook::command_for(&exe)))
}

#[tauri::command]
pub fn codex_hook_status() -> Result<crate::codex_hook::HookStatus, String> {
    let (path, command) = codex_hook_paths()?; crate::codex_hook::status(&path, &command)
}
#[tauri::command]
pub fn install_codex_hook() -> Result<crate::codex_hook::HookStatus, String> {
    let (path, command) = codex_hook_paths()?; crate::codex_hook::install(&path, &command)?; crate::codex_hook::status(&path, &command)
}
#[tauri::command]
pub fn remove_codex_hook() -> Result<crate::codex_hook::HookStatus, String> {
    let (path, command) = codex_hook_paths()?; crate::codex_hook::remove(&path)?; crate::codex_hook::status(&path, &command)
}
