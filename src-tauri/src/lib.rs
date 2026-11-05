mod alerts;
mod agent_health;
mod agent_brief;
mod agent_inbox;
mod agent_access;
mod agent_tasks;
mod agent_scope;
mod agent_pipe;
mod process_owner;
mod agent_process;
mod repo_state;
mod run_records;
mod worktree_tasks;
mod recipes;
mod session_library;
mod wsl;
mod wsl_workflows;
mod wsl_tasks;
mod wsl_sources;
mod wsl_owner;
mod wsl_windows_job;
mod wsl_verification_monitor;
mod claude;
mod claude_hook;
mod claude_statusline;
mod claude_usage;
mod codex;
#[cfg(test)]
mod codex_benchmark;
mod codex_hook;
mod commands;
mod config;
mod diagnostics;
mod editor;
mod elevation;
mod explorer;
mod hotkey;
mod install;
#[macro_use]
mod log;
mod paste;
mod ports;
mod procs;
mod project;
mod pty;
mod scrollback;
mod tray;
mod updater;
mod whats_new;
mod window;
mod wt_import;

use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager, WindowEvent};
use tauri_plugin_global_shortcut::ShortcutState;

use config::{ConfigState, Reload};

pub use alerts::{run_hook as run_claude_hook, HOOK_ARG};
pub use updater::wait_for_previous;
pub use alerts::run_codex_hook;
pub use agent_access::run_client as run_agent_client;
pub use codex_hook::HOOK_ARG as CODEX_HOOK_ARG;
pub use claude_statusline::STATUSLINE_ARG;

/// `--claude-statusline`: Claude Code's status line command (see claude_statusline.rs).
pub fn run_claude_statusline(args: &[String]) {
    claude_statusline::run(args)
}

/// Autostart launches with this: stay hidden until the hotkey is pressed.
const BACKGROUND_ARG: &str = "--background";

/// Keeps the alert-inbox watcher alive for the app's lifetime.
struct Watchers(#[allow(dead_code)] Mutex<Vec<notify::RecommendedWatcher>>);

/// The settings file's watcher; replaced when the settings move to another folder.
struct ConfigWatcher(Mutex<Option<notify::RecommendedWatcher>>);

/// Watches the settings file where it is now.
fn watch_config(app: &AppHandle) {
    let path = app.state::<ConfigState>().path();
    let handle = app.clone();
    let watcher = config::watch(path, move || on_config_file_changed(&handle))
        .inspect_err(|e| qlog!("settings will not reload live: {e}"))
        .ok();
    match app.try_state::<ConfigWatcher>() {
        Some(slot) => *slot.0.lock().unwrap() = watcher,
        None => {
            app.manage(ConfigWatcher(Mutex::new(watcher)));
        }
    }
}

/// Settings → Settings file: config.toml moves to `folder` (None: back home), the
/// watcher follows, and the settings found there apply at once.
pub(crate) fn set_settings_folder(app: &AppHandle, folder: Option<&std::path::Path>) -> Result<config::Relocated, String> {
    let outcome = app.state::<ConfigState>().relocate(folder)?;
    qlog!("settings now in {}", app.state::<ConfigState>().path().display());
    watch_config(app);
    on_config_file_changed(app);
    Ok(outcome)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    log::log_panics();
    if let Err(error) = process_owner::ensure() { qlog!("{error}"); }
    tauri::Builder::default()
        // Must be registered first: a second launch only toggles the running instance.
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| match explorer::open_here_arg(&args) {
            Some(dir) => explorer::open_here(app, dir),
            None => window::toggle(app),
        }))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state == ShortcutState::Pressed && hotkey::is_console_key(app, shortcut) {
                        window::toggle(app);
                    }
                })
                .build(),
        )
        .plugin(tauri_plugin_autostart::Builder::new().arg(BACKGROUND_ARG).build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(updater::UpdateState::default())
        .manage(explorer::PendingOpenHere::default())
        .manage(pty::SessionManager::default())
        .manage(window::QuakeState::default())
        .manage(hotkey::HotkeyState::default())
        .manage(codex::Index::default())
        .manage(wsl_sources::State::default())
        .manage(agent_health::Health::default())
        .manage(claude::TranscriptIndex::default())
        .manage(claude_usage::UsageIndex::default())
        .setup(|app| {
            log::init(&app.path().app_local_data_dir()?.join("logs"));
            let kind = if install::this_is_installed() { "installed" } else { "portable" };
            qlog!("qterm {} ({kind}) starting: {}", app.package_info().version, std::env::args().collect::<Vec<_>>().join(" "));

            // Before anything can open a PTY: the first one fixes which ConPTY is used.
            let host = match pty::conpty::install(&app.path().app_local_data_dir()?) {
                pty::conpty::Host::Bundled { version, dir } => format!("ConPTY {version} from {}", dir.display()),
                pty::conpty::Host::Inbox { reason } => format!("Windows' built-in ConPTY: {reason}"),
            };
            qlog!("console host: {host}");
            app.manage(diagnostics::ConsoleHost(host));

            let config_dir = app.path().app_config_dir()?;
            let config = ConfigState::load(&config_dir);
            if let Some(error) = config.snapshot().error {
                qlog!("{error}");
            }
            app.manage(config);
            app.manage(agent_inbox::Store::load(app.path().app_local_data_dir()?.join("agent-inbox.json")));
            app.manage(run_records::Store::load(app.path().app_local_data_dir()?.join("command-runs.json")));
            app.manage(agent_access::Access::new(app.path().app_local_data_dir()?.join("agent-connections")));
            app.manage(recipes::Store::default());
            app.manage(session_library::Store::load(app.path().app_local_data_dir()?.join("session-pins.json")));
            app.manage(worktree_tasks::Store::load(app.path().app_local_data_dir()?.join("worktree-tasks.json")));
            app.manage(codex::Store::load(&config_dir));
            app.manage(claude::ClaudeStore::load(&config_dir, claude::claude_home()));
            app.manage(scrollback::ScrollbackStore::new(app.path().app_local_data_dir()?.join("scrollback")));

            // Another app may already own the key; the tray says so and still toggles.
            if let Err(e) = hotkey::apply(app.handle()) {
                qlog!("could not register the hotkey: {e}");
            }
            tray::create(app.handle())?;
            updater::remove_previous_exe();
            explorer::apply(app.handle());
            let args: Vec<String> = std::env::args().collect();
            *app.state::<explorer::PendingOpenHere>().0.lock().unwrap() = explorer::open_here_arg(&args);
            updater::start_checking(app.handle().clone());
            window::apply_effect(app.handle());
            tray::repoint_autostart(app.handle());

            watch_config(app.handle());
            let alert_watcher = alerts::watch_inbox(app.handle().clone())
                .inspect_err(|e| qlog!("Claude alerts unavailable: {e}"))
                .ok();
            app.manage(Watchers(Mutex::new(alert_watcher.into_iter().collect())));

            if updater::just_updated(app.handle()) || !std::env::args().any(|arg| arg == BACKGROUND_ARG) {
                window::show_when_ready(app.handle());
            }
            Ok(())
        })
        .on_window_event(|win, event| {
            if let WindowEvent::Focused(false) = event {
                let app = win.app_handle();
                if app.state::<ConfigState>().get().hide_on_blur && !window::is_pinned(app) {
                    window::dismiss(app);
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_config,
            commands::list_profiles,
            commands::pty_spawn,
            commands::pty_ready,
            commands::pty_write,
            commands::pty_ack,
            commands::pty_resize,
            commands::pty_kill,
            commands::hide_window,
            commands::ui_ready,
            commands::load_session,
            commands::save_session,
            commands::load_history,
            commands::save_history,
            commands::load_workspaces,
            commands::save_workspaces,
            commands::list_codex_sessions,
            commands::codex_session_seen,
            commands::forget_codex_sessions,
            commands::list_all_codex_sessions,
            commands::scan_codex_sessions,
            commands::agent_integration_health,
            commands::test_agent_delivery,
            commands::create_agent_brief,
            commands::agent_inbox_snapshot,
            commands::agent_inbox_action,
            commands::command_runs_snapshot,
            commands::record_command_run,
            commands::command_runs_action,
            commands::prepare_verification,
            commands::authorize_verification,
            commands::cancel_verification,
            commands::refresh_verification,
            commands::worktree_tasks_snapshot,
            commands::agent_access_snapshot,
            commands::load_session_library,
            commands::resolve_library_session,
            commands::resolve_provider_session,
            commands::session_pins_snapshot,
            commands::pin_library_session,
            commands::session_pins_action,
            commands::review_recipes,
            commands::cancel_recipe_review,
            commands::recipe_runs_snapshot,
            commands::start_recipe,
            commands::launch_recipe_step,
            commands::recipe_step_output,
            commands::fail_recipe_step,
            commands::cancel_recipe_run,
            commands::stop_recipe_run,
            commands::review_agent_access,
            commands::cancel_agent_access_review,
            commands::grant_agent_access,
            commands::revoke_agent_access,
            commands::publish_agent_panes,
            commands::claim_agent_task,
            commands::launch_agent_task,
            commands::fail_agent_task,
            commands::stop_agent_task,
            commands::preview_worktree_task,
            commands::cancel_worktree_preview,
            commands::create_worktree_task,
            commands::worktree_task_action,
            commands::worktree_task_details,
            commands::prepare_worktree_open,
            commands::validate_worktree_startup,
            commands::codex_usage_many,
            commands::codex_running,
            commands::codex_usage,
            commands::set_codex_plan_summary,
            commands::codex_hook_status,
            commands::install_codex_hook,
            commands::remove_codex_hook,
            commands::list_claude_sessions,
            commands::claude_session_seen,
            commands::forget_claude_sessions,
            commands::save_config,
            commands::open_config_file,
            commands::export_settings,
            commands::set_settings_folder,
            commands::import_settings,
            commands::get_autostart,
            commands::set_autostart,
            commands::resize_console,
            commands::save_console_height,
            commands::resolve_files,
            commands::open_in_editor,
            commands::save_output,
            commands::show_claude_alert,
            commands::set_attention_count,
            commands::claude_hook_status,
            commands::install_claude_hook,
            commands::remove_claude_hook,
            commands::claude_statusline_status,
            commands::install_claude_statusline,
            commands::remove_claude_statusline,
            commands::show_plan_warning,
            commands::set_plan_summary,
            commands::save_layout,
            commands::windows_terminal_profiles,
            commands::import_windows_terminal_profiles,
            commands::delete_layout,
            commands::list_all_claude_sessions,
            commands::claude_running,
            commands::provider_processes,
            commands::stop_programs,
            commands::project_info,
            commands::wsl_distributions,
            commands::wsl_translate_paths,
            commands::create_wsl_agent_brief,
            commands::validate_wsl_folder,
            commands::listening_ports,
            commands::end_port_owner,
            commands::clipboard_image_file,
            commands::toggle_console_size,
            commands::running_programs,
            commands::save_scrollback,
            commands::load_scrollback,
            commands::prune_scrollback,
            commands::delete_scrollback,
            commands::scrollback_usage,
            commands::claude_usage,
            commands::sudo_status,
            commands::open_elevated_window,
            commands::open_sudo_settings,
            commands::app_info,
            commands::check_update,
            commands::install_update,
            commands::take_open_here,
            commands::set_pinned,
            commands::take_version_change,
            commands::first_start,
            commands::log_ui,
            commands::diagnostics,
            commands::open_logs,
            commands::quit_now,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn on_config_file_changed(app: &AppHandle) {
    let state = app.state::<ConfigState>();
    match state.reload() {
        Reload::Unchanged => return,
        Reload::Invalid => qlog!("{}", state.snapshot().error.unwrap_or_default()),
        Reload::ErrorCleared => {}
        Reload::Changed(old) => {
            let new = state.get();
            app.state::<wsl_sources::State>().retain(&new);
            app.state::<session_library::Store>().retain_sources(wsl_sources::enabled(&new),&wsl_sources::configs(&new));
            if new.hotkey != old.hotkey {
                if let Err(e) = hotkey::apply(app) {
                    qlog!("could not register the hotkey: {e}");
                }
                tray::refresh(app);
            }
            if (new.height, new.width, new.monitor) != (old.height, old.width, old.monitor) {
                window::replace(app);
            }
            if new.background_effect != old.background_effect {
                window::apply_effect(app);
            }
            if new.explorer_menu != old.explorer_menu {
                explorer::apply(app);
            }
        }
    }
    let _ = app.emit_to(window::LABEL, "config-changed", state.snapshot());
}
