//! Tray icon: the only visible handle on the app, since the window skips the taskbar.

use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, Wry};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_opener::OpenerExt;

use crate::config::{hotkey_label, ConfigState};
use crate::{hotkey, window};

const TRAY_ID: &str = "main";

/// Items whose text or check mark follows the config and the hotkey switch.
struct TrayItems {
    toggle: MenuItem<Wry>,
    hotkey: CheckMenuItem<Wry>,
}

pub fn create(app: &AppHandle) -> tauri::Result<()> {
    let toggle = MenuItem::with_id(app, "toggle", "Show / Hide", true, None::<&str>)?;
    let hotkey_item = CheckMenuItem::with_id(app, "hotkey", "Hotkey", true, true, None::<&str>)?;
    let autostart = CheckMenuItem::with_id(
        app,
        "autostart",
        "Start with Windows",
        true,
        app.autolaunch().is_enabled().unwrap_or(false),
        None::<&str>,
    )?;
    let settings = MenuItem::with_id(app, "settings", "Settings…", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit qterm", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &toggle,
            &PredefinedMenuItem::separator(app)?,
            &hotkey_item,
            &autostart,
            &settings,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )?;
    app.manage(TrayItems { toggle, hotkey: hotkey_item });

    let mut tray = TrayIconBuilder::with_id(TRAY_ID)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(move |app, event| match event.id.as_ref() {
            "toggle" => window::flip(app),
            "hotkey" => set_hotkey(app),
            "autostart" => set_autostart(app, &autostart),
            "settings" => open_settings(app),
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
    refresh(app);
    Ok(())
}

/// Updates labels, the hotkey check mark and the tooltip to the current state.
pub fn refresh(app: &AppHandle) {
    let Some(items) = app.try_state::<TrayItems>() else { return };
    let key = hotkey_label(&app.state::<ConfigState>().get().hotkey());
    let enabled = hotkey::is_enabled(app);
    let error = hotkey::error(app);

    let _ = items.toggle.set_text(if enabled { format!("Show / Hide\t{key}") } else { "Show / Hide".into() });
    let _ = items.hotkey.set_text(format!("Hotkey {key}"));
    let _ = items.hotkey.set_checked(enabled);
    let tooltip = match (enabled, error) {
        (_, Some(error)) => format!("qterm: hotkey {key} unavailable, {error}"),
        (true, None) => format!("qterm: press {key}"),
        (false, None) => format!("qterm: hotkey {key} is off"),
    };
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        let _ = tray.set_tooltip(Some(tooltip));
    }
}

/// The menu has already flipped the check mark; follow it, then re-sync.
fn set_hotkey(app: &AppHandle) {
    let Some(items) = app.try_state::<TrayItems>() else { return };
    let wanted = items.hotkey.is_checked().unwrap_or(true);
    if let Err(e) = hotkey::set_enabled(app, wanted) {
        eprintln!("qterm: could not register the hotkey: {e}");
    }
    refresh(app);
}

/// Same pattern: make the registry match the check mark, or put the mark back.
fn set_autostart(app: &AppHandle, item: &CheckMenuItem<Wry>) {
    let wanted = item.is_checked().unwrap_or(false);
    let autolaunch = app.autolaunch();
    let result = if wanted { autolaunch.enable() } else { autolaunch.disable() };
    if let Err(e) = result {
        eprintln!("qterm: could not change autostart: {e}");
        let _ = item.set_checked(autolaunch.is_enabled().unwrap_or(false));
    }
}

fn open_settings(app: &AppHandle) {
    let path = app.state::<ConfigState>().path().to_string_lossy().into_owned();
    if let Err(e) = app.opener().open_path(path, None::<&str>) {
        eprintln!("qterm: could not open settings: {e}");
    }
}
