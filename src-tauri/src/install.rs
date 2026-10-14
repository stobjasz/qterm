//! Which qterm owns the Windows integrations every copy shares: the "Start with
//! Windows" entry and the Explorer menu item. An installed qterm always takes them;
//! a portable one only when they don't point at an installed qterm, so a portable
//! exe left lying around doesn't win them back after an install.

use std::path::{Path, PathBuf};

/// An installed qterm has the installer's uninstaller next to it; a portable one doesn't.
pub fn is_installed(exe: &Path) -> bool {
    exe.parent().is_some_and(|dir| dir.join("uninstall.exe").exists())
}

pub fn this_is_installed() -> bool {
    std::env::current_exe().is_ok_and(|exe| is_installed(&exe))
}

/// Whether this copy should point an integration at itself, given the command line it
/// holds now (None: not registered).
pub fn should_take(current: Option<&str>) -> bool {
    take(current, this_is_installed(), |exe| exe.exists() && is_installed(exe))
}

fn take(current: Option<&str>, me_installed: bool, installed: impl Fn(&Path) -> bool) -> bool {
    if me_installed {
        return true;
    }
    match current.and_then(exe_in_command) {
        Some(exe) => !installed(&exe),
        None => true,
    }
}

/// The program in a registry command line: `"C:\a b\qterm.exe" --x` or `C:\a\qterm.exe --x`.
pub fn exe_in_command(command: &str) -> Option<PathBuf> {
    let command = command.trim();
    if let Some(rest) = command.strip_prefix('"') {
        return rest.find('"').map(|end| PathBuf::from(&rest[..end]));
    }
    let end = command.to_ascii_lowercase().find(".exe")? + 4;
    Some(PathBuf::from(&command[..end]))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_the_exe_in_quoted_and_bare_command_lines() {
        assert_eq!(
            exe_in_command(r#""C:\Program Files\q\qterm.exe" --background"#),
            Some(PathBuf::from(r"C:\Program Files\q\qterm.exe"))
        );
        assert_eq!(
            exe_in_command(r"C:\tools\qterm-0.1.0-portable-x64.EXE --background"),
            Some(PathBuf::from(r"C:\tools\qterm-0.1.0-portable-x64.EXE"))
        );
        assert_eq!(exe_in_command("no program here"), None);
    }

    #[test]
    fn the_installed_copy_always_takes_a_portable_one_only_when_free() {
        let installed = |exe: &Path| exe.starts_with(r"C:\Users\me\AppData\Local\qterm");
        let at_installed = Some(r#""C:\Users\me\AppData\Local\qterm\qterm.exe" --background"#);
        let at_portable = Some(r"C:\tools\qterm-portable.exe --background");
        // Installed: always.
        assert!(take(at_portable, true, installed));
        assert!(take(at_installed, true, installed));
        // Portable: not over an installed qterm, otherwise yes.
        assert!(!take(at_installed, false, installed));
        assert!(take(at_portable, false, installed));
        assert!(take(None, false, installed));
    }
}
