//! Shell profiles, auto-detected the way Windows Terminal does it.

use std::ffi::OsString;
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::Command;

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use portable_pty::CommandBuilder;
use serde::Serialize;

use crate::config::CustomProfile;

/// Keeps `wsl.exe -l` from flashing a console window in release (GUI-subsystem) builds.
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Which shell a profile runs: decides how it starts in a folder and how shell
/// integration makes it report its working directory.
#[derive(Clone, Copy, Debug, PartialEq)]
enum Kind {
    PowerShell,
    Cmd,
    Bash,
    Wsl,
    /// Anything else (ssh, python, ...): started as is, no shell integration.
    Other,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub id: String,
    pub name: String,
    #[serde(skip)]
    program: OsString,
    #[serde(skip)]
    args: Vec<String>,
    #[serde(skip)]
    kind: Kind,
    /// Start here unless the pane asks for another folder (custom profiles).
    #[serde(skip)]
    cwd: Option<String>,
    #[serde(skip)]
    env: Vec<(String, String)>,
    /// Per-profile look (custom profiles), applied by the UI.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub theme: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub font_size: Option<f64>,
}

/// Shell integration for PowerShell: wraps whatever prompt the user's profile set up
/// (oh-my-posh and the like keep working) and puts OSC 9;9, the working directory as
/// Windows Terminal defines it, in front of it.
const POWERSHELL_INTEGRATION: &str = r#"
$global:__qtermPrompt = $function:prompt
function global:prompt {
    $location = $executionContext.SessionState.Path.CurrentLocation
    $prompt = & $global:__qtermPrompt
    if ($location.Provider.Name -eq 'FileSystem') { "$([char]27)]9;9;`"$($location.ProviderPath)`"$([char]27)\" + $prompt } else { $prompt }
}
"#;

/// Same for Git Bash, reporting the MSYS path ("/c/Users/me"); see `msys_to_windows`.
const BASH_INTEGRATION: &str = r#"printf '\033]9;9;%s\033\\' "$PWD""#;

impl Profile {
    fn new(id: &str, name: &str, program: impl Into<OsString>, args: &[&str], kind: Kind) -> Self {
        Self {
            id: id.into(),
            name: name.into(),
            program: program.into(),
            args: args.iter().map(|a| a.to_string()).collect(),
            kind,
            cwd: None,
            env: Vec::new(),
            theme: None,
            font_size: None,
        }
    }

    /// A [[profiles]] entry. Its kind follows the program, so `pwsh ...` still gets
    /// shell integration while `ssh ...` is left alone.
    pub fn custom(def: &CustomProfile) -> Self {
        let mut words = split_command(&def.command).into_iter();
        let program = words.next().unwrap_or_default();
        let stem = Path::new(&program)
            .file_stem()
            .map(|s| s.to_string_lossy().to_lowercase())
            .unwrap_or_default();
        let kind = match stem.as_str() {
            "pwsh" | "powershell" => Kind::PowerShell,
            "cmd" => Kind::Cmd,
            "bash" => Kind::Bash,
            _ => Kind::Other,
        };
        Self {
            id: def.id(),
            name: def.name.clone(),
            program: program.into(),
            args: words.collect(),
            kind,
            cwd: def.cwd.clone(),
            env: def.env.iter().map(|(k, v)| (k.clone(), v.clone())).collect(),
            theme: def.theme.clone(),
            font_size: def.font_size,
        }
    }

    /// The command for a new session: in `cwd` when it exists (else the home folder),
    /// with shell integration when `integrate` is set.
    pub fn command(&self, cwd: Option<&str>, integrate: bool) -> CommandBuilder {
        let mut cmd = CommandBuilder::new(&self.program);
        let mut args = self.args.clone();
        let cwd = cwd.or(self.cwd.as_deref());
        for (key, value) in &self.env {
            cmd.env(key, value);
        }

        if self.kind == Kind::Wsl {
            // WSL takes its folder as the `--cd` argument and speaks Linux paths.
            if let (Some(cwd), Some(last)) = (cwd.filter(|c| c.starts_with('/')), args.last_mut()) {
                *last = cwd.to_string();
            }
        } else {
            let folder = cwd
                .map(|c| if self.kind == Kind::Bash { msys_to_windows(c) } else { c.to_string() })
                .filter(|c| Path::new(c).is_dir())
                .map(OsString::from)
                .or_else(|| std::env::var_os("USERPROFILE"));
            if let Some(folder) = folder {
                cmd.cwd(folder);
            }
        }

        if integrate {
            match self.kind {
                Kind::PowerShell => {
                    // Base64 of UTF-16LE: no command-line quoting can mangle the script.
                    let utf16: Vec<u8> = POWERSHELL_INTEGRATION.encode_utf16().flat_map(u16::to_le_bytes).collect();
                    args.extend(["-NoExit".into(), "-EncodedCommand".into(), BASE64.encode(utf16)]);
                }
                Kind::Cmd => {
                    // $e = ESC, $P = current folder; the user's own PROMPT follows.
                    let own = std::env::var("PROMPT").unwrap_or_else(|_| "$P$G".into());
                    cmd.env("PROMPT", format!("$e]9;9;$P$e\\{own}"));
                }
                Kind::Bash => cmd.env("PROMPT_COMMAND", BASH_INTEGRATION),
                // Environment variables don't cross into WSL without WSLENV; not wired yet.
                Kind::Wsl | Kind::Other => {}
            }
        }
        cmd.args(&args);
        cmd
    }
}

/// Detected profiles plus the user's [[profiles]]. A custom profile with a detected
/// id ("pwsh") replaces that one in place; the rest are added after.
pub fn merge(detected: &[Profile], custom: &[CustomProfile]) -> Vec<Profile> {
    let mut all: Vec<Profile> = detected.to_vec();
    for def in custom {
        let profile = Profile::custom(def);
        match all.iter_mut().find(|p| p.id == profile.id) {
            Some(existing) => *existing = profile,
            None => all.push(profile),
        }
    }
    all
}

/// "pwsh -NoExit -Command \"npm run dev\"" → [pwsh, -NoExit, -Command, npm run dev].
/// Double quotes group words; there is no other escaping.
pub fn split_command(command: &str) -> Vec<String> {
    let mut words = Vec::new();
    let mut word = String::new();
    let (mut quoted, mut started) = (false, false);
    for ch in command.chars() {
        match ch {
            '"' => {
                quoted = !quoted;
                started = true;
            }
            c if c.is_whitespace() && !quoted => {
                if started {
                    words.push(std::mem::take(&mut word));
                    started = false;
                }
            }
            c => {
                word.push(c);
                started = true;
            }
        }
    }
    if started {
        words.push(word);
    }
    words
}

/// Git Bash reports "/c/Users/me"; Windows wants "C:\Users\me". Other paths pass through.
fn msys_to_windows(path: &str) -> String {
    let mut chars = path.chars();
    match (chars.next(), chars.next(), chars.next()) {
        (Some('/'), Some(drive), next) if drive.is_ascii_alphabetic() && matches!(next, None | Some('/')) => {
            let rest = path[2..].replace('/', "\\");
            format!("{}:{}", drive.to_ascii_uppercase(), if rest.is_empty() { "\\" } else { &rest })
        }
        _ => path.to_string(),
    }
}

/// Detected profiles, default first: PowerShell 7 when installed, else Windows PowerShell.
pub fn detect() -> Vec<Profile> {
    let mut profiles = Vec::new();
    if let Some(pwsh) = find_on_path("pwsh.exe") {
        profiles.push(Profile::new("pwsh", "PowerShell", pwsh, &["-NoLogo"], Kind::PowerShell));
    }
    profiles.push(Profile::new("powershell", "Windows PowerShell", "powershell.exe", &["-NoLogo"], Kind::PowerShell));
    profiles.push(Profile::new("cmd", "Command Prompt", "cmd.exe", &[], Kind::Cmd));
    if let Some(bash) = git_bash() {
        profiles.push(Profile::new("git-bash", "Git Bash", bash, &["--login", "-i"], Kind::Bash));
    }
    for distro in wsl_distros() {
        let id = format!("wsl:{distro}");
        profiles.push(Profile::new(&id, &distro, "wsl.exe", &["-d", &distro, "--cd", "~"], Kind::Wsl));
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

    fn argv(cmd: &CommandBuilder) -> Vec<String> {
        cmd.get_argv().iter().map(|a| a.to_string_lossy().into_owned()).collect()
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

    #[test]
    fn starts_in_the_requested_folder_or_falls_back_to_home() {
        let cmd = Profile::new("cmd", "cmd", "cmd.exe", &[], Kind::Cmd);
        let windows = std::env::var("SystemRoot").unwrap();
        assert_eq!(cmd.command(Some(&windows), false).get_cwd().unwrap(), &OsString::from(&windows));
        let home = std::env::var_os("USERPROFILE").unwrap();
        assert_eq!(cmd.command(Some(r"C:\does\not\exist"), false).get_cwd().unwrap(), &home);
        assert_eq!(cmd.command(None, false).get_cwd().unwrap(), &home);
    }

    #[test]
    fn wsl_gets_its_folder_through_cd() {
        let wsl = Profile::new("wsl:U", "U", "wsl.exe", &["-d", "U", "--cd", "~"], Kind::Wsl);
        assert_eq!(argv(&wsl.command(Some("/home/me/src"), true)), ["wsl.exe", "-d", "U", "--cd", "/home/me/src"]);
        // A Windows path means nothing inside the distro: stay in ~.
        assert_eq!(argv(&wsl.command(Some(r"C:\x"), true)).last().unwrap(), "~");
    }

    #[test]
    fn powershell_integration_wraps_the_prompt() {
        let pwsh = Profile::new("pwsh", "PowerShell", "pwsh.exe", &["-NoLogo"], Kind::PowerShell);
        let args = argv(&pwsh.command(None, true));
        assert_eq!(args[..4], ["pwsh.exe", "-NoLogo", "-NoExit", "-EncodedCommand"]);
        let bytes = BASE64.decode(&args[4]).unwrap();
        let units: Vec<u16> = bytes.as_chunks::<2>().0.iter().map(|&p| u16::from_le_bytes(p)).collect();
        assert_eq!(String::from_utf16(&units).unwrap(), POWERSHELL_INTEGRATION);
        assert_eq!(argv(&pwsh.command(None, false)), ["pwsh.exe", "-NoLogo"]);
    }

    #[test]
    fn cmd_integration_prefixes_the_prompt() {
        let cmd = Profile::new("cmd", "cmd", "cmd.exe", &[], Kind::Cmd).command(None, true);
        let prompt = cmd.get_env("PROMPT").unwrap().to_string_lossy().into_owned();
        assert!(prompt.starts_with("$e]9;9;$P$e\\"), "{prompt}");
    }

    #[test]
    fn splits_command_lines_with_quotes() {
        assert_eq!(split_command(r#"pwsh -NoExit -Command "npm run dev""#), ["pwsh", "-NoExit", "-Command", "npm run dev"]);
        assert_eq!(split_command(r#""C:\Program Files\Git\bin\bash.exe" --login"#), [r"C:\Program Files\Git\bin\bash.exe", "--login"]);
        assert_eq!(split_command("  ssh   me@host  "), ["ssh", "me@host"]);
        assert_eq!(split_command(r#"echo """#), ["echo", ""]);
        assert!(split_command("   ").is_empty());
    }

    #[test]
    fn custom_profiles_start_in_their_folder_with_their_environment() {
        let def = CustomProfile {
            id: None,
            name: "API".into(),
            command: r#"pwsh -NoExit -Command "npm run dev""#.into(),
            cwd: std::env::var("SystemRoot").ok(),
            env: [("NODE_ENV".to_string(), "development".to_string())].into(),
            theme: Some("nord".into()),
            font_size: None,
        };
        let profile = Profile::custom(&def);
        assert_eq!(profile.id, "custom:API");
        assert_eq!(profile.kind, Kind::PowerShell, "pwsh keeps shell integration");
        let cmd = profile.command(None, false);
        assert_eq!(argv(&cmd), ["pwsh", "-NoExit", "-Command", "npm run dev"]);
        assert_eq!(cmd.get_cwd().unwrap(), &OsString::from(std::env::var("SystemRoot").unwrap()));
        assert_eq!(cmd.get_env("NODE_ENV").unwrap(), "development");

        let ssh = CustomProfile { command: "ssh me@host".into(), ..def };
        assert_eq!(Profile::custom(&ssh).kind, Kind::Other);
    }

    #[test]
    fn custom_profiles_restyle_detected_ones_or_are_added() {
        let detected = vec![Profile::new("pwsh", "PowerShell", "pwsh.exe", &[], Kind::PowerShell)];
        let restyle = CustomProfile {
            id: Some("pwsh".into()),
            name: "PowerShell".into(),
            command: "pwsh.exe -NoLogo".into(),
            cwd: None,
            env: Default::default(),
            theme: Some("dracula".into()),
            font_size: Some(13.0),
        };
        let extra = CustomProfile { id: None, name: "Box".into(), command: "ssh box".into(), theme: None, font_size: None, ..restyle.clone() };
        let all = merge(&detected, &[restyle, extra]);
        assert_eq!(all.iter().map(|p| p.id.as_str()).collect::<Vec<_>>(), ["pwsh", "custom:Box"]);
        assert_eq!(all[0].theme.as_deref(), Some("dracula"));
    }

    #[test]
    fn converts_msys_paths() {
        assert_eq!(msys_to_windows("/c/Users/me"), r"C:\Users\me");
        assert_eq!(msys_to_windows("/d"), r"D:\");
        assert_eq!(msys_to_windows("/home/me"), "/home/me");
        assert_eq!(msys_to_windows(r"C:\x"), r"C:\x");
    }
}
