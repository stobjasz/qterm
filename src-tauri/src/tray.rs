//! Tray icon: the only visible handle on the app, since the window skips the taskbar.

use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, Wry};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_opener::OpenerExt;

use std::sync::atomic::{AtomicUsize, Ordering};

use crate::config::{hotkey_label, ConfigState};
use crate::{hotkey, window};

const TRAY_ID: &str = "main";

/// Panes where Claude Code is waiting for the user (reported by the UI).
static ATTENTION: AtomicUsize = AtomicUsize::new(0);

pub fn set_attention(app: &AppHandle, count: usize) {
    ATTENTION.store(count, Ordering::Relaxed);
    refresh(app);
}

/// Items whose text or check mark follows the config and other switches.
struct TrayItems {
    toggle: MenuItem<Wry>,
    hotkey: CheckMenuItem<Wry>,
    autostart: CheckMenuItem<Wry>,
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
    app.manage(TrayItems { toggle, hotkey: hotkey_item, autostart: autostart.clone() });

    let mut tray = TrayIconBuilder::with_id(TRAY_ID)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(move |app, event| match event.id.as_ref() {
            "toggle" => window::flip(app),
            "hotkey" => set_hotkey(app),
            "autostart" => {
                let wanted = autostart.is_checked().unwrap_or(false);
                if let Err(e) = set_autostart(app, wanted) {
                    eprintln!("qterm: {e}");
                }
            }
            "settings" => window::open_settings(app),
            "quit" => request_quit(app),
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
    let mut tooltip = match (enabled, error) {
        (_, Some(error)) => format!("qterm: hotkey {key} unavailable, {error}"),
        (true, None) => format!("qterm: press {key}"),
        (false, None) => format!("qterm: hotkey {key} is off"),
    };
    match ATTENTION.load(Ordering::Relaxed) {
        0 => {}
        1 => tooltip.push_str("\nClaude is waiting for you in 1 pane"),
        n => tooltip.push_str(&format!("\nClaude is waiting for you in {n} panes")),
    }
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

/// Turns "Start with Windows" on or off (HKCU Run key) and keeps the tray's check
/// mark in step, whether the change came from the tray or the settings panel.
pub fn set_autostart(app: &AppHandle, enabled: bool) -> Result<(), String> {
    let autolaunch = app.autolaunch();
    let result = if !enabled {
        autolaunch.disable().map_err(|e| format!("could not change autostart: {e}"))
    } else if cfg!(debug_assertions) {
        // A dev build needs the Vite server and opens a console window; at logon it
        // would show an error page instead of the console.
        Err("a development build can't start with Windows; turn this on from the portable exe".into())
    } else {
        autolaunch.enable().map_err(|e| format!("could not change autostart: {e}"))
    };
    if let Some(items) = app.try_state::<TrayItems>() {
        let _ = items.autostart.set_checked(autolaunch.is_enabled().unwrap_or(false));
    }
    result
}

/// If "Start with Windows" is on, points it at this exe. The portable exe may have
/// been moved or replaced, and an older entry may name a dev build; whichever
/// release exe ran last is the one that starts at logon.
pub fn repoint_autostart(app: &AppHandle) {
    let autolaunch = app.autolaunch();
    if !cfg!(debug_assertions)
        && autolaunch.is_enabled().unwrap_or(false)
        && let Err(e) = autolaunch.enable()
    {
        eprintln!("qterm: could not update autostart: {e}");
    }
}

pub fn open_config_file(app: &AppHandle) -> Result<(), String> {
    let path = app.state::<ConfigState>().path().to_string_lossy().into_owned();
    app.opener().open_path(path, None::<&str>).map_err(|e| format!("could not open settings file: {e}"))
}

/// Lets the UI save the panes' output first (it then calls `quit_now`); exits
/// on its own if the UI doesn't answer in time.
fn request_quit(app: &AppHandle) {
    use tauri::Emitter;
    const GRACE: std::time::Duration = std::time::Duration::from_secs(3);
    let _ = app.emit_to(window::LABEL, "quit-requested", ());
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(GRACE);
        app.exit(0);
    });
}
