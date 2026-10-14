//! "Copy diagnostics": what a bug report needs, as plain text. Nothing is sent
//! anywhere; the user pastes it where they choose.

use tauri::{AppHandle, Manager};
use tauri_plugin_autostart::ManagerExt;

use crate::config::ConfigState;

/// How the console host was chosen at start (see pty::conpty::install).
pub struct ConsoleHost(pub String);

const LOG_LINES: usize = 40;

pub fn report(app: &AppHandle) -> String {
    let mut out = Vec::new();
    let exe = std::env::current_exe().map(|p| p.display().to_string()).unwrap_or_default();
    let kind = if crate::install::this_is_installed() { "installed" } else { "portable" };
    let build = if cfg!(debug_assertions) { ", debug build" } else { "" };
    out.push(format!("qterm {} ({kind}{build}): {exe}", app.package_info().version));
    out.push(format!("Windows: {}", windows_version()));
    out.push(format!("WebView2: {}", tauri::webview_version().unwrap_or_else(|e| format!("unknown ({e})"))));
    if let Some(host) = app.try_state::<ConsoleHost>() {
        out.push(format!("Console host: {}", host.0));
    }

    let config = app.state::<ConfigState>();
    let snapshot = config.snapshot();
    out.push(format!("Settings: {}", config.path().display()));
    if let Some(error) = snapshot.error {
        out.push(format!("Settings problem: {error}"));
    }
    let key = crate::config::hotkey_label(&snapshot.config.hotkey());
    let hotkey = match (crate::hotkey::is_enabled(app), crate::hotkey::error(app)) {
        (_, Some(error)) => format!("{key}, unavailable: {error}"),
        (true, None) => format!("{key}, on"),
        (false, None) => format!("{key}, off"),
    };
    out.push(format!("Hotkey: {hotkey}"));
    let autostart = if app.autolaunch().is_enabled().unwrap_or(false) {
        windows_registry::CURRENT_USER
            .open(r"Software\Microsoft\Windows\CurrentVersion\Run")
            .and_then(|key| key.get_string(&app.package_info().name))
            .map(|command| format!("on: {command}"))
            .unwrap_or_else(|_| "on".into())
    } else {
        "off".into()
    };
    out.push(format!("Start with Windows: {autostart}"));
    let shells: Vec<String> = crate::commands::all_profiles(&app.state(), &config).into_iter().map(|p| p.id).collect();
    out.push(format!("Shells: {}", shells.join(", ")));

    if let Some(log) = crate::log::path() {
        out.push(format!("Log: {}", log.display()));
        let tail = crate::log::tail(LOG_LINES);
        if !tail.is_empty() {
            out.push(format!("--- last {LOG_LINES} log lines ---"));
            out.push(tail);
        }
    }
    out.join("\n")
}

fn windows_version() -> String {
    let Ok(key) = windows_registry::LOCAL_MACHINE.open(r"SOFTWARE\Microsoft\Windows NT\CurrentVersion") else {
        return "unknown".into();
    };
    let name = key.get_string("ProductName").unwrap_or_default();
    let display = key.get_string("DisplayVersion").unwrap_or_default();
    let build = key.get_string("CurrentBuild").unwrap_or_default();
    let ubr = key.get_u32("UBR").map(|u| format!(".{u}")).unwrap_or_default();
    // ProductName still says "Windows 10" on Windows 11; the build number tells them apart.
    let name = if build.parse::<u32>().is_ok_and(|b| b >= 22000) { name.replace("Windows 10", "Windows 11") } else { name };
    format!("{name} {display} (build {build}{ubr})").trim().to_string()
}
