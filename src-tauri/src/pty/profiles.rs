//! Shell discovery. M0 has a single default; named profiles arrive in M2.

use std::ffi::OsString;

/// PowerShell 7 when installed, otherwise the Windows PowerShell that ships with Windows.
pub fn default_shell() -> OsString {
    find_on_path("pwsh.exe").unwrap_or_else(|| "powershell.exe".into())
}

fn find_on_path(exe: &str) -> Option<OsString> {
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path)
        .map(|dir| dir.join(exe))
        .find(|candidate| candidate.is_file())
        .map(Into::into)
}
