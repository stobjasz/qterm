mod commands;
mod pty;
mod tray;
mod window;

use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

/// Autostart launches with this: stay hidden until the hotkey is pressed.
const BACKGROUND_ARG: &str = "--background";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Code::Backquote is the physical key left of `1` on any layout.
    let toggle_key = Shortcut::new(Some(Modifiers::CONTROL), Code::Backquote);

    tauri::Builder::default()
        // Must be registered first: a second launch only toggles the running instance.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| window::toggle(app)))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(move |app, shortcut, event| {
                    if event.state == ShortcutState::Pressed && *shortcut == toggle_key {
                        window::toggle(app);
                    }
                })
                .build(),
        )
        .plugin(
            tauri_plugin_autostart::Builder::new()
                .arg(BACKGROUND_ARG)
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .manage(pty::SessionManager::default())
        .manage(window::QuakeState::default())
        .setup(move |app| {
            // Another app may already own the combo; the tray still works without it.
            if let Err(e) = app.global_shortcut().register(toggle_key) {
                eprintln!("qterm: could not register Ctrl+`: {e}");
            }
            tray::create(app.handle())?;
            if !std::env::args().any(|arg| arg == BACKGROUND_ARG) {
                window::toggle(app.handle());
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_profiles,
            commands::pty_spawn,
            commands::pty_write,
            commands::pty_resize,
            commands::pty_kill,
            commands::hide_window,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
