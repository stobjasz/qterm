//! Tray icon: the only visible handle on the app, since the window skips the taskbar.

use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::AppHandle;
use tauri_plugin_autostart::ManagerExt;

use crate::window;

pub fn create(app: &AppHandle) -> tauri::Result<()> {
    let toggle = MenuItem::with_id(app, "toggle", "Show / Hide\tCtrl+`", true, None::<&str>)?;
    let autostart = CheckMenuItem::with_id(
        app,
        "autostart",
        "Start with Windows",
        true,
        app.autolaunch().is_enabled().unwrap_or(false),
        None::<&str>,
    )?;
    let quit = MenuItem::with_id(app, "quit", "Quit qterm", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&toggle, &autostart, &separator, &quit])?;

    let mut tray = TrayIconBuilder::with_id("main")
        .tooltip("qterm")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(move |app, event| match event.id.as_ref() {
            "toggle" => window::flip(app),
            "autostart" => set_autostart(app, &autostart),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                window::flip(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

/// The menu has already flipped the check mark; make the registry match it,
/// and put the mark back if that fails.
fn set_autostart(app: &AppHandle, item: &CheckMenuItem<tauri::Wry>) {
    let wanted = item.is_checked().unwrap_or(false);
    let autolaunch = app.autolaunch();
    let result = if wanted { autolaunch.enable() } else { autolaunch.disable() };
    if let Err(e) = result {
        eprintln!("qterm: could not change autostart: {e}");
        let _ = item.set_checked(autolaunch.is_enabled().unwrap_or(false));
    }
}
