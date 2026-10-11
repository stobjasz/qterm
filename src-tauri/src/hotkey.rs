//! The global console key. One bare key (no modifiers), registered with
//! `RegisterHotKey`, so while it is on that key types nothing in other apps.
//! The tray can switch it off for that; it is back on at the next start.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use tauri::{AppHandle, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};

use crate::config::ConfigState;

pub struct HotkeyState {
    enabled: AtomicBool,
    registered: Mutex<Option<Shortcut>>,
    error: Mutex<Option<String>>,
}

impl Default for HotkeyState {
    fn default() -> Self {
        Self { enabled: AtomicBool::new(true), registered: Mutex::new(None), error: Mutex::new(None) }
    }
}

/// True when `shortcut` is the console key currently registered.
pub fn is_console_key(app: &AppHandle, shortcut: &Shortcut) -> bool {
    *app.state::<HotkeyState>().registered.lock().unwrap() == Some(*shortcut)
}

pub fn is_enabled(app: &AppHandle) -> bool {
    app.state::<HotkeyState>().enabled.load(Ordering::Acquire)
}

/// Why the key could not be registered the last time it was tried.
pub fn error(app: &AppHandle) -> Option<String> {
    app.state::<HotkeyState>().error.lock().unwrap().clone()
}

pub fn set_enabled(app: &AppHandle, enabled: bool) -> Result<(), String> {
    app.state::<HotkeyState>().enabled.store(enabled, Ordering::Release);
    apply(app)
}

/// Brings the registration in line with the config and the on/off switch.
/// Fails when another app already owns the key.
pub fn apply(app: &AppHandle) -> Result<(), String> {
    let result = register(app);
    *app.state::<HotkeyState>().error.lock().unwrap() = result.as_ref().err().cloned();
    result
}

fn register(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<HotkeyState>();
    let wanted = state.enabled.load(Ordering::Acquire).then(|| app.state::<ConfigState>().get().hotkey());
    let mut registered = state.registered.lock().unwrap();
    if *registered == wanted {
        return Ok(());
    }
    if let Some(old) = registered.take() {
        let _ = app.global_shortcut().unregister(old);
    }
    if let Some(key) = wanted {
        app.global_shortcut()
            .register(key)
            .map_err(|e| format!("the key is in use by another app ({e})"))?;
        *registered = Some(key);
    }
    Ok(())
}
