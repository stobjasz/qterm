//! Updates from the project's GitHub Releases. Each release carries `latest.json`
//! with two entries: `windows-x86_64-nsis` (the installer, run silently by the
//! updater plugin) and `windows-x86_64-portable` (the bare exe). Both are signed;
//! the plugin checks the signature against the public key in tauri.conf.json
//! before anything is installed.
//!
//! The portable exe updates itself: the verified new exe is written next to it,
//! the running exe is renamed to `<exe>.old` (Windows allows renaming a running
//! exe), the new one takes its name, and it is started with `--after-update <pid>`
//! so it waits for this process to end. It deletes `<exe>.old` when it starts.

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};

use crate::config::ConfigState;

const FIRST_CHECK_AFTER: Duration = Duration::from_secs(30);
const CHECK_EVERY: Duration = Duration::from_secs(24 * 60 * 60);
/// The manifest entry portable exes read; installed copies use `windows-x86_64-nsis`.
const PORTABLE_TARGET: &str = "windows-x86_64-portable";
/// Debug builds only check where this points (local tests over plain http); release
/// builds always use the endpoint in tauri.conf.json, over https.
const ENDPOINT_ENV: &str = "QTERM_UPDATE_ENDPOINT";
/// Passed to the new exe after a portable update: the old process's id, to wait for.
pub const AFTER_UPDATE_ARG: &str = "--after-update";
/// Left in the local data folder before the installer runs. The installer restarts
/// qterm with the arguments it was started with, `--background` after an autostart;
/// this file makes the updated console show anyway.
const SHOW_AFTER_UPDATE: &str = "show-after-update";

#[derive(Default)]
pub struct UpdateState {
    /// The update found by the last check, ready to install.
    pending: Mutex<Option<Update>>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub version: String,
    pub current_version: String,
    pub notes: Option<String>,
}

pub fn is_portable() -> bool {
    !crate::install::this_is_installed()
}

/// Asks the release feed for a newer version; None when this one is current (or a
/// dev build has no test endpoint).
pub async fn check(app: &AppHandle) -> Result<Option<UpdateInfo>, String> {
    let mut builder = app.updater_builder();
    if cfg!(debug_assertions) {
        let Ok(endpoint) = std::env::var(ENDPOINT_ENV) else { return Ok(None) };
        let url = tauri::Url::parse(&endpoint).map_err(|e| format!("{ENDPOINT_ENV}: {e}"))?;
        builder = builder.endpoints(vec![url]).map_err(|e| e.to_string())?;
    }
    if is_portable() {
        builder = builder.target(PORTABLE_TARGET);
    }
    let update = builder
        .build()
        .map_err(|e| e.to_string())?
        .check()
        .await
        .map_err(|e| format!("could not check for updates: {e}"))?;
    let info = update.as_ref().map(|u| UpdateInfo {
        version: u.version.clone(),
        current_version: u.current_version.clone(),
        notes: u.body.clone(),
    });
    *app.state::<UpdateState>().pending.lock().unwrap() = update;
    crate::tray::set_update(app, info.as_ref().map(|i| i.version.as_str()));
    Ok(info)
}

/// Downloads and verifies the update, then installs it: the installer for an
/// installed copy (it closes qterm and restarts it), or the exe swap for the
/// portable one. The UI saves tabs and output before calling this.
pub async fn install(app: &AppHandle) -> Result<(), String> {
    let pending = app.state::<UpdateState>().pending.lock().unwrap().take();
    let update = match pending {
        Some(update) => update,
        None => {
            check(app).await?;
            app.state::<UpdateState>().pending.lock().unwrap().take().ok_or("qterm is up to date")?
        }
    };
    // Verified against the public key before it is returned.
    let bytes = update.download(|_, _| {}, || {}).await.map_err(|e| format!("could not download the update: {e}"))?;
    if !is_portable() {
        let marker = app.path().app_local_data_dir().map(|dir| dir.join(SHOW_AFTER_UPDATE));
        if let Ok(marker) = &marker {
            let _ = std::fs::write(marker, b"");
        }
        return update.install(bytes).map_err(|e| {
            if let Ok(marker) = &marker {
                let _ = std::fs::remove_file(marker);
            }
            format!("could not install the update: {e}")
        });
    }
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    replace_exe(&exe, &bytes)?;
    std::process::Command::new(&exe)
        .arg(AFTER_UPDATE_ARG)
        .arg(std::process::id().to_string())
        .spawn()
        .map_err(|e| format!("updated, but could not restart qterm: {e}"))?;
    app.exit(0);
    Ok(())
}

/// Puts `bytes` in place of `exe`, keeping the old one as `<exe>.old`. If the swap
/// fails halfway, the old exe is put back.
pub fn replace_exe(exe: &Path, bytes: &[u8]) -> Result<(), String> {
    let new = sibling(exe, "new");
    let old = sibling(exe, "old");
    std::fs::write(&new, bytes).map_err(|e| format!("could not write the new version next to qterm: {e}"))?;
    let _ = std::fs::remove_file(&old);
    if let Err(e) = std::fs::rename(exe, &old) {
        let _ = std::fs::remove_file(&new);
        return Err(format!("could not move the running qterm aside: {e}"));
    }
    if let Err(e) = std::fs::rename(&new, exe) {
        let _ = std::fs::rename(&old, exe);
        let _ = std::fs::remove_file(&new);
        return Err(format!("could not put the new version in place: {e}"));
    }
    Ok(())
}

/// Whether this start follows an update (installed or portable): show the console
/// even when started with `--background`. Clears the installer's marker.
pub fn just_updated(app: &AppHandle) -> bool {
    let marker = app.path().app_local_data_dir().map(|dir| dir.join(SHOW_AFTER_UPDATE));
    let installed = marker.is_ok_and(|marker| std::fs::remove_file(marker).is_ok());
    installed || std::env::args().any(|arg| arg == AFTER_UPDATE_ARG)
}

/// After a portable update: the previous exe is no longer running, so it can go.
pub fn remove_previous_exe() {
    if let Ok(exe) = std::env::current_exe() {
        let _ = std::fs::remove_file(sibling(&exe, "old"));
    }
}

/// `--after-update <pid>`: waits (up to 15 s) for the process that updated this exe
/// to exit, so the single-instance check doesn't hand this start back to it.
pub fn wait_for_previous(args: &[String]) {
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::Threading::{OpenProcess, WaitForSingleObject, PROCESS_SYNCHRONIZE};

    let Some(pid) = args.iter().position(|a| a == AFTER_UPDATE_ARG).and_then(|i| args.get(i + 1)?.parse::<u32>().ok()) else {
        return;
    };
    // SAFETY: plain Win32 calls on a handle we own and close.
    unsafe {
        let process = OpenProcess(PROCESS_SYNCHRONIZE, 0, pid);
        if !process.is_null() {
            WaitForSingleObject(process, 15_000);
            CloseHandle(process);
        }
    }
}

/// Checks shortly after start and then daily, while `check_updates` is on, and
/// tells the UI (and the tray) when a newer version is out.
pub fn start_checking(app: AppHandle) {
    if cfg!(debug_assertions) && std::env::var_os(ENDPOINT_ENV).is_none() {
        return;
    }
    std::thread::spawn(move || {
        std::thread::sleep(FIRST_CHECK_AFTER);
        loop {
            if app.state::<ConfigState>().get().check_updates {
                match tauri::async_runtime::block_on(check(&app)) {
                    Ok(Some(info)) => {
                        let _ = app.emit_to(crate::window::LABEL, "update-available", info);
                    }
                    Ok(None) => {}
                    Err(e) => eprintln!("qterm: {e}"),
                }
            }
            std::thread::sleep(CHECK_EVERY);
        }
    });
}

fn sibling(exe: &Path, suffix: &str) -> PathBuf {
    let mut name = exe.as_os_str().to_owned();
    name.push(format!(".{suffix}"));
    name.into()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("qterm-updater-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn swaps_the_exe_and_keeps_the_old_one_aside() {
        let dir = temp_dir("swap");
        let exe = dir.join("qterm.exe");
        std::fs::write(&exe, b"old version").unwrap();
        replace_exe(&exe, b"new version").unwrap();
        assert_eq!(std::fs::read(&exe).unwrap(), b"new version");
        assert_eq!(std::fs::read(dir.join("qterm.exe.old")).unwrap(), b"old version");
        assert!(!dir.join("qterm.exe.new").exists());

        // A second update replaces the leftover .old.
        replace_exe(&exe, b"newer version").unwrap();
        assert_eq!(std::fs::read(&exe).unwrap(), b"newer version");
        assert_eq!(std::fs::read(dir.join("qterm.exe.old")).unwrap(), b"new version");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_failed_swap_leaves_the_running_exe_in_place() {
        let dir = temp_dir("fail");
        let exe = dir.join("qterm.exe");
        // No exe to move aside: the swap fails before touching anything else.
        assert!(replace_exe(&exe, b"new version").is_err());
        assert!(!dir.join("qterm.exe.new").exists());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
