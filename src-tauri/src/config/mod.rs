//! User settings: `config.toml` in the app config directory. Validated on every
//! load; an invalid file never replaces the last good config, it is reported instead.

mod watch;

pub use watch::watch;

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::str::FromStr;
use std::sync::RwLock;

use serde::{Deserialize, Serialize};
use tauri_plugin_global_shortcut::{Code, Shortcut};

pub const FILE_NAME: &str = "config.toml";
/// Written on first run; documents every option. Must parse to `Config::default()`.
const DEFAULT_FILE: &str = include_str!("default.toml");

/// Read from TOML in snake_case, sent to the UI in camelCase.
#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
#[serde(default, deny_unknown_fields, rename_all(deserialize = "snake_case", serialize = "camelCase"))]
pub struct Config {
    pub hotkey: String,
    pub height: f64,
    pub width: f64,
    pub monitor: MonitorChoice,
    pub opacity: f64,
    pub slide_ms: u64,
    pub hide_on_blur: bool,
    pub default_profile: String,
    pub font: Font,
    /// Action name → chord; parsed and checked by the UI, which owns the shortcuts.
    pub keybindings: BTreeMap<String, String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum MonitorChoice {
    Cursor,
    Primary,
}

#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
#[serde(default, deny_unknown_fields)]
pub struct Font {
    pub family: String,
    pub size: f64,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            hotkey: "Backquote".into(),
            height: 0.5,
            width: 1.0,
            monitor: MonitorChoice::Cursor,
            opacity: 0.82,
            slide_ms: 150,
            hide_on_blur: false,
            default_profile: String::new(),
            font: Font::default(),
            keybindings: BTreeMap::new(),
        }
    }
}

impl Default for Font {
    fn default() -> Self {
        Self { family: r#""Cascadia Mono", "Cascadia Code", Consolas, monospace"#.into(), size: 14.0 }
    }
}

impl Config {
    pub fn parse(text: &str) -> Result<Self, String> {
        let config: Config = toml::from_str(text).map_err(|e| e.to_string().trim().to_string())?;
        config.validate()?;
        Ok(config)
    }

    /// The validated hotkey.
    pub fn hotkey(&self) -> Shortcut {
        parse_hotkey(&self.hotkey).unwrap_or_else(|_| Shortcut::new(None, Code::Backquote))
    }

    fn validate(&self) -> Result<(), String> {
        parse_hotkey(&self.hotkey)?;
        in_range("height", self.height, 0.1, 1.0)?;
        in_range("width", self.width, 0.2, 1.0)?;
        in_range("opacity", self.opacity, 0.0, 1.0)?;
        in_range("slide_ms", self.slide_ms as f64, 0.0, 1000.0)?;
        in_range("font.size", self.font.size, 6.0, 72.0)?;
        Ok(())
    }
}

/// The console key is a single press: one key name, no modifiers.
pub fn parse_hotkey(text: &str) -> Result<Shortcut, String> {
    let name = match text.trim() {
        "~" | "`" => "Backquote",
        other => other,
    };
    let invalid = || {
        format!("hotkey = \"{text}\" must be a single key without modifiers, e.g. \"Backquote\" or \"ScrollLock\"")
    };
    if name.is_empty() || name.contains('+') {
        return Err(invalid());
    }
    let shortcut = Shortcut::from_str(name).map_err(|_| invalid())?;
    if !shortcut.mods.is_empty() {
        return Err(invalid());
    }
    // RegisterHotKey always fails for F12: Windows keeps it for the debugger.
    if shortcut.key == Code::F12 {
        return Err(format!("hotkey = \"{text}\" can't be used: Windows reserves F12 for the debugger"));
    }
    Ok(shortcut)
}

/// How the hotkey is shown in menus: "~" for the key left of 1, else its name.
pub fn hotkey_label(shortcut: &Shortcut) -> String {
    match shortcut.key {
        Code::Backquote => "~".into(),
        key => format!("{key:?}"),
    }
}

fn in_range(name: &str, value: f64, min: f64, max: f64) -> Result<(), String> {
    if (min..=max).contains(&value) {
        Ok(())
    } else {
        Err(format!("{name} = {value} is out of range ({min} - {max})"))
    }
}

/// What the UI sees: the config in effect, plus the error if the file on disk is invalid.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub config: Config,
    pub error: Option<String>,
    pub path: PathBuf,
}

pub struct ConfigState {
    path: PathBuf,
    inner: RwLock<(Config, Option<String>)>,
}

impl ConfigState {
    /// Loads `dir/config.toml`, writing the documented defaults there on first run.
    pub fn load(dir: &Path) -> Self {
        let path = dir.join(FILE_NAME);
        if !path.exists() {
            let _ = std::fs::create_dir_all(dir);
            let _ = std::fs::write(&path, DEFAULT_FILE);
        }
        let (config, error) = match read(&path) {
            Ok(config) => (config, None),
            Err(e) => (Config::default(), Some(e)),
        };
        Self { path, inner: RwLock::new((config, error)) }
    }

    pub fn get(&self) -> Config {
        self.inner.read().unwrap().0.clone()
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn snapshot(&self) -> Snapshot {
        let (config, error) = self.inner.read().unwrap().clone();
        Snapshot { config, error, path: self.path.clone() }
    }

    /// Re-reads the file. Returns the previous config when a new valid one took effect.
    pub fn reload(&self) -> Reload {
        let mut inner = self.inner.write().unwrap();
        match read(&self.path) {
            Ok(config) => {
                let had_error = inner.1.take().is_some();
                if config == inner.0 {
                    if had_error { Reload::ErrorCleared } else { Reload::Unchanged }
                } else {
                    Reload::Changed(std::mem::replace(&mut inner.0, config))
                }
            }
            Err(e) => {
                inner.1 = Some(e);
                Reload::Invalid
            }
        }
    }
}

pub enum Reload {
    Unchanged,
    ErrorCleared,
    Invalid,
    Changed(Config),
}

fn read(path: &Path) -> Result<Config, String> {
    let text = std::fs::read_to_string(path).map_err(|e| format!("could not read {}: {e}", path.display()))?;
    Config::parse(&text).map_err(|e| format!("{}: {e}", path.display()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tauri_plugin_global_shortcut::Modifiers;

    #[test]
    fn the_documented_default_file_matches_the_defaults() {
        assert_eq!(Config::parse(DEFAULT_FILE).unwrap(), Config::default());
    }

    #[test]
    fn missing_values_take_defaults() {
        let config = Config::parse("height = 0.4\n[font]\nsize = 16").unwrap();
        assert_eq!(config.height, 0.4);
        assert_eq!(config.font.size, 16.0);
        assert_eq!(config.font.family, Font::default().family);
        assert_eq!(config.hotkey, "Backquote");
    }

    #[test]
    fn hotkey_is_a_single_key() {
        assert_eq!(parse_hotkey("Backquote").unwrap(), Shortcut::new(None, Code::Backquote));
        assert_eq!(parse_hotkey("~").unwrap(), Shortcut::new(None, Code::Backquote));
        assert_eq!(parse_hotkey("f13").unwrap(), Shortcut::new(None, Code::F13));
        assert_eq!(parse_hotkey("ScrollLock").unwrap(), Shortcut::new(None, Code::ScrollLock));
    }

    #[test]
    fn hotkey_rejects_modifiers_and_junk() {
        for bad in ["ctrl+Backquote", "Shift+F1", "Control", "", "NotAKey"] {
            let err = parse_hotkey(bad).unwrap_err();
            assert!(err.contains("single key"), "{bad}: {err}");
        }
        // A combo must not sneak in through the shortcut parser either.
        assert!(Shortcut::from_str("ctrl+F1").unwrap().mods.contains(Modifiers::CONTROL));
    }

    #[test]
    fn hotkey_rejects_f12_which_windows_reserves() {
        assert!(parse_hotkey("F12").unwrap_err().contains("reserves F12"));
    }

    #[test]
    fn labels_the_tilde_key() {
        assert_eq!(hotkey_label(&Shortcut::new(None, Code::Backquote)), "~");
        assert_eq!(hotkey_label(&Shortcut::new(None, Code::F12)), "F12");
    }

    #[test]
    fn rejects_out_of_range_values() {
        assert!(Config::parse("height = 1.5").unwrap_err().contains("height"));
        assert!(Config::parse("opacity = -0.1").unwrap_err().contains("opacity"));
        assert!(Config::parse("[font]\nsize = 200").unwrap_err().contains("font.size"));
    }

    #[test]
    fn rejects_unknown_settings_so_typos_surface() {
        assert!(Config::parse("hieght = 0.4").unwrap_err().contains("hieght"));
    }

    #[test]
    fn monitor_choice_parses() {
        assert_eq!(Config::parse("monitor = \"primary\"").unwrap().monitor, MonitorChoice::Primary);
        assert!(Config::parse("monitor = \"left\"").is_err());
    }

    #[test]
    fn load_writes_defaults_then_reload_tracks_edits() {
        let dir = std::env::temp_dir().join(format!("qterm-config-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let state = ConfigState::load(&dir);
        assert_eq!(state.get(), Config::default());
        assert!(state.path().exists());

        std::fs::write(state.path(), "height = 0.3").unwrap();
        assert!(matches!(state.reload(), Reload::Changed(old) if old == Config::default()));
        assert_eq!(state.get().height, 0.3);

        std::fs::write(state.path(), "height = 9").unwrap();
        assert!(matches!(state.reload(), Reload::Invalid));
        assert_eq!(state.get().height, 0.3, "last good config stays in effect");
        assert!(state.snapshot().error.unwrap().contains("height"));

        std::fs::write(state.path(), "height = 0.3").unwrap();
        assert!(matches!(state.reload(), Reload::ErrorCleared));
        assert!(state.snapshot().error.is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
