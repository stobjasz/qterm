//! The drop-down window: placement on the monitor under the cursor, show and hide.
//!
//! The slide itself is a CSS transform in the UI (`App.css`). Moving the native
//! window every frame stutters under DWM acrylic and can wander onto a monitor
//! stacked above, so the window is placed once and only its content moves.

use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Monitor, PhysicalPosition, PhysicalSize, WebviewWindow};

use crate::config::{BackgroundEffect, Config, ConfigState, MonitorChoice};

pub const LABEL: &str = "quake";
/// Smallest console height as a share of the work area; matches the `height` setting's range.
const MIN_HEIGHT: f64 = 0.1;

#[derive(Default)]
pub struct QuakeState {
    hiding: AtomicBool,
    show_when_ready: AtomicBool,
}

/// Show the console once the UI reports ready (a normal launch, not `--background`).
/// Showing straight from setup races the webview's creation and can be lost.
pub fn show_when_ready(app: &AppHandle) {
    app.state::<QuakeState>().show_when_ready.store(true, Ordering::Release);
}

/// Called by the UI once its listeners are attached. Only the first call counts,
/// so a reloaded page doesn't pop the console up again.
pub fn ui_ready(app: &AppHandle) {
    if app.state::<QuakeState>().show_when_ready.swap(false, Ordering::AcqRel) {
        toggle(app);
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Visibility {
    visible: bool,
    slide_ms: u64,
}

/// Hotkey behaviour: hide when focused, focus when visible but behind, show when hidden.
pub fn toggle(app: &AppHandle) {
    let Some(win) = window(app) else { return };
    match (win.is_visible().unwrap_or(false), win.is_focused().unwrap_or(false)) {
        (true, true) => hide(app, win),
        (true, false) => {
            let _ = win.set_focus();
        }
        (false, _) => show(app, &win),
    }
}

/// Tray behaviour: clicking the tray takes focus away first, so go by visibility alone.
pub fn flip(app: &AppHandle) {
    let Some(win) = window(app) else { return };
    if win.is_visible().unwrap_or(false) {
        hide(app, win);
    } else {
        show(app, &win);
    }
}

/// Brings the console up with the settings panel open (tray "Settings…").
pub fn open_settings(app: &AppHandle) {
    if let Some(win) = window(app)
        && !win.is_visible().unwrap_or(false)
    {
        show(app, &win);
    }
    let _ = app.emit_to(LABEL, "open-settings", ());
}

/// Brings the console up (or to the front), whatever its state.
pub fn show_now(app: &AppHandle) {
    let Some(win) = window(app) else { return };
    if win.is_visible().unwrap_or(false) {
        let _ = win.set_focus();
    } else {
        show(app, &win);
    }
}

/// A notification was clicked: bring the console up and let the UI switch to the pane.
pub fn focus_pane(app: &AppHandle, pane_id: &str) {
    if let Some(win) = window(app) {
        if win.is_visible().unwrap_or(false) {
            let _ = win.set_focus();
        } else {
            show(app, &win);
        }
    }
    let _ = app.emit_to(LABEL, "focus-pane", pane_id);
}

/// Hides the console if it is showing, e.g. after its last tab closed.
pub fn dismiss(app: &AppHandle) {
    let Some(win) = window(app) else { return };
    if win.is_visible().unwrap_or(false) {
        hide(app, win);
    }
}

fn window(app: &AppHandle) -> Option<WebviewWindow> {
    if app.state::<QuakeState>().hiding.load(Ordering::Acquire) {
        return None;
    }
    app.get_webview_window(LABEL)
}

fn show(app: &AppHandle, win: &WebviewWindow) {
    let config = app.state::<ConfigState>().get();
    place(app, win, &config);
    let _ = win.show();
    let _ = win.set_focus();
    let _ = app.emit_to(LABEL, "quake-visibility", Visibility { visible: true, slide_ms: config.slide_ms });
}

/// Puts the configured material (acrylic, mica, blur) behind the window, or none.
pub fn apply_effect(app: &AppHandle) {
    use tauri::window::{Effect, EffectsBuilder};
    let Some(win) = app.get_webview_window(LABEL) else { return };
    let effect = match app.state::<ConfigState>().get().background_effect {
        BackgroundEffect::None => None,
        BackgroundEffect::Acrylic => Some(Effect::Acrylic),
        BackgroundEffect::Mica => Some(Effect::Mica),
    };
    // Effects stack otherwise (DWM keeps the previous backdrop): clear first.
    let _ = win.set_effects(None);
    let result = match effect {
        Some(effect) => win.set_effects(EffectsBuilder::new().effect(effect).build()),
        None => Ok(()),
    };
    if let Err(e) = result {
        crate::qlog!("could not set the background effect: {e}");
    }
}

/// Re-applies size and position, e.g. after the settings changed while the console is up.
/// Stays on the monitor it is on: the mouse may have wandered to another one.
pub fn replace(app: &AppHandle) {
    let Some(win) = window(app) else { return };
    if win.is_visible().unwrap_or(false)
        && let Ok(Some(monitor)) = win.current_monitor()
    {
        place_on(&win, &monitor, &app.state::<ConfigState>().get());
    }
}

/// Mouse resize (dragging the console's bottom edge): sets the height to
/// `logical_height` CSS pixels, kept within the allowed share of the work area.
/// Returns that share, which the UI saves as `height` when the drag ends.
pub fn resize_height(app: &AppHandle, logical_height: f64) -> Result<f64, String> {
    let win = app.get_webview_window(LABEL).ok_or("no console window")?;
    let monitor = win.current_monitor().map_err(|e| e.to_string())?.ok_or("console is on no monitor")?;
    let available = f64::from(monitor.work_area().size.height);
    let height = (logical_height * monitor.scale_factor()).clamp(available * MIN_HEIGHT, available);
    let width = win.outer_size().map_err(|e| e.to_string())?.width;
    win.set_size(PhysicalSize::new(width, height.round() as u32)).map_err(|e| e.to_string())?;
    Ok(height / available)
}

fn place(app: &AppHandle, win: &WebviewWindow, config: &Config) {
    if let Some(monitor) = target_monitor(app, config.monitor) {
        place_on(win, &monitor, config);
    }
}

fn place_on(win: &WebviewWindow, monitor: &Monitor, config: &Config) {
    let (position, size) = target_rect(monitor, config);
    // Position first: landing on a monitor with another DPI makes Windows rescale the window.
    let _ = win.set_position(position);
    let _ = win.set_size(size);
}

fn hide(app: &AppHandle, win: WebviewWindow) {
    let state = app.state::<QuakeState>();
    state.hiding.store(true, Ordering::Release);
    let slide_ms = app.state::<ConfigState>().get().slide_ms;
    let _ = app.emit_to(LABEL, "quake-visibility", Visibility { visible: false, slide_ms });

    // Hide once the slide-out has played. Timed here rather than acknowledged by the
    // UI so a hung webview can't leave the window stuck on screen.
    let app = app.clone();
    thread::spawn(move || {
        thread::sleep(Duration::from_millis(slide_ms));
        let _ = win.hide();
        app.state::<QuakeState>().hiding.store(false, Ordering::Release);
    });
}

/// The top of the monitor's work area, sized by the config and centered.
fn target_rect(monitor: &Monitor, config: &Config) -> (PhysicalPosition<i32>, PhysicalSize<u32>) {
    let area = monitor.work_area();
    let width = (f64::from(area.size.width) * config.width).round() as u32;
    let height = (f64::from(area.size.height) * config.height).round() as u32;
    let x = area.position.x + ((area.size.width - width) / 2) as i32;
    (PhysicalPosition::new(x, area.position.y), PhysicalSize::new(width, height))
}

fn target_monitor(app: &AppHandle, choice: MonitorChoice) -> Option<Monitor> {
    let under_cursor = || {
        let cursor = app.cursor_position().ok()?;
        app.monitor_from_point(cursor.x, cursor.y).ok().flatten()
    };
    let primary = || app.primary_monitor().ok().flatten();
    match choice {
        MonitorChoice::Cursor => under_cursor().or_else(primary),
        MonitorChoice::Primary => primary().or_else(under_cursor),
    }
}
