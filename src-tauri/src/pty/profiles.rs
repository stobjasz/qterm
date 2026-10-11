//! Shell profiles, auto-detected the way Windows Terminal does it.

use std::ffi::OsString;
use std::os::windows::process::CommandExt;
use std::path::PathBuf;
use std::process::Command;

use portable_pty::CommandBuilder;
use serde::Serialize;

/// Keeps `wsl.exe -l` from flashing a console window in release (GUI-subsystem) builds.
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub id: String,
    pub name: String,
    #[serde(skip)]
    program: OsString,
    #[serde(skip)]
    args: Vec<String>,
    /// WSL starts in its own home via `--cd ~`; Windows shells start in %USERPROFILE%.
    #[serde(skip)]
    windows_home: bool,
}

impl Profile {
    fn new(id: &str, name: &str, program: impl Into<OsString>, args: &[&str]) -> Self {
        Self {
            id: id.into(),
            name: name.into(),
            program: program.into(),
            args: args.iter().map(|a| a.to_string()).collect(),
            windows_home: true,
        }
    }

    pub fn command(&self) -> CommandBuilder {
        let mut cmd = CommandBuilder::new(&self.program);
        cmd.args(&self.args);
        if self.windows_home
            && let Some(home) = std::env::var_os("USERPROFILE")
        {
            cmd.cwd(home);
        }
        cmd
    }
}

/// Detected profiles, default first: PowerShell 7 when installed, else Windows PowerShell.
pub fn detect() -> Vec<Profile> {
    let mut profiles = Vec::new();
    if let Some(pwsh) = find_on_path("pwsh.exe") {
        profiles.push(Profile::new("pwsh", "PowerShell", pwsh, &["-NoLogo"]));
    }
    profiles.push(Profile::new("powershell", "Windows PowerShell", "powershell.exe", &["-NoLogo"]));
    profiles.push(Profile::new("cmd", "Command Prompt", "cmd.exe", &[]));
    if let Some(bash) = git_bash() {
        profiles.push(Profile::new("git-bash", "Git Bash", bash, &["--login", "-i"]));
    }
    for distro in wsl_distros() {
        let mut profile = Profile::new(
            &format!("wsl:{distro}"),
            &distro,
            "wsl.exe",
            &["-d", &distro, "--cd", "~"],
        );
        profile.windows_home = false;
        profiles.push(profile);
    }
    profiles
}

fn find_on_path(exe: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path)
        .map(|dir| dir.join(exe))
        .find(|candidate| candidate.is_file())
}

fn git_bash() -> Option<PathBuf> {
    ["ProgramFiles", "ProgramW6432", "LOCALAPPDATA"]
        .iter()
        .filter_map(std::env::var_os)
        .flat_map(|root| {
            let root = PathBuf::from(root);
            [root.join(r"Git\bin\bash.exe"), root.join(r"Programs\Git\bin\bash.exe")]
        })
        .find(|candidate| candidate.is_file())
}

fn wsl_distros() -> Vec<String> {
    let Ok(output) = Command::new("wsl.exe")
        .args(["--list", "--quiet"])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
    else {
        return Vec::new();
    };
    if !output.status.success() {
        return Vec::new();
    }
    parse_wsl_list(&output.stdout)
}

/// `wsl --list` writes UTF-16LE. Docker Desktop's internal distros aren't shells.
fn parse_wsl_list(stdout: &[u8]) -> Vec<String> {
    let units: Vec<u16> = stdout
        .as_chunks::<2>()
        .0
        .iter()
        .map(|&pair| u16::from_le_bytes(pair))
        .collect();
    String::from_utf16_lossy(&units)
        .lines()
        .map(|line| line.trim_matches(|c: char| c.is_whitespace() || c == '\u{feff}' || c == '\0'))
        .filter(|name| !name.is_empty() && !name.starts_with("docker-desktop"))
        .map(String::from)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn utf16le(text: &str) -> Vec<u8> {
        text.encode_utf16().flat_map(u16::to_le_bytes).collect()
    }

    #[test]
    fn parses_wsl_list_output() {
        let stdout = utf16le("Ubuntu-24.04\r\ndocker-desktop\r\nDebian\r\n\r\n");
        assert_eq!(parse_wsl_list(&stdout), ["Ubuntu-24.04", "Debian"]);
    }

    #[test]
    fn empty_wsl_list_has_no_distros() {
        assert!(parse_wsl_list(&[]).is_empty());
    }

    #[test]
    fn always_offers_the_inbox_shells() {
        let ids: Vec<_> = detect().into_iter().map(|p| p.id).collect();
        assert!(ids.contains(&"powershell".to_string()));
        assert!(ids.contains(&"cmd".to_string()));
    }
}
