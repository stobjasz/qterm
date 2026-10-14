mod alerts;
mod claude;
mod claude_hook;
mod claude_statusline;
mod claude_usage;
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
mod procs;
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
pub use claude_statusline::STATUSLINE_ARG;

/// `--claude-statusline`: Claude Code's status line command (see claude_statusline.rs).
pub fn run_claude_statusline(args: &[String]) {
    claude_statusline::run(args)
}

/// Autostart launches with this: stay hidden until the hotkey is pressed.
const BACKGROUND_ARG: &str = "--background";

/// Keeps the config and alert-inbox watchers alive for the app's lifetime.
struct Watchers(#[allow(dead_code)] Mutex<Vec<notify::RecommendedWatcher>>);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    log::log_panics();
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
            let config_path = config.path().to_owned();
            app.manage(config);
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

            let handle = app.handle().clone();
            let config_watcher = config::watch(config_path, move || on_config_file_changed(&handle))
                .inspect_err(|e| qlog!("settings will not reload live: {e}"))
                .ok();
            let alert_watcher = alerts::watch_inbox(app.handle().clone())
                .inspect_err(|e| qlog!("Claude alerts unavailable: {e}"))
                .ok();
            app.manage(Watchers(Mutex::new(config_watcher.into_iter().chain(alert_watcher).collect())));

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
            commands::list_claude_sessions,
            commands::claude_session_seen,
            commands::forget_claude_sessions,
            commands::save_config,
            commands::open_config_file,
            commands::export_settings,
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
