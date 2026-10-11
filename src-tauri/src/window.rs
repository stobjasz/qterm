//! The drop-down window: placement on the monitor under the cursor, show and hide.
//!
//! The slide itself is a CSS transform in the UI (`App.css`). Moving the native
//! window every frame stutters under DWM acrylic and can wander onto a monitor
//! stacked above, so the window is placed once and only its content moves.

use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewWindow};

pub const LABEL: &str = "quake";
const HEIGHT_FRACTION: f64 = 0.5;
const SLIDE_MS: u64 = 150;

#[derive(Default)]
pub struct QuakeState {
    hiding: AtomicBool,
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
    if let Some((position, size)) = target_rect(app) {
        // Position first: landing on a monitor with another DPI makes Windows rescale the window.
        let _ = win.set_position(position);
        let _ = win.set_size(size);
    }
    let _ = win.show();
    let _ = win.set_focus();
    let _ = app.emit_to(LABEL, "quake-visibility", Visibility { visible: true, slide_ms: SLIDE_MS });
}

fn hide(app: &AppHandle, win: WebviewWindow) {
    let state = app.state::<QuakeState>();
    state.hiding.store(true, Ordering::Release);
    let _ = app.emit_to(LABEL, "quake-visibility", Visibility { visible: false, slide_ms: SLIDE_MS });

    // Hide once the slide-out has played. Timed here rather than acknowledged by the
    // UI so a hung webview can't leave the window stuck on screen.
    let app = app.clone();
    thread::spawn(move || {
        thread::sleep(Duration::from_millis(SLIDE_MS));
        let _ = win.hide();
        app.state::<QuakeState>().hiding.store(false, Ordering::Release);
    });
}

/// Work area of the monitor under the mouse cursor, cut to the top `HEIGHT_FRACTION`.
fn target_rect(app: &AppHandle) -> Option<(PhysicalPosition<i32>, PhysicalSize<u32>)> {
    let cursor = app.cursor_position().ok()?;
    let monitor = app
        .monitor_from_point(cursor.x, cursor.y)
        .ok()
        .flatten()
        .or_else(|| app.primary_monitor().ok().flatten())?;
    let area = monitor.work_area();
    let height = (f64::from(area.size.height) * HEIGHT_FRACTION).round() as u32;
    Some((area.position, PhysicalSize::new(area.size.width, height)))
}
