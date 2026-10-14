//! Settings → "Import from Windows Terminal": shells Windows Terminal has that qterm
//! doesn't. From its settings (Store, Preview or unpackaged), the profile fragments
//! other apps install, and the Visual Studio developer shells it generates (found the
//! same way, with vswhere). Shells qterm already has (same program and arguments, or
//! the same name) aren't offered.

use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::Value;

use crate::pty::{split_command, Profile};

#[derive(Clone, Debug, PartialEq, Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WtProfile {
    pub name: String,
    pub command: String,
    pub cwd: Option<String>,
    /// "#rrggbb", from the profile's colour scheme or background.
    pub background: Option<String>,
    /// One of qterm's tab colours, the nearest to the profile's.
    pub tab_color: Option<String>,
    pub icon: Option<String>,
    /// Where it came from, for the import list.
    pub origin: String,
}

/// Every shell worth offering, minus those qterm has.
pub fn candidates(existing: &[Profile]) -> Vec<WtProfile> {
    let mut found = Vec::new();
    for (path, origin) in settings_files() {
        if let Some(doc) = read_jsonc(&path) {
            found.extend(from_settings(&doc, origin));
        }
    }
    for path in fragment_files() {
        if let Some(doc) = read_jsonc(&path) {
            found.extend(from_settings(&doc, "a Windows Terminal fragment"));
        }
    }
    found.extend(vs_dev_shells());
    let mut offered: Vec<WtProfile> = Vec::new();
    for profile in found {
        let key = command_key(&profile.command);
        let known = existing.iter().any(|p| p.command_key() == key || p.name.eq_ignore_ascii_case(&profile.name))
            || offered.iter().any(|o| command_key(&o.command) == key || o.name.eq_ignore_ascii_case(&profile.name));
        if !known {
            offered.push(profile);
        }
    }
    offered
}

/// The program's file name and the arguments, lower-cased: what makes two shells the same.
pub fn command_key(command: &str) -> String {
    let parts = split_command(command);
    let Some((program, args)) = parts.split_first() else { return String::new() };
    let file = Path::new(program).file_name().map(|f| f.to_string_lossy().to_lowercase()).unwrap_or_default();
    let file = file.strip_suffix(".exe").unwrap_or(&file).to_string();
    std::iter::once(file).chain(args.iter().map(|a| a.to_lowercase())).collect::<Vec<_>>().join(" ")
}

fn settings_files() -> Vec<(PathBuf, &'static str)> {
    let Some(local) = std::env::var_os("LOCALAPPDATA").map(PathBuf::from) else { return Vec::new() };
    [
        (local.join(r"Packages\Microsoft.WindowsTerminal_8wekyb3d8bbwe\LocalState\settings.json"), "Windows Terminal"),
        (local.join(r"Packages\Microsoft.WindowsTerminalPreview_8wekyb3d8bbwe\LocalState\settings.json"), "Windows Terminal Preview"),
        (local.join(r"Microsoft\Windows Terminal\settings.json"), "Windows Terminal"),
    ]
    .into_iter()
    .filter(|(path, _)| path.exists())
    .collect()
}

fn fragment_files() -> Vec<PathBuf> {
    let roots = [std::env::var_os("LOCALAPPDATA"), std::env::var_os("ProgramData")];
    roots
        .into_iter()
        .flatten()
        .map(|root| PathBuf::from(root).join(r"Microsoft\Windows Terminal\Fragments"))
        .filter_map(|dir| std::fs::read_dir(dir).ok())
        .flat_map(|apps| apps.flatten().filter_map(|app| std::fs::read_dir(app.path()).ok()))
        .flat_map(|files| files.flatten().map(|f| f.path()))
        .filter(|p| p.extension().is_some_and(|e| e == "json"))
        .collect()
}

fn read_jsonc(path: &Path) -> Option<Value> {
    serde_json::from_str(&strip_jsonc(&std::fs::read_to_string(path).ok()?)).ok()
}

/// Windows Terminal's settings are JSON with comments and trailing commas.
pub fn strip_jsonc(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '"' => {
                out.push(c);
                while let Some(c) = chars.next() {
                    out.push(c);
                    match c {
                        '\\' => out.extend(chars.next()),
                        '"' => break,
                        _ => {}
                    }
                }
            }
            '/' if chars.peek() == Some(&'/') => {
                for c in chars.by_ref() {
                    if c == '\n' {
                        out.push('\n');
                        break;
                    }
                }
            }
            '/' if chars.peek() == Some(&'*') => {
                chars.next();
                let mut last = ' ';
                for c in chars.by_ref() {
                    if last == '*' && c == '/' {
                        break;
                    }
                    last = c;
                }
            }
            _ => out.push(c),
        }
    }
    // Trailing commas: a comma followed (after blanks) by a closing bracket.
    let bytes: Vec<char> = out.chars().collect();
    let mut cleaned = String::with_capacity(out.len());
    let mut in_string = false;
    let mut i = 0;
    while i < bytes.len() {
        let c = bytes[i];
        if in_string {
            cleaned.push(c);
            if c == '\\' && i + 1 < bytes.len() {
                cleaned.push(bytes[i + 1]);
                i += 1;
            } else if c == '"' {
                in_string = false;
            }
        } else if c == '"' {
            in_string = true;
            cleaned.push(c);
        } else if c == ',' && bytes[i + 1..].iter().find(|c| !c.is_whitespace()).is_some_and(|n| *n == '}' || *n == ']') {
            // dropped
        } else {
            cleaned.push(c);
        }
        i += 1;
    }
    cleaned
}

/// The profiles of a settings file or fragment, with `profiles.defaults` applied.
pub fn from_settings(doc: &Value, origin: &str) -> Vec<WtProfile> {
    let list = doc.pointer("/profiles/list").or_else(|| doc.get("profiles")).and_then(Value::as_array);
    let defaults = doc.pointer("/profiles/defaults").and_then(Value::as_object);
    let schemes = doc.get("schemes").and_then(Value::as_array);
    list.into_iter()
        .flatten()
        .filter_map(|profile| {
            let get = |key: &str| profile.get(key).or_else(|| defaults.and_then(|d| d.get(key)));
            let text = |key: &str| get(key).and_then(Value::as_str).map(str::to_string);
            if get("hidden").and_then(Value::as_bool) == Some(true) {
                return None;
            }
            let name = text("name")?;
            let command = text("commandline")?;
            let background = text("background")
                .filter(|b| is_hex(b))
                .or_else(|| text("colorScheme").and_then(|scheme| scheme_background(&scheme, schemes)));
            Some(WtProfile {
                name,
                command,
                cwd: text("startingDirectory").filter(|d| !d.is_empty()).map(|d| expand_env(&d)),
                background: background.map(|b| b.to_lowercase()),
                tab_color: text("tabColor").filter(|c| is_hex(c)).map(|c| nearest_tab_color(&c).to_string()),
                // Only an emoji or a few letters; paths to images don't fit qterm's tabs.
                icon: text("icon").filter(|i| i.chars().count() <= 4 && !i.contains(['\\', '/', '.'])),
                origin: origin.to_string(),
            })
        })
        .collect()
}

fn is_hex(text: &str) -> bool {
    text.len() == 7 && text.starts_with('#') && text[1..].chars().all(|c| c.is_ascii_hexdigit())
}

/// A scheme's background: the file's own schemes, else Windows Terminal's built-in ones.
fn scheme_background(scheme: &str, schemes: Option<&Vec<Value>>) -> Option<String> {
    let own = schemes.into_iter().flatten().find(|s| s.get("name").and_then(Value::as_str) == Some(scheme));
    if let Some(bg) = own.and_then(|s| s.get("background")).and_then(Value::as_str) {
        return Some(bg.to_string());
    }
    let builtin = [
        ("Campbell", "#0C0C0C"),
        ("Campbell Powershell", "#012456"),
        ("Vintage", "#000000"),
        ("One Half Dark", "#282C34"),
        ("One Half Light", "#FFFFFF"),
        ("Solarized Dark", "#002B36"),
        ("Solarized Light", "#FDF6E3"),
        ("Tango Dark", "#000000"),
        ("Tango Light", "#FFFFFF"),
        ("Dark+", "#1E1E1E"),
        ("Dimidium", "#141414"),
        ("Ottosson", "#000000"),
        ("CGA", "#000000"),
        ("IBM 5153", "#000000"),
    ];
    builtin.iter().find(|(name, _)| *name == scheme).map(|(_, bg)| bg.to_string())
}

/// qterm's tab colours and their values (TAB_COLOR_VALUES in TabStyleMenu.tsx).
const TAB_COLORS: [(&str, &str); 8] = [
    ("red", "#e06c75"),
    ("orange", "#d19a66"),
    ("yellow", "#e5c07b"),
    ("green", "#98c379"),
    ("teal", "#56b6c2"),
    ("blue", "#61afef"),
    ("purple", "#c678dd"),
    ("pink", "#f06292"),
];

/// The hue of "#rrggbb", in degrees.
fn hue(hex: &str) -> f64 {
    let channel = |i: usize| f64::from(u8::from_str_radix(&hex[i..i + 2], 16).unwrap_or(0)) / 255.0;
    let (r, g, b) = (channel(1), channel(3), channel(5));
    let (max, min) = (r.max(g).max(b), r.min(g).min(b));
    let d = max - min;
    if d == 0.0 {
        return 0.0;
    }
    let h = if max == r {
        ((g - b) / d).rem_euclid(6.0)
    } else if max == g {
        (b - r) / d + 2.0
    } else {
        (r - g) / d + 4.0
    };
    h * 60.0
}

/// The tab colour nearest in hue: what people call the colour, not the nearest RGB
/// value (Windows Terminal's blue #0078D4 is nearer qterm's teal than its blue in RGB).
pub fn nearest_tab_color(hex: &str) -> &'static str {
    let target = hue(hex);
    let distance = |h: f64| {
        let d = (h - target).abs();
        d.min(360.0 - d)
    };
    TAB_COLORS
        .iter()
        .min_by(|a, b| distance(hue(a.1)).total_cmp(&distance(hue(b.1))))
        .map(|(name, _)| *name)
        .unwrap_or("blue")
}

/// %USERPROFILE%\work → C:\Users\me\work; unknown variables stay as they are.
pub fn expand_env(text: &str) -> String {
    let mut out = String::new();
    let mut rest = text;
    while let Some(start) = rest.find('%') {
        out.push_str(&rest[..start]);
        let after = &rest[start + 1..];
        match after.find('%') {
            Some(end) => {
                let name = &after[..end];
                match std::env::var(name) {
                    Ok(value) if !name.is_empty() => out.push_str(&value),
                    _ => out.push_str(&rest[start..start + end + 2]),
                }
                rest = &after[end + 1..];
            }
            None => {
                out.push_str(&rest[start..]);
                rest = "";
            }
        }
    }
    out.push_str(rest);
    out
}

/// The Visual Studio developer shells Windows Terminal generates, one pair per
/// installation that has the developer shell module.
fn vs_dev_shells() -> Vec<WtProfile> {
    let Some(x86) = std::env::var_os("ProgramFiles(x86)") else { return Vec::new() };
    let vswhere = PathBuf::from(x86).join(r"Microsoft Visual Studio\Installer\vswhere.exe");
    let mut command = std::process::Command::new(&vswhere);
    command.args(["-products", "*", "-format", "json", "-utf8"]);
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    let Ok(output) = command.output() else { return Vec::new() };
    let Ok(Value::Array(instances)) = serde_json::from_slice::<Value>(&output.stdout) else { return Vec::new() };
    dev_shells(&instances)
}

fn dev_shells(instances: &[Value]) -> Vec<WtProfile> {
    let mut shells = Vec::new();
    for instance in instances {
        let text = |path: &str| instance.pointer(path).and_then(Value::as_str);
        let (Some(id), Some(path)) = (text("/instanceId"), text("/installationPath")) else { continue };
        let tools = Path::new(path).join(r"Common7\Tools");
        let dll = tools.join("Microsoft.VisualStudio.DevShell.dll");
        let bat = tools.join("VsDevCmd.bat");
        let version = text("/catalog/productLineVersion").or(text("/displayName")).unwrap_or("");
        let same_line = instances.iter().filter(|i| i.pointer("/catalog/productLineVersion").and_then(Value::as_str) == Some(version)).count();
        // Two installs of one version (e.g. Community and Build Tools 2022) need telling apart.
        let label = match (same_line > 1, text("/displayName")) {
            (true, Some(display)) => format!("VS {version} ({display})"),
            _ => format!("VS {version}"),
        };
        if dll.exists() {
            shells.push(WtProfile {
                name: format!("Developer PowerShell for {label}"),
                command: format!(
                    "powershell.exe -NoExit -Command \"Import-Module '{}'; Enter-VsDevShell {id} -SkipAutomaticLocation -SetDefaultWindowTitle\"",
                    dll.display()
                ),
                cwd: None,
                background: None,
                tab_color: None,
                icon: None,
                origin: "Visual Studio".into(),
            });
        }
        if bat.exists() {
            shells.push(WtProfile {
                name: format!("Developer Command Prompt for {label}"),
                command: format!("cmd.exe /k \"{}\"", bat.display()),
                cwd: None,
                background: None,
                tab_color: None,
                icon: None,
                origin: "Visual Studio".into(),
            });
        }
    }
    shells
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_json_with_comments_and_trailing_commas_but_leaves_strings_alone() {
        let text = r#"{
            "$help": "https://aka.ms/terminal-documentation", // a comment
            /* block
               comment */
            "list": [1, 2, ],
            "quote": "say \"//not a comment\", ok",
        }"#;
        let doc: Value = serde_json::from_str(&strip_jsonc(text)).unwrap();
        assert_eq!(doc["$help"], "https://aka.ms/terminal-documentation");
        assert_eq!(doc["list"], serde_json::json!([1, 2]));
        assert_eq!(doc["quote"], "say \"//not a comment\", ok");
    }

    #[test]
    fn takes_visible_profiles_with_a_command_line_and_their_look() {
        let doc = serde_json::json!({
            "profiles": {
                "defaults": { "colorScheme": "One Half Dark" },
                "list": [
                    { "name": "Prod box", "commandline": "ssh admin@prod", "startingDirectory": "%NO_SUCH_VAR%\\x", "tabColor": "#E81123", "icon": "🔥" },
                    { "name": "Mine", "commandline": "pwsh -NoLogo", "colorScheme": "Mine", "icon": "C:\\icons\\a.png" },
                    { "name": "Hidden", "commandline": "cmd.exe", "hidden": true },
                    { "name": "Ubuntu", "source": "Windows.Terminal.Wsl" }
                ]
            },
            "schemes": [{ "name": "Mine", "background": "#102030" }]
        });
        let found = from_settings(&doc, "Windows Terminal");
        assert_eq!(found.len(), 2);
        assert_eq!(found[0].command, "ssh admin@prod");
        assert_eq!(found[0].cwd.as_deref(), Some("%NO_SUCH_VAR%\\x"));
        assert_eq!(found[0].background.as_deref(), Some("#282c34"), "from the defaults' built-in scheme");
        assert_eq!(found[0].tab_color.as_deref(), Some("red"));
        assert_eq!(found[0].icon.as_deref(), Some("🔥"));
        assert_eq!(found[1].background.as_deref(), Some("#102030"), "from the file's own scheme");
        assert_eq!(found[1].icon, None, "an image path doesn't fit a tab");
    }

    #[test]
    fn compares_shells_by_program_name_and_arguments() {
        assert_eq!(command_key(r"C:\Windows\System32\cmd.exe"), "cmd");
        assert_eq!(command_key("CMD.EXE"), "cmd");
        assert_eq!(command_key("wsl.exe -d Ubuntu"), "wsl -d ubuntu");
        assert_ne!(command_key("cmd.exe /k vsdevcmd.bat"), command_key("cmd.exe"));
    }

    #[test]
    fn expands_known_environment_variables() {
        let home = std::env::var("USERPROFILE").unwrap();
        assert_eq!(expand_env("%USERPROFILE%\\work"), format!("{home}\\work"));
        assert_eq!(expand_env("100% sure"), "100% sure");
    }

    #[test]
    fn makes_dev_shells_per_visual_studio_install() {
        let dir = std::env::temp_dir().join(format!("qterm-vs-{}", std::process::id()));
        let tools = dir.join(r"Common7\Tools");
        std::fs::create_dir_all(&tools).unwrap();
        std::fs::write(tools.join("Microsoft.VisualStudio.DevShell.dll"), "").unwrap();
        std::fs::write(tools.join("VsDevCmd.bat"), "").unwrap();
        let instances = [serde_json::json!({
            "instanceId": "abc123", "installationPath": dir.to_string_lossy(), "displayName": "Visual Studio Community 2022",
            "catalog": { "productLineVersion": "2022" }
        })];
        let shells = dev_shells(&instances);
        assert_eq!(shells.iter().map(|s| s.name.as_str()).collect::<Vec<_>>(), ["Developer PowerShell for VS 2022", "Developer Command Prompt for VS 2022"]);
        // qterm's own splitter keeps the -Command script in one piece.
        let parts = split_command(&shells[0].command);
        assert_eq!(parts.len(), 4);
        assert!(parts[3].starts_with("Import-Module '") && parts[3].contains("Enter-VsDevShell abc123"));
        assert_eq!(split_command(&shells[1].command)[2], tools.join("VsDevCmd.bat").to_string_lossy());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn picks_the_nearest_tab_colour() {
        assert_eq!(nearest_tab_color("#E81123"), "red");
        assert_eq!(nearest_tab_color("#0078D4"), "blue");
        assert_eq!(nearest_tab_color("#16C60C"), "green");
    }
}
