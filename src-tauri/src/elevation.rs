//! Administrator tabs. qterm doesn't bridge elevation itself: an unelevated app
//! driving an elevated shell is exactly the risk Windows' own sudo documents for
//! its inline mode, so admin tabs use that sudo, and only when the user has set
//! it to inline. Otherwise the shell opens as administrator in its own window
//! (UAC prompt, ShellExecute "runas"), outside qterm.

use std::ffi::{OsStr, OsString};
use std::os::windows::ffi::OsStrExt;
use std::path::PathBuf;

use portable_pty::CommandBuilder;
use serde::Serialize;

/// How Windows' sudo is set up (Settings → System → Advanced → Enable sudo).
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SudoMode {
    /// No sudo.exe (Windows 11 before 24H2).
    Missing,
    Disabled,
    /// "In a new window": the default.
    NewWindow,
    /// "Input closed": runs here, but you can't type into it.
    InputClosed,
    /// "Inline": runs in this pane and takes input. What admin tabs need.
    Inline,
}

/// The registry's `Enabled` value (0-3) as a mode, capped by group policy.
fn mode_from(enabled: Option<u32>, policy: Option<u32>, installed: bool) -> SudoMode {
    let mode = |value: u32| match value {
        0 => SudoMode::Disabled,
        1 => SudoMode::NewWindow,
        2 => SudoMode::InputClosed,
        _ => SudoMode::Inline,
    };
    if !installed {
        return SudoMode::Missing;
    }
    let configured = enabled.map_or(SudoMode::Disabled, mode);
    policy.map_or(configured, |p| configured.min(mode(p)))
}

pub fn sudo_mode() -> SudoMode {
    let read = |path: &str| windows_registry::LOCAL_MACHINE.open(path).and_then(|key| key.get_u32("Enabled")).ok();
    mode_from(
        read(r"SOFTWARE\Microsoft\Windows\CurrentVersion\Sudo"),
        read(r"SOFTWARE\Policies\Microsoft\Windows\Sudo"),
        sudo_exe().is_file(),
    )
}

/// By full path, so nothing on PATH can stand in for it.
fn sudo_exe() -> PathBuf {
    let root = std::env::var_os("SystemRoot").unwrap_or_else(|| "C:\\Windows".into());
    PathBuf::from(root).join("System32").join("sudo.exe")
}

/// Runs `cmd` through sudo in inline mode: elevated after the UAC prompt, in this
/// pane's console. `-E` keeps the environment (QTERM_PANE, shell integration),
/// `-D` the folder.
pub fn elevate(cmd: &mut CommandBuilder) {
    let cwd = cmd.get_cwd().cloned();
    let argv = cmd.get_argv_mut();
    let mut wrapped: Vec<OsString> = vec![sudo_exe().into(), "--inline".into(), "-E".into()];
    if let Some(cwd) = cwd {
        wrapped.extend(["-D".into(), cwd]);
    }
    wrapped.append(argv);
    *argv = wrapped;
}

/// Opens the command as administrator in a window of its own (UAC prompt first).
pub fn open_elevated_window(cmd: &CommandBuilder) -> Result<(), String> {
    use windows_sys::Win32::UI::Shell::ShellExecuteW;
    use windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

    let (program, args) = cmd.get_argv().split_first().ok_or("no command")?;
    let wide = |s: &OsStr| s.encode_wide().chain(Some(0)).collect::<Vec<u16>>();
    let verb = wide(OsStr::new("runas"));
    let file = wide(program);
    let params = wide(OsStr::new(&join_args(args)));
    let dir = cmd.get_cwd().map(|d| wide(d));
    // SAFETY: every pointer is to a NUL-terminated UTF-16 buffer that outlives the call.
    let result = unsafe {
        ShellExecuteW(
            std::ptr::null_mut(),
            verb.as_ptr(),
            file.as_ptr(),
            params.as_ptr(),
            dir.as_ref().map_or(std::ptr::null(), |d| d.as_ptr()),
            SW_SHOWNORMAL,
        )
    } as isize;
    // Values above 32 mean success; declining the UAC prompt gives "access denied".
    match result {
        r if r > 32 => Ok(()),
        5 => Err("the administrator prompt was declined".into()),
        r => Err(format!("could not start it as administrator (error {r})")),
    }
}

/// Arguments as one command line, quoted the way the C runtime splits them.
fn join_args(args: &[OsString]) -> String {
    args.iter().map(|a| quote(&a.to_string_lossy())).collect::<Vec<_>>().join(" ")
}

fn quote(arg: &str) -> String {
    if !arg.is_empty() && !arg.contains([' ', '\t', '"']) {
        return arg.to_string();
    }
    let mut out = String::from("\"");
    let mut backslashes = 0;
    for ch in arg.chars() {
        match ch {
            '\\' => backslashes += 1,
            '"' => {
                // Backslashes before a quote are doubled, plus one to escape the quote.
                out.push_str(&"\\".repeat(backslashes * 2 + 1));
                out.push('"');
                backslashes = 0;
            }
            c => {
                out.push_str(&"\\".repeat(backslashes));
                out.push(c);
                backslashes = 0;
            }
        }
    }
    // Backslashes before the closing quote are doubled too.
    out.push_str(&"\\".repeat(backslashes * 2));
    out.push('"');
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_sudo_mode_capped_by_policy() {
        assert_eq!(mode_from(Some(3), None, true), SudoMode::Inline);
        assert_eq!(mode_from(Some(1), None, true), SudoMode::NewWindow);
        assert_eq!(mode_from(None, None, true), SudoMode::Disabled);
        assert_eq!(mode_from(Some(3), Some(2), true), SudoMode::InputClosed, "policy caps it");
        assert_eq!(mode_from(Some(1), Some(3), true), SudoMode::NewWindow, "policy never raises it");
        assert_eq!(mode_from(Some(3), None, false), SudoMode::Missing);
    }

    #[test]
    fn wraps_the_shell_in_inline_sudo() {
        let mut cmd = CommandBuilder::new("pwsh.exe");
        cmd.args(["-NoLogo", "-NoExit"]);
        cmd.cwd(r"C:\work dir");
        elevate(&mut cmd);
        let argv: Vec<String> = cmd.get_argv().iter().map(|a| a.to_string_lossy().into_owned()).collect();
        assert!(argv[0].to_lowercase().ends_with(r"system32\sudo.exe"), "{argv:?}");
        assert_eq!(argv[1..], ["--inline", "-E", "-D", r"C:\work dir", "pwsh.exe", "-NoLogo", "-NoExit"]);
    }

    #[test]
    fn quotes_arguments_for_the_command_line() {
        assert_eq!(quote("plain"), "plain");
        assert_eq!(quote("two words"), "\"two words\"");
        assert_eq!(quote(r"C:\dir with space\"), r#""C:\dir with space\\""#);
        assert_eq!(quote(r#"say "hi""#), r#""say \"hi\"""#);
        assert_eq!(quote(""), "\"\"");
    }
}
