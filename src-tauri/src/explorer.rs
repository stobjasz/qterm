//! "Open in qterm" in Explorer's menu (folders, a folder's background, drives):
//! `qterm.exe --open-here "<folder>"`, which opens a tab in that folder in the
//! running qterm (or starts one). Per user, under HKCU\Software\Classes. On Windows
//! 11 the item is in the classic menu ("Show more options"). Which copy the item
//! starts follows install.rs: an installed qterm takes it over a portable one.

use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager};

use crate::config::ConfigState;

pub const OPEN_HERE_ARG: &str = "--open-here";
const CLASSES: [&str; 3] = [r"Directory\shell", r"Directory\Background\shell", r"Drive\shell"];

/// A folder from `--open-here` on the first start, for the UI to take once its tabs are up.
#[derive(Default)]
pub struct PendingOpenHere(pub Mutex<Option<String>>);

/// The folder after `--open-here`, if given.
pub fn open_here_arg(args: &[String]) -> Option<String> {
    let i = args.iter().position(|a| a == OPEN_HERE_ARG)?;
    args.get(i + 1).map(|dir| dir.trim_end_matches('"').to_string()).filter(|dir| !dir.is_empty())
}

/// A later start with `--open-here`: the console shows with a new tab in that folder.
pub fn open_here(app: &AppHandle, dir: String) {
    crate::window::show_now(app);
    let _ = app.emit_to(crate::window::LABEL, "open-here", dir);
}

/// The registry key name: the real app's is "qterm"; test builds with their own
/// identifier get their own, so they never replace it.
fn key_name(app: &AppHandle) -> String {
    let id = &app.config().identifier;
    if id == "dev.qterm.app" { "qterm".into() } else { id.clone() }
}

fn command_line(exe: &str) -> String {
    format!(r#""{exe}" {OPEN_HERE_ARG} "%V""#)
}

/// Adds or removes the menu item to match the `explorer_menu` setting.
pub fn apply(app: &AppHandle) {
    let wanted = app.state::<ConfigState>().get().explorer_menu;
    let result = if wanted { register(app) } else { unregister(app) };
    if let Err(e) = result {
        crate::qlog!("Explorer menu: {e}");
    }
}

fn register(app: &AppHandle) -> Result<(), String> {
    let name = key_name(app);
    if cfg!(debug_assertions) && name == "qterm" {
        return Err("a development build doesn't register the real Explorer menu item".into());
    }
    let current = windows_registry::CURRENT_USER
        .open(format!(r"Software\Classes\{}\{name}\command", CLASSES[0]))
        .and_then(|key| key.get_string(""))
        .ok();
    if !crate::install::should_take(current.as_deref()) {
        return Ok(());
    }
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let exe = exe.to_string_lossy();
    let label = if name == "qterm" { "Open in qterm".to_string() } else { format!("Open in qterm ({name})") };
    for class in CLASSES {
        let key = windows_registry::CURRENT_USER
            .create(format!(r"Software\Classes\{class}\{name}"))
            .map_err(|e| format!("could not add the menu item: {e}"))?;
        key.set_string("", &label).map_err(|e| e.to_string())?;
        key.set_string("Icon", format!("{exe},0")).map_err(|e| e.to_string())?;
        key.create("command")
            .and_then(|command| command.set_string("", command_line(&exe)))
            .map_err(|e| format!("could not add the menu item: {e}"))?;
    }
    Ok(())
}

fn unregister(app: &AppHandle) -> Result<(), String> {
    let name = key_name(app);
    for class in CLASSES {
        let path = format!(r"Software\Classes\{class}\{name}");
        if windows_registry::CURRENT_USER.open(&path).is_ok() {
            windows_registry::CURRENT_USER
                .remove_tree(&path)
                .map_err(|e| format!("could not remove the menu item: {e}"))?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_folder_after_open_here() {
        let args = |a: &[&str]| a.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        assert_eq!(open_here_arg(&args(&["qterm.exe", "--open-here", r"C:\work"])), Some(r"C:\work".into()));
        // Explorer's %V for a drive root ends in a backslash, which the quoting can turn into a stray quote.
        assert_eq!(open_here_arg(&args(&["qterm.exe", "--open-here", "D:\\\""])), Some("D:\\".into()));
        assert_eq!(open_here_arg(&args(&["qterm.exe", "--open-here"])), None);
        assert_eq!(open_here_arg(&args(&["qterm.exe", "--background"])), None);
    }

    #[test]
    fn the_command_quotes_the_exe_and_the_folder() {
        assert_eq!(command_line(r"C:\Program Files\q\qterm.exe"), r#""C:\Program Files\q\qterm.exe" --open-here "%V""#);
    }
}
