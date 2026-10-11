mod claude;
mod commands;
mod config;
mod hotkey;
mod pty;
mod tray;
mod window;

use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager, WindowEvent};
use tauri_plugin_global_shortcut::ShortcutState;

use config::{ConfigState, Reload};

/// Autostart launches with this: stay hidden until the hotkey is pressed.
const BACKGROUND_ARG: &str = "--background";

/// Keeps the config file watcher alive for the app's lifetime.
struct ConfigWatcher(#[allow(dead_code)] Mutex<Option<notify::RecommendedWatcher>>);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Must be registered first: a second launch only toggles the running instance.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| window::toggle(app)))
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
        .manage(pty::SessionManager::default())
        .manage(window::QuakeState::default())
        .manage(hotkey::HotkeyState::default())
        .setup(|app| {
            // Before anything can open a PTY: the first one fixes which ConPTY is used.
            match pty::conpty::install(&app.path().app_local_data_dir()?) {
                pty::conpty::Host::Bundled { version, dir } => {
                    eprintln!("qterm: ConPTY {version} from {}", dir.display())
                }
                pty::conpty::Host::Inbox { reason } => eprintln!("qterm: using Windows' built-in ConPTY: {reason}"),
            }

            let config_dir = app.path().app_config_dir()?;
            let config = ConfigState::load(&config_dir);
            if let Some(error) = config.snapshot().error {
                eprintln!("qterm: {error}");
            }
            let config_path = config.path().to_owned();
            app.manage(config);
            app.manage(claude::ClaudeStore::load(&config_dir, claude::claude_home()));

            // Another app may already own the key; the tray says so and still toggles.
            if let Err(e) = hotkey::apply(app.handle()) {
                eprintln!("qterm: could not register the hotkey: {e}");
            }
            tray::create(app.handle())?;

            let handle = app.handle().clone();
            let watcher = config::watch(config_path, move || on_config_file_changed(&handle))
                .inspect_err(|e| eprintln!("qterm: settings will not reload live: {e}"))
                .ok();
            app.manage(ConfigWatcher(Mutex::new(watcher)));

            if !std::env::args().any(|arg| arg == BACKGROUND_ARG) {
                window::show_when_ready(app.handle());
            }
            Ok(())
        })
        .on_window_event(|win, event| {
            if let WindowEvent::Focused(false) = event {
                let app = win.app_handle();
                if app.state::<ConfigState>().get().hide_on_blur {
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
            commands::list_claude_sessions,
            commands::claude_session_seen,
            commands::forget_claude_session,
            commands::save_config,
            commands::open_config_file,
            commands::get_autostart,
            commands::set_autostart,
            commands::resize_console,
            commands::save_console_height,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn on_config_file_changed(app: &AppHandle) {
    let state = app.state::<ConfigState>();
    match state.reload() {
        Reload::Unchanged => return,
        Reload::Invalid => eprintln!("qterm: {}", state.snapshot().error.unwrap_or_default()),
        Reload::ErrorCleared => {}
        Reload::Changed(old) => {
            let new = state.get();
            if new.hotkey != old.hotkey {
                if let Err(e) = hotkey::apply(app) {
                    eprintln!("qterm: could not register the hotkey: {e}");
                }
                tray::refresh(app);
            }
            if (new.height, new.width, new.monitor) != (old.height, old.width, old.monitor) {
                window::replace(app);
            }
        }
    }
    let _ = app.emit_to(window::LABEL, "config-changed", state.snapshot());
}
