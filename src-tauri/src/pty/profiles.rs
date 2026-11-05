//! Shell profiles, auto-detected the way Windows Terminal does it.

use std::ffi::OsString;
use std::path::{Path, PathBuf};

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use portable_pty::CommandBuilder;
use serde::Serialize;

use crate::config::CustomProfile;

/// Which shell a profile runs: decides how it starts in a folder and how shell
/// integration makes it report its working directory. The UI uses it to quote
/// dropped file paths.
#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
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
    /// Explicit distribution identity; never infer one from a POSIX folder.
    pub distribution: Option<String>,
    #[serde(skip)]
    program: OsString,
    #[serde(skip)]
    args: Vec<String>,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tab_color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub background: Option<String>,
}

/// Shell integration for PowerShell: wraps whatever prompt the user's profile set up
/// (oh-my-posh and the like keep working). Around it go, as Windows Terminal defines
/// them: OSC 133 command marks (D = the last command ended, with its exit code;
/// A = prompt starts; B = typing starts) and OSC 9;9, the working directory.
/// `$?` is read first, before anything else can reset it.
const POWERSHELL_INTEGRATION: &str = r#"
$global:__qtermPrompt = $function:prompt
$global:__qtermLastId = -1
function global:prompt {
    $ok = $?
    $code = if ($ok) { 0 } elseif ($global:LASTEXITCODE) { $global:LASTEXITCODE } else { 1 }
    $e = [char]27
    $last = Get-History -Count 1
    $id = if ($last) { $last.Id } else { 0 }
    $out = ''
    if ($global:__qtermLastId -ne -1) {
        if ($id -ne $global:__qtermLastId) { $out += "$e]133;D;$code$e\" } else { $out += "$e]133;D$e\" }
    }
    $global:__qtermLastId = $id
    $out += "$e]133;A$e\"
    $location = $executionContext.SessionState.Path.CurrentLocation
    if ($location.Provider.Name -eq 'FileSystem') { $out += "$e]9;9;`"$($location.ProviderPath)`"$e\" }
    $out + (& $global:__qtermPrompt) + "$e]133;B$e\"
}
"#;

/// Same for Git Bash: report native Windows paths, including MSYS mount aliases.
/// The profile sets PS1 after this is in place, so B is appended to PS1 once.
// Git's /tmp and other mount aliases are not /c paths. Report the actual Windows
// folder so native path checks, links and agent launch guards agree on identity.
const BASH_INTEGRATION: &str = r#"__qterm_rc=$?; __qterm_pwd=$(/usr/bin/cygpath -aw -- "$PWD" 2>/dev/null) || __qterm_pwd=$PWD; printf '\033]133;D;%s\007\033]133;A\007\033]9;9;%s\033\\' "$__qterm_rc" "$__qterm_pwd"; [[ $PS1 == *'133;B'* ]] || PS1="$PS1"'\[\e]133;B\a\]'"#;
const WSL_INTEGRATION: &str = r#"__qterm_rc=$?; printf '\033]133;D;%s\007\033]133;A\007\033]9;9;%s\033\\' "$__qterm_rc" "$PWD"; [[ $PS1 == *'133;B'* ]] || PS1="$PS1"'\[\e]133;B\a\]'"#;

fn distribution(args:&[String])->Option<String>{
    let end=args.iter().position(|a|matches!(a.as_str(),"--exec"|"-e")).unwrap_or(args.len());let args=&args[..end];
    if args.iter().any(|a|matches!(a.as_str(),"--user"|"-u")){return None;}
    args.windows(2).find(|pair|matches!(pair[0].as_str(),"-d"|"--distribution")).map(|pair|pair[1].clone()).filter(|d|crate::wsl::valid_distribution(d))
}
fn shared_wsl_environment(current:&str,integrate:bool)->String{
    let mut vars:Vec<String>=current.split(':').filter(|s|!s.is_empty()&&!matches!(s.split('/').next(),Some("QTERM_PANE"|"QTERM_INBOX"))&&(!integrate||s.split('/').next()!=Some("PROMPT_COMMAND"))).map(str::to_owned).collect();
    vars.extend(["QTERM_PANE".into(),"QTERM_INBOX".into()]);if integrate{vars.push("PROMPT_COMMAND/u".into());}vars.join(":")
}

impl Profile {
    /// Wrap only recognized distribution profiles; preserve the shell's exact
    /// --exec argv and the existing WSL options and terminal handles.
    pub(crate) fn owned_command(&self,cwd:Option<&str>,integrate:bool,owner:&crate::wsl_owner::Owner)->Result<CommandBuilder,String>{
        let mut cmd=self.command(cwd,integrate);
        let argv=cmd.get_argv_mut();
        let at=if let Some(at)=argv.iter().position(|arg|arg=="--exec"||arg=="-e"){at}else{
            let mut at=1;
            while at<argv.len(){let flag=argv[at].to_string_lossy();if matches!(flag.as_ref(),"-d"|"--distribution"|"--cd")&&at+1<argv.len(){at+=2;}else{return Err("Owned WSL profiles require --exec before a custom Linux command; unsupported WSL launch options were not run".into());}}
            argv.push("--exec".into());at
        };
        argv.splice(at+1..at+1,[OsString::from("/usr/bin/python3"),OsString::from("-I"),OsString::from("-S"),OsString::from("-c"),OsString::from(crate::wsl_owner::SCRIPT)]);
        let current=cmd.get_env("WSLENV").map(|v|v.to_string_lossy().into_owned()).unwrap_or_default();
        let mut vars:Vec<&str>=current.split(':').filter(|item|!item.is_empty()&&!matches!(item.split('/').next(),Some("QTERM_LIFETIME"|"QTERM_OWNER_TOKEN"))).collect();vars.extend(["QTERM_LIFETIME/p","QTERM_OWNER_TOKEN"]);
        cmd.env("WSLENV",vars.join(":"));cmd.env("QTERM_LIFETIME",crate::repo_state::display(&owner.path));cmd.env("QTERM_OWNER_TOKEN",&owner.token);
        Ok(cmd)
    }
    pub fn check_kind(&self,expected:Option<&str>)->Result<(),String>{
        let actual=match self.kind{Kind::PowerShell=>"powershell",Kind::Cmd=>"cmd",Kind::Bash=>"bash",Kind::Wsl=>"wsl",Kind::Other=>"other"};
        if expected.is_some_and(|expected|expected!=actual){return Err("The shell profile kind changed while preparing this pane; choose the profile again before sending startup input".into());}Ok(())
    }
    pub(crate) fn native_agent_context(&self)->bool {
        self.distribution.is_none() && matches!(self.kind,Kind::PowerShell|Kind::Cmd|Kind::Bash)
    }
    pub fn check_environment(&self,expected:Option<&str>)->Result<(),String>{
        let actual=self.distribution.as_ref().map(|d|format!("wsl:{}",d.to_lowercase())).unwrap_or_else(||"native".into());
        if expected.is_some_and(|expected|expected!=actual){return Err(format!("This pane belongs to {}, but its profile now uses {actual}. Switch the pane to an appropriate profile explicitly; its saved folder was not opened.",expected.unwrap()));}Ok(())
    }
    /// A Cmd batch file otherwise executes in the interactive shell itself and
    /// Ctrl-C can leave it asking for batch confirmation. Isolate granted tasks
    /// in a child of the selected interpreter so targeted stop preserves the tab.
    pub fn task_command(&self, command:&str)->String {
        if self.kind!=Kind::Cmd { return command.into(); }
        let program=if Path::new(&self.program).is_absolute() { PathBuf::from(&self.program) } else {
            std::env::var_os("SystemRoot").map(PathBuf::from).unwrap_or_else(||PathBuf::from(r"C:\Windows")).join("System32").join("cmd.exe")
        };
        format!("\"{}\" /d /s /c \"{}\"",program.display(),command)
    }
    /// Git's bin/bash.exe is a Windows launcher for usr/bin/bash.exe. Keep both
    /// owned by the pane, but treat the latter as its interactive shell.
    pub fn shell_proxy(&self) -> Option<PathBuf> {
        if self.kind != Kind::Bash { return None; }
        let program=Path::new(&self.program);
        if program.file_name()?.to_string_lossy().to_ascii_lowercase()!="bash.exe" || program.parent()?.file_name()?.to_string_lossy().to_ascii_lowercase()!="bin" { return None; }
        let actual=program.parent()?.parent()?.join("usr/bin/bash.exe");
        std::fs::canonicalize(actual).ok()
    }
    fn new(id: &str, name: &str, program: impl Into<OsString>, args: &[&str], kind: Kind) -> Self {
        Self {
            id: id.into(),
            name: name.into(),
            distribution: (kind==Kind::Wsl).then(||id.strip_prefix("wsl:").unwrap_or(id).to_owned()),
            program: program.into(),
            args: args.iter().map(|a| a.to_string()).collect(),
            kind,
            cwd: None,
            env: Vec::new(),
            theme: None,
            font_size: None,
            tab_color: None,
            icon: None,
            background: None,
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
        let args:Vec<String>=words.collect();
        let distribution=(stem=="wsl").then(||distribution(&args)).flatten();
        let kind = match stem.as_str() {
            "pwsh" | "powershell" => Kind::PowerShell,
            "cmd" => Kind::Cmd,
            "bash" => Kind::Bash,
            "wsl" if distribution.is_some()=>Kind::Wsl,
            _ => Kind::Other,
        };
        Self {
            id: def.id(),
            name: def.name.clone(),
            distribution,
            program: program.into(),
            args,
            kind,
            cwd: def.cwd.clone(),
            env: def.env.iter().map(|(k, v)| (k.clone(), v.clone())).collect(),
            theme: def.theme.clone(),
            font_size: def.font_size,
            tab_color: def.tab_color.clone(),
            icon: def.icon.clone(),
            background: def.background.clone(),
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
            if let Some(cwd)=cwd.filter(|c|c.starts_with('/')) {
                if let Some(index)=args.iter().position(|a|a=="--cd") {if let Some(value)=args.get_mut(index+1){*value=cwd.into();}}
                else{args.splice(0..0,["--cd".into(),cwd.into()]);}
            }
            let existing=cmd.get_env("WSLENV").map(|s|s.to_string_lossy().into_owned()).or_else(||std::env::var("WSLENV").ok()).unwrap_or_default();
            cmd.env("WSLENV",shared_wsl_environment(&existing,integrate));
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
                Kind::PowerShell => powershell_integration(&mut args),
                Kind::Cmd => {
                    // $e = ESC, $P = current folder; the user's own PROMPT goes between
                    // the marks. cmd's prompt can't see the exit code, so D has none.
                    let own = std::env::var("PROMPT").unwrap_or_else(|_| "$P$G".into());
                    cmd.env("PROMPT", format!("$e]133;D$e\\$e]133;A$e\\$e]9;9;$P$e\\{own}$e]133;B$e\\"));
                }
                Kind::Bash => cmd.env("PROMPT_COMMAND", BASH_INTEGRATION),
                Kind::Wsl=>cmd.env("PROMPT_COMMAND",WSL_INTEGRATION),
                Kind::Other => {}
            }
        }
        cmd.args(&args);
        cmd
    }
}

/// Adds the prompt integration to PowerShell's arguments. Base64 of UTF-16LE, so no
/// command-line quoting can mangle the script. `-Command` takes the rest of the line
/// as its script, so with one of the profile's own (e.g. a Visual Studio developer
/// shell) the integration runs first inside that script instead of being appended
/// after it, which would end up as the script's arguments. A `-File` profile can't
/// take it.
fn powershell_integration(args: &mut Vec<String>) {
    let utf16: Vec<u8> = POWERSHELL_INTEGRATION.encode_utf16().flat_map(u16::to_le_bytes).collect();
    let encoded = BASE64.encode(utf16);
    let is = |arg: &str, name: &str, shortest: usize| {
        let arg = arg.to_ascii_lowercase();
        arg.len() >= shortest && name.starts_with(&arg)
    };
    if args.iter().any(|a| is(a, "-file", 2)) {
        return;
    }
    let Some(at) = args.iter().position(|a| is(a, "-command", 2)) else {
        args.extend(["-NoExit".into(), "-EncodedCommand".into(), encoded]);
        return;
    };
    let script = args.split_off(at + 1).join(" ");
    let integration = format!(". ([scriptblock]::Create([Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('{encoded}'))))");
    args.push(if script.trim().is_empty() { integration } else { format!("{integration}; {script}") });
    if !args[..at].iter().any(|a| a.eq_ignore_ascii_case("-NoExit")) {
        args.insert(at, "-NoExit".into());
    }
}

/// Detected profiles plus the user's [[profiles]]. A custom profile with a detected
/// id ("pwsh") replaces that one in place; the rest are added after.
impl Profile {
    /// Exact launch configuration, including environment, without exposing secrets.
    pub fn automation_key(&self) -> Option<String> {
        if matches!(self.kind, Kind::Wsl | Kind::Other) { return None; }
        Some(self.launch_key())
    }
    /// Exact launch identity, including WSL; this does not grant task execution.
    pub fn launch_key(&self) -> String {
        use std::os::windows::ffi::OsStrExt;
        use sha2::{Digest, Sha256};
        let program: Vec<u16> = self.program.encode_wide().collect();
        let bytes = serde_json::to_vec(&(&self.id, program, &self.args, &self.cwd, &self.env, self.kind)).expect("profile identity serializes");
        format!("{:x}", Sha256::digest(bytes))
    }
    /// Program file name and arguments, lower-cased (see wt_import::command_key).
    pub fn command_key(&self) -> String {
        let file = std::path::Path::new(&self.program).file_name().map(|f| f.to_string_lossy().to_lowercase()).unwrap_or_default();
        let file = file.strip_suffix(".exe").unwrap_or(&file).to_string();
        std::iter::once(file).chain(self.args.iter().map(|a| a.to_lowercase())).collect::<Vec<_>>().join(" ")
    }
}

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
        profiles.push(Profile::new(&id, &distro, crate::wsl::program(), &["-d", &distro, "--cd", "~"], Kind::Wsl));
    }
    profiles
}

/// SSH hosts from ~/.ssh/config as profiles ("ssh:<host>"), when ssh.exe is there.
/// Read on every listing, so a newly added host shows up without a restart.
pub fn ssh_profiles() -> Vec<Profile> {
    let Some(ssh) = ssh_exe() else { return Vec::new() };
    let Some(home) = std::env::var_os("USERPROFILE") else { return Vec::new() };
    let Ok(text) = std::fs::read_to_string(PathBuf::from(home).join(".ssh").join("config")) else { return Vec::new() };
    ssh_hosts(&text)
        .into_iter()
        .map(|host| Profile::new(&format!("ssh:{host}"), &format!("SSH {host}"), ssh.clone(), &[&host], Kind::Other))
        .collect()
}

/// Windows' OpenSSH client, else one on PATH (e.g. Git's).
fn ssh_exe() -> Option<PathBuf> {
    let system = std::env::var_os("SystemRoot").map(|root| PathBuf::from(root).join(r"System32\OpenSSH\ssh.exe"));
    system.filter(|p| p.is_file()).or_else(|| find_on_path("ssh.exe"))
}

/// The concrete names of `Host` lines (`Host a b`, `Host=a`), in order, once each.
/// Patterns (`*`, `?`, `!`) aren't hosts you can connect to; `Include`d files and
/// `Match` blocks aren't followed.
fn ssh_hosts(config: &str) -> Vec<String> {
    let mut hosts: Vec<String> = Vec::new();
    for line in config.lines() {
        let line = line.trim();
        if line.starts_with('#') {
            continue;
        }
        let (keyword, rest) = match line.split_once(|c: char| c.is_whitespace() || c == '=') {
            Some((k, r)) => (k, r.trim_start_matches(|c: char| c.is_whitespace() || c == '=')),
            None => continue,
        };
        if !keyword.eq_ignore_ascii_case("host") {
            continue;
        }
        for name in rest.split_whitespace().map(|n| n.trim_matches('"')) {
            let plain = !name.is_empty() && !name.contains(['*', '?', '!']) && !name.starts_with('-');
            if plain && !hosts.iter().any(|h| h == name) {
                hosts.push(name.to_string());
            }
        }
    }
    hosts
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
    crate::wsl::distributions().unwrap_or_default()
}

/// `wsl --list` writes UTF-16LE. Docker Desktop's internal distros aren't shells.
pub(crate) fn parse_wsl_list(stdout: &[u8]) -> Vec<String> {
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
    fn captured_environment_rejects_profile_retargeting_before_launch(){
        let ubuntu=Profile::new("wsl:Ubuntu","Ubuntu","wsl.exe",&["-d","Ubuntu"],Kind::Wsl);
        let debian=Profile::new("wsl:Debian","Debian","wsl.exe",&["-d","Debian"],Kind::Wsl);
        let native=Profile::new("cmd","cmd","cmd.exe",&[],Kind::Cmd);
        assert!(ubuntu.check_environment(Some("wsl:ubuntu")).is_ok());
        assert!(ubuntu.check_environment(Some("native")).is_err());
        assert!(debian.check_environment(Some("wsl:ubuntu")).is_err());
        assert!(native.check_environment(Some("wsl:ubuntu")).is_err());
        assert!(native.check_environment(Some("native")).is_ok());
        assert!(native.check_environment(None).is_ok());
        assert!(native.check_environment(Some("unknown")).is_err());
        assert!(native.check_kind(Some("cmd")).is_ok());
        assert!(native.check_kind(Some("powershell")).is_err());
        assert!(ubuntu.check_kind(Some("wsl")).is_ok());
        assert!(ubuntu.check_kind(Some("bash")).is_err());
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
    fn powershell_integration_goes_in_front_of_a_profiles_own_command() {
        let def = |command: &str| CustomProfile {
            id: None,
            name: "x".into(),
            command: command.into(),
            cwd: None,
            env: Default::default(),
            theme: None,
            font_size: None,
            tab_color: None,
            icon: None,
            background: None,
        };
        let vs = Profile::custom(&def(r#"powershell.exe -NoExit -Command "Import-Module 'C:\x y\DevShell.dll'; Enter-VsDevShell abc""#));
        let args = argv(&vs.command(None, true));
        assert_eq!(args[..3], ["powershell.exe", "-NoExit", "-Command"]);
        assert_eq!(args.len(), 4, "nothing after the script: it would become its arguments");
        assert!(args[3].starts_with(". ([scriptblock]::Create("));
        assert!(args[3].ends_with(r"; Import-Module 'C:\x y\DevShell.dll'; Enter-VsDevShell abc"));
        let encoded = args[3].split('\'').nth(1).unwrap();
        let bytes = BASE64.decode(encoded).unwrap();
        let units: Vec<u16> = bytes.as_chunks::<2>().0.iter().map(|&p| u16::from_le_bytes(p)).collect();
        assert_eq!(String::from_utf16(&units).unwrap(), POWERSHELL_INTEGRATION);

        // -NoExit is added when missing, so the shell stays after the script.
        assert_eq!(argv(&Profile::custom(&def("pwsh -c \"npm run dev\"")).command(None, true))[1], "-NoExit");
        // A script file can't take it.
        assert_eq!(argv(&Profile::custom(&def("pwsh -File build.ps1")).command(None, true)), ["pwsh", "-File", "build.ps1"]);
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
    fn cmd_integration_wraps_the_prompt() {
        let cmd = Profile::new("cmd", "cmd", "cmd.exe", &[], Kind::Cmd).command(None, true);
        let prompt = cmd.get_env("PROMPT").unwrap().to_string_lossy().into_owned();
        // D (last command ended), A (prompt starts), the folder, the prompt, B (typing starts).
        assert!(prompt.starts_with("$e]133;D$e\\$e]133;A$e\\$e]9;9;$P$e\\"), "{prompt}");
        assert!(prompt.ends_with("$e]133;B$e\\"), "{prompt}");
    }

    #[test]
    fn reads_ssh_hosts_but_not_patterns() {
        let config = "# mine\nHost build-box gpu\n  HostName 10.0.0.5\n  User me\nHost *.internal !bad\nhost=pi\nHost \"quoted\" build-box\nMatch host x\nHostName not-a-host\n";
        assert_eq!(ssh_hosts(config), ["build-box", "gpu", "pi", "quoted"]);
        assert!(ssh_hosts("Host *\n  ForwardAgent yes\n").is_empty());
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
            tab_color: None,
            icon: None,
            background: None,
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
            tab_color: Some("green".into()),
            icon: None,
            background: None,
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
    #[test]
    fn explicit_wsl_profiles_share_association_and_prompt_environment_without_overwriting_exec_arguments(){
        let def:CustomProfile=serde_json::from_value(serde_json::json!({"name":"WSL test","command":"wsl.exe -d Ubuntu --exec /bin/bash --noprofile -i","env":{"WSLENV":"KEEP/p:QTERM_PANE/p:PROMPT_COMMAND/w"}})).unwrap();let profile=Profile::custom(&def);assert_eq!(profile.kind,Kind::Wsl);assert_eq!(profile.distribution.as_deref(),Some("Ubuntu"));let command=profile.command(Some("/c/Case Folder"),true);assert_eq!(argv(&command),["wsl.exe","--cd","/c/Case Folder","-d","Ubuntu","--exec","/bin/bash","--noprofile","-i"]);assert_eq!(command.get_env("WSLENV").unwrap(),"KEEP/p:QTERM_PANE:QTERM_INBOX:PROMPT_COMMAND/u");assert!(command.get_env("PROMPT_COMMAND").unwrap().to_string_lossy().contains("\"$PWD\""));
    }
    #[test]
    fn ambiguous_or_other_user_wsl_profiles_do_not_claim_default_distribution_identity(){
        for command in ["wsl.exe","wsl.exe --user root -d Ubuntu"]{let def:CustomProfile=serde_json::from_value(serde_json::json!({"name":"ambiguous","command":command})).unwrap();let profile=Profile::custom(&def);assert_eq!(profile.kind,Kind::Other);assert!(profile.distribution.is_none());}
        assert_eq!(shared_wsl_environment("A/w:B/p:QTERM_INBOX/p",false),"A/w:B/p:QTERM_PANE:QTERM_INBOX");
    }
}
