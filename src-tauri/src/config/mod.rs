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
    /// Windows 11 material behind the console's translucent background.
    pub background_effect: BackgroundEffect,
    pub slide_ms: u64,
    pub hide_on_blur: bool,
    pub default_profile: String,
    pub theme: String,
    pub copy_on_select: bool,
    pub right_click_paste: bool,
    pub restore_session: bool,
    pub shell_integration: bool,
    pub claude_sessions: bool,
    pub claude_alerts: bool,
    /// Reopen the Claude Code sessions that ran in panes, when tabs are restored.
    pub claude_restore: bool,
    /// Command that opens a file at a line; {file}, {line}, {col} are filled in.
    pub editor: String,
    /// Notify when a command that ran this many seconds ends while you aren't looking; 0 = off.
    pub long_command_alert: u32,
    /// Show sixel, iTerm and Kitty images in the terminal.
    pub inline_images: bool,
    /// Offer the hosts in ~/.ssh/config as shells ("SSH <host>").
    pub ssh_profiles: bool,
    /// Look for a newer release on start and daily.
    pub check_updates: bool,
    /// "Open in qterm" in Explorer's menu for folders.
    pub explorer_menu: bool,
    pub font: Font,
    /// Action name → chord; parsed and checked by the UI, which owns the shortcuts.
    pub keybindings: BTreeMap<String, String>,
    /// Extra shells next to the detected ones ([[profiles]]).
    pub profiles: Vec<CustomProfile>,
    /// Named tab layouts ([[layouts]]).
    pub layouts: Vec<LayoutDef>,
    /// Named commands typed into the current pane from the palette ([[snippets]]).
    pub snippets: Vec<Snippet>,
    /// Keeping each pane's output across restarts ([scrollback]).
    pub scrollback: ScrollbackSettings,
}

#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
#[serde(default, deny_unknown_fields, rename_all(deserialize = "snake_case", serialize = "camelCase"))]
pub struct ScrollbackSettings {
    /// For shells not listed in `profiles`.
    pub restore: bool,
    /// Lines kept per pane.
    pub lines: u32,
    /// Profile id → on/off, overriding `restore` for that shell.
    pub profiles: BTreeMap<String, bool>,
}

impl Default for ScrollbackSettings {
    fn default() -> Self {
        Self { restore: true, lines: 1000, profiles: BTreeMap::new() }
    }
}

/// A user-defined shell, e.g. an SSH host or `npm run dev` in a folder.
#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all(deserialize = "snake_case", serialize = "camelCase"))]
pub struct CustomProfile {
    /// Defaults to "custom:<name>". Reusing a detected id ("pwsh") restyles that shell.
    #[serde(default)]
    pub id: Option<String>,
    pub name: String,
    /// Program and arguments; double quotes keep spaces together.
    pub command: String,
    #[serde(default)]
    pub cwd: Option<String>,
    #[serde(default)]
    pub env: BTreeMap<String, String>,
    /// Look of this profile's panes, overriding the global settings.
    #[serde(default)]
    pub theme: Option<String>,
    #[serde(default)]
    pub font_size: Option<f64>,
    /// Colour of its tabs: one of TAB_COLORS.
    #[serde(default)]
    pub tab_color: Option<String>,
    /// Shown before its tabs' titles: an emoji or a few letters.
    #[serde(default)]
    pub icon: Option<String>,
    /// Background colour of its panes ("#rrggbb"), at the console's opacity.
    #[serde(default)]
    pub background: Option<String>,
}

/// "#rrggbb".
fn is_hex_color(text: &str) -> bool {
    text.len() == 7 && text.starts_with('#') && text[1..].chars().all(|c| c.is_ascii_hexdigit())
}

/// The colours a tab can have (the UI maps them to the theme's palette).
pub const TAB_COLORS: [&str; 8] = ["red", "orange", "yellow", "green", "teal", "blue", "purple", "pink"];

impl CustomProfile {
    pub fn id(&self) -> String {
        self.id.clone().unwrap_or_else(|| format!("custom:{}", self.name))
    }
}

/// A named command, typed into the current pane from the command palette.
#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all(deserialize = "snake_case", serialize = "camelCase"))]
pub struct Snippet {
    pub name: String,
    pub command: String,
    /// Press Enter after typing it.
    #[serde(default)]
    pub run: bool,
}

/// A named arrangement of panes for a new tab: a pane (or split) with a name.
#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all(deserialize = "snake_case", serialize = "camelCase"))]
pub struct LayoutDef {
    pub name: String,
    #[serde(default)]
    pub profile: Option<String>,
    #[serde(default)]
    pub cwd: Option<String>,
    #[serde(default)]
    pub command: Option<String>,
    #[serde(default)]
    pub split: Option<SplitDir>,
    #[serde(default)]
    pub panes: Vec<LayoutPane>,
}

impl LayoutDef {
    pub fn root(&self) -> LayoutPane {
        LayoutPane {
            profile: self.profile.clone(),
            cwd: self.cwd.clone(),
            command: self.command.clone(),
            split: self.split,
            panes: self.panes.clone(),
        }
    }
}

/// One pane, or (with `panes`) a split of several, side by side ("row") or stacked.
#[derive(Clone, Debug, Default, PartialEq, Deserialize, Serialize)]
#[serde(default, deny_unknown_fields, rename_all(deserialize = "snake_case", serialize = "camelCase"))]
pub struct LayoutPane {
    /// Profile id or name; the default profile when empty.
    pub profile: Option<String>,
    pub cwd: Option<String>,
    /// Typed into the shell once it starts.
    pub command: Option<String>,
    pub split: Option<SplitDir>,
    pub panes: Vec<LayoutPane>,
}

#[derive(Clone, Copy, Debug, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum SplitDir {
    Row,
    Column,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum BackgroundEffect {
    #[default]
    None,
    /// Frosted glass: what's behind the console, blurred and tinted.
    Acrylic,
    /// The desktop wallpaper's tint (Windows 11); turns solid while unfocused.
    Mica,
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
    /// Draw programming ligatures (=>, !=, ...); needs a font that has them.
    pub ligatures: bool,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            hotkey: "Backquote".into(),
            height: 0.5,
            width: 1.0,
            monitor: MonitorChoice::Cursor,
            opacity: 0.82,
            background_effect: BackgroundEffect::None,
            slide_ms: 150,
            hide_on_blur: false,
            default_profile: String::new(),
            theme: "qterm".into(),
            copy_on_select: false,
            right_click_paste: true,
            restore_session: true,
            shell_integration: true,
            claude_sessions: false,
            claude_alerts: true,
            claude_restore: false,
            editor: "code --goto {file}:{line}:{col}".into(),
            long_command_alert: 30,
            inline_images: true,
            ssh_profiles: true,
            check_updates: true,
            explorer_menu: false,
            font: Font::default(),
            keybindings: BTreeMap::new(),
            profiles: Vec::new(),
            layouts: Vec::new(),
            snippets: Vec::new(),
            scrollback: ScrollbackSettings::default(),
        }
    }
}

impl Default for Font {
    fn default() -> Self {
        Self { family: r#""Cascadia Mono", "Cascadia Code", Consolas, monospace"#.into(), size: 14.0, ligatures: false }
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
        in_range("scrollback.lines", f64::from(self.scrollback.lines), 100.0, 10_000.0)?;
        let mut ids = std::collections::BTreeSet::new();
        for profile in &self.profiles {
            if profile.name.trim().is_empty() {
                return Err("[[profiles]] entries need a name".into());
            }
            if crate::pty::split_command(&profile.command).is_empty() {
                return Err(format!("profile \"{}\" has an empty command", profile.name));
            }
            if !ids.insert(profile.id()) {
                return Err(format!("two [[profiles]] share the id \"{}\"", profile.id()));
            }
            if let Some(size) = profile.font_size {
                in_range(&format!("profile \"{}\" font_size", profile.name), size, 6.0, 72.0)?;
            }
            if let Some(color) = &profile.tab_color
                && !TAB_COLORS.contains(&color.as_str())
            {
                return Err(format!("profile \"{}\" tab_color \"{color}\" is not one of {}", profile.name, TAB_COLORS.join(", ")));
            }
            if let Some(background) = &profile.background
                && !is_hex_color(background)
            {
                return Err(format!("profile \"{}\" background \"{background}\" is not a colour like \"#1e1e2e\"", profile.name));
            }
            if profile.icon.as_ref().is_some_and(|icon| icon.chars().count() > 4) {
                return Err(format!("profile \"{}\" icon is longer than 4 characters", profile.name));
            }
        }
        let mut names = std::collections::BTreeSet::new();
        for layout in &self.layouts {
            if layout.name.trim().is_empty() {
                return Err("[[layouts]] entries need a name".into());
            }
            if !names.insert(layout.name.as_str()) {
                return Err(format!("two [[layouts]] are named \"{}\"", layout.name));
            }
            check_layout(&layout.name, &layout.root(), 0)?;
        }
        if self.editor.trim().is_empty() {
            return Err("editor must not be empty (e.g. \"code --goto {file}:{line}:{col}\")".into());
        }
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

/// Splits need a direction and nest at most a few levels.
fn check_layout(name: &str, pane: &LayoutPane, depth: usize) -> Result<(), String> {
    const MAX_DEPTH: usize = 6;
    if depth > MAX_DEPTH {
        return Err(format!("layout \"{name}\" nests splits deeper than {MAX_DEPTH} levels"));
    }
    if !pane.panes.is_empty() && pane.split.is_none() {
        return Err(format!("layout \"{name}\": a pane with `panes` needs split = \"row\" or \"column\""));
    }
    pane.panes.iter().try_for_each(|child| check_layout(name, child, depth + 1))
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
                    Reload::Changed(Box::new(std::mem::replace(&mut inner.0, config)))
                }
            }
            Err(e) => {
                inner.1 = Some(e);
                Reload::Invalid
            }
        }
    }
}

impl ConfigState {
    /// Writes `changes` (TOML keys: "height", "font.size", "keybindings", ...) into
    /// config.toml, keeping its comments and layout. The result must validate first;
    /// the file watcher then reloads it like any other edit.
    pub fn update(&self, changes: &serde_json::Map<String, serde_json::Value>) -> Result<(), String> {
        let text = std::fs::read_to_string(&self.path).map_err(|e| format!("could not read settings: {e}"))?;
        let updated = apply_changes(&text, changes)?;
        Config::parse(&updated)?;
        crate::claude::write_atomically(&self.path, &updated)
    }

    /// Settings export: config.toml as it is on disk, comments included.
    pub fn export_to(&self, target: &Path) -> Result<(), String> {
        std::fs::copy(&self.path, target).map(|_| ()).map_err(|e| format!("could not export settings: {e}"))
    }

    /// Settings import: replaces config.toml with `source` once it validates. The
    /// previous file stays as config.toml.bak; the file watcher applies the new one.
    pub fn import_from(&self, source: &Path) -> Result<(), String> {
        let text = std::fs::read_to_string(source).map_err(|e| format!("could not read {}: {e}", source.display()))?;
        Config::parse(&text).map_err(|e| format!("not valid qterm settings: {e}"))?;
        if self.path.exists() {
            std::fs::copy(&self.path, self.path.with_extension("toml.bak"))
                .map_err(|e| format!("could not back up the current settings: {e}"))?;
        }
        crate::claude::write_atomically(&self.path, &text)
    }
}

fn apply_changes(text: &str, changes: &serde_json::Map<String, serde_json::Value>) -> Result<String, String> {
    use toml_edit::{DocumentMut, Item, Table};

    let mut doc: DocumentMut = text.parse().map_err(|e| format!("settings file is not valid TOML: {e}"))?;
    for (key, value) in changes {
        let (table, name) = match key.split_once('.') {
            Some((table, name)) => (Some(table), name),
            None => (None, key.as_str()),
        };
        let parent = match table {
            Some(table) => doc
                .entry(table)
                .or_insert_with(|| Item::Table(Table::new()))
                .as_table_mut()
                .ok_or_else(|| format!("[{table}] is not a table"))?,
            None => doc.as_table_mut(),
        };

        // A whole table (keybindings, scrollback.profiles): exactly these entries
        // afterwards. It may be a [table] or an inline { ... } table.
        if let serde_json::Value::Object(entries) = value {
            let target = parent
                .entry(name)
                .or_insert_with(|| Item::Table(Table::new()))
                .as_table_like_mut()
                .ok_or_else(|| format!("{key} is not a table"))?;
            let stale: Vec<String> = target.iter().map(|(k, _)| k.to_string()).filter(|k| !entries.contains_key(k)).collect();
            for k in stale {
                target.remove(&k);
            }
            for (k, v) in entries {
                set_value(target, k, v)?;
            }
        } else {
            set_value(parent, name, value)?;
        }
    }
    Ok(doc.to_string())
}

/// Replaces a value but keeps what surrounds it: the comment lines above belong to
/// the key and a trailing `# comment` to the value, so both are carried over.
fn set_value(table: &mut dyn toml_edit::TableLike, key: &str, value: &serde_json::Value) -> Result<(), String> {
    let mut new = match value {
        serde_json::Value::Bool(b) => toml_edit::Value::from(*b),
        serde_json::Value::String(s) => toml_edit::Value::from(s.as_str()),
        serde_json::Value::Number(n) => match n.as_i64() {
            Some(i) => toml_edit::Value::from(i),
            None => toml_edit::Value::from(n.as_f64().ok_or("number out of range")?),
        },
        other => return Err(format!("{key}: unsupported value {other}")),
    };
    match table.get_mut(key) {
        Some(item) => {
            if let Some(old) = item.as_value() {
                *new.decor_mut() = old.decor().clone();
            }
            *item = toml_edit::Item::Value(new);
        }
        None => {
            table.insert(key, toml_edit::Item::Value(new));
        }
    }
    Ok(())
}

impl ConfigState {
    /// Adds a [[layouts]] entry, replacing one with the same name. `layout` is the UI's
    /// layout JSON (name, split, panes, profile, cwd, command), written as TOML.
    pub fn save_layout(&self, layout: &serde_json::Value) -> Result<(), String> {
        let name = layout.get("name").and_then(|n| n.as_str()).ok_or("a layout needs a name")?.to_string();
        self.edit_layouts(|layouts| {
            let table = layout_table(layout)?;
            match position(layouts, &name) {
                Some(i) => *layouts.get_mut(i).expect("index from position") = table,
                None => layouts.push(table),
            }
            Ok(())
        })
    }

    pub fn delete_layout(&self, name: &str) -> Result<(), String> {
        self.edit_layouts(|layouts| {
            if let Some(i) = position(layouts, name) {
                layouts.remove(i);
            }
            Ok(())
        })
    }

    /// Adds [[profiles]] entries (Settings → Import from Windows Terminal), keeping the file's comments.
    pub fn add_profiles(&self, profiles: &[crate::wt_import::WtProfile]) -> Result<(), String> {
        let text = std::fs::read_to_string(&self.path).map_err(|e| format!("could not read settings: {e}"))?;
        let mut doc: toml_edit::DocumentMut = text.parse().map_err(|e| format!("settings file is not valid TOML: {e}"))?;
        let item = doc.entry("profiles").or_insert(toml_edit::Item::ArrayOfTables(toml_edit::ArrayOfTables::new()));
        let list = item.as_array_of_tables_mut().ok_or("`profiles` is not a list of [[profiles]] tables")?;
        for profile in profiles {
            let mut table = toml_edit::Table::new();
            table.insert("name", toml_edit::value(profile.name.as_str()));
            table.insert("command", toml_edit::value(profile.command.as_str()));
            for (key, value) in [("cwd", &profile.cwd), ("background", &profile.background), ("tab_color", &profile.tab_color), ("icon", &profile.icon)] {
                if let Some(value) = value {
                    table.insert(key, toml_edit::value(value.as_str()));
                }
            }
            list.push(table);
        }
        let updated = doc.to_string();
        Config::parse(&updated)?;
        crate::claude::write_atomically(&self.path, &updated)
    }

    fn edit_layouts(&self, change: impl FnOnce(&mut toml_edit::ArrayOfTables) -> Result<(), String>) -> Result<(), String> {
        let text = std::fs::read_to_string(&self.path).map_err(|e| format!("could not read settings: {e}"))?;
        let mut doc: toml_edit::DocumentMut = text.parse().map_err(|e| format!("settings file is not valid TOML: {e}"))?;
        let item = doc.entry("layouts").or_insert(toml_edit::Item::ArrayOfTables(toml_edit::ArrayOfTables::new()));
        let layouts = item.as_array_of_tables_mut().ok_or("`layouts` is not a list of [[layouts]] tables")?;
        change(layouts)?;
        if layouts.is_empty() {
            doc.remove("layouts");
        }
        let updated = doc.to_string();
        Config::parse(&updated)?;
        crate::claude::write_atomically(&self.path, &updated)
    }
}

fn position(layouts: &toml_edit::ArrayOfTables, name: &str) -> Option<usize> {
    layouts.iter().position(|t| t.get("name").and_then(|n| n.as_str()) == Some(name))
}

/// The layout's top level becomes a [[layouts]] table; nested panes inline tables.
fn layout_table(layout: &serde_json::Value) -> Result<toml_edit::Table, String> {
    let object = layout.as_object().ok_or("a layout must be an object")?;
    let mut table = toml_edit::Table::new();
    for (key, value) in object {
        if let Some(value) = toml_value(value)? {
            table.insert(&snake(key), toml_edit::Item::Value(value));
        }
    }
    Ok(table)
}

/// JSON → TOML value; nulls and empty lists are left out.
fn toml_value(value: &serde_json::Value) -> Result<Option<toml_edit::Value>, String> {
    use serde_json::Value as J;
    Ok(match value {
        J::Null => None,
        J::Bool(b) => Some((*b).into()),
        J::Number(n) => Some(match n.as_i64() {
            Some(i) => i.into(),
            None => n.as_f64().ok_or("number out of range")?.into(),
        }),
        J::String(s) => Some(s.as_str().into()),
        J::Array(items) if items.is_empty() => None,
        J::Array(items) => {
            let mut array = toml_edit::Array::new();
            for item in items {
                if let Some(v) = toml_value(item)? {
                    array.push_formatted(v.decorated("\n  ", ""));
                }
            }
            array.set_trailing("\n");
            array.set_trailing_comma(true);
            Some(toml_edit::Value::Array(array))
        }
        J::Object(map) => {
            let mut inline = toml_edit::InlineTable::new();
            for (key, value) in map {
                if let Some(value) = toml_value(value)? {
                    inline.insert(snake(key), value);
                }
            }
            Some(toml_edit::Value::InlineTable(inline))
        }
    })
}

/// fontSize → font_size (the UI speaks camelCase, the file snake_case).
fn snake(key: &str) -> String {
    let mut out = String::new();
    for ch in key.chars() {
        if ch.is_ascii_uppercase() {
            out.push('_');
            out.push(ch.to_ascii_lowercase());
        } else {
            out.push(ch);
        }
    }
    out
}

pub enum Reload {
    Unchanged,
    ErrorCleared,
    Invalid,
    Changed(Box<Config>),
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
    fn reads_custom_profiles_and_layouts() {
        let config = Config::parse(
            r#"
[[profiles]]
name = "API server"
command = 'pwsh -NoExit -Command "npm run dev"'
cwd = "C:/work/api"
theme = "dracula"
font_size = 13
env = { NODE_ENV = "development" }

[[layouts]]
name = "dev"
split = "row"
panes = [
  { profile = "API server" },
  { cwd = "C:/work/web", command = "npm start" },
  { split = "column", panes = [ {}, { profile = "wsl:Ubuntu" } ] },
]
"#,
        )
        .unwrap();
        assert_eq!(config.profiles[0].id(), "custom:API server");
        assert_eq!(config.profiles[0].env["NODE_ENV"], "development");
        let root = &config.layouts[0].root();
        assert_eq!(root.split, Some(SplitDir::Row));
        assert_eq!(root.panes.len(), 3);
        assert_eq!(root.panes[2].panes[1].profile.as_deref(), Some("wsl:Ubuntu"));
    }

    #[test]
    fn reads_scrollback_settings_per_shell() {
        let config = Config::parse("[scrollback]\nlines = 500\nprofiles = { \"wsl:Ubuntu\" = false, cmd = true }").unwrap();
        assert!(config.scrollback.restore, "default stays on");
        assert_eq!(config.scrollback.lines, 500);
        assert!(!config.scrollback.profiles["wsl:Ubuntu"]);
        assert!(Config::parse("[scrollback]\nlines = 5").unwrap_err().contains("scrollback.lines"));
    }

    #[test]
    fn exports_and_imports_settings() {
        let dir = std::env::temp_dir().join(format!("qterm-config-io-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let state = ConfigState::load(&dir);
        let exported = dir.join("exported.toml");
        state.export_to(&exported).unwrap();
        assert_eq!(std::fs::read_to_string(&exported).unwrap(), DEFAULT_FILE, "comments and all");

        let broken = dir.join("broken.toml");
        std::fs::write(&broken, "height = \"tall\"").unwrap();
        assert!(state.import_from(&broken).unwrap_err().contains("not valid qterm settings"));
        assert_eq!(std::fs::read_to_string(state.path()).unwrap(), DEFAULT_FILE, "untouched after a bad import");

        let other = dir.join("other.toml");
        std::fs::write(&other, "height = 0.4\n").unwrap();
        state.import_from(&other).unwrap();
        assert_eq!(std::fs::read_to_string(state.path()).unwrap(), "height = 0.4\n");
        assert_eq!(std::fs::read_to_string(dir.join("config.toml.bak")).unwrap(), DEFAULT_FILE);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn reads_snippets() {
        let config = Config::parse("[[snippets]]\nname = \"log\"\ncommand = \"git log -5\"\nrun = true\n[[snippets]]\nname = \"edit\"\ncommand = \"code .\"").unwrap();
        assert_eq!(config.snippets.len(), 2);
        assert!(config.snippets[0].run);
        assert!(!config.snippets[1].run, "waits at the prompt by default");
        assert!(Config::parse("[[snippets]]\nname = \"x\"").unwrap_err().contains("command"));
    }

    #[test]
    fn rejects_broken_profiles_and_layouts() {
        assert!(Config::parse("[[profiles]]\nname = \"x\"\ncommand = \"  \"").unwrap_err().contains("empty command"));
        assert!(Config::parse("[[profiles]]\nname = \"a\"\ncommand = \"ssh a\"\n[[profiles]]\nname = \"a\"\ncommand = \"ssh b\"")
            .unwrap_err()
            .contains("share the id"));
        assert!(Config::parse("[[profiles]]\nname = \"x\"\ncommand = \"ssh x\"\ntab_color = \"mauve\"").unwrap_err().contains("tab_color"));
        assert!(Config::parse("[[profiles]]\nname = \"x\"\ncommand = \"ssh x\"\nicon = \"abcdef\"").unwrap_err().contains("icon"));
        let ok = Config::parse("[[profiles]]\nname = \"x\"\ncommand = \"ssh x\"\ntab_color = \"teal\"\nicon = \"🐳\"").unwrap();
        assert_eq!(ok.profiles[0].tab_color.as_deref(), Some("teal"));
        assert!(Config::parse("[[profiles]]\nname = \"x\"\ncommand = \"ssh x\"\nbackground = \"navy\"").unwrap_err().contains("background"));
        let dark = Config::parse("[[profiles]]\nname = \"x\"\ncommand = \"ssh x\"\nbackground = \"#1E1E2e\"").unwrap();
        assert_eq!(dark.profiles[0].background.as_deref(), Some("#1E1E2e"));
        assert!(Config::parse("[[layouts]]\nname = \"x\"\npanes = [{}, {}]").unwrap_err().contains("needs split"));
        assert!(Config::parse("[[layouts]]\nname = \"x\"\n[[layouts]]\nname = \"x\"").unwrap_err().contains("named"));
        assert!(Config::parse("[[layouts]]\nname = \"x\"\nsplit = \"diagonal\"").is_err());
    }

    #[test]
    fn saves_replaces_and_deletes_layouts_keeping_the_file() {
        let dir = std::env::temp_dir().join(format!("qterm-layouts-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let state = ConfigState::load(&dir);
        let dev = serde_json::json!({
            "name": "dev",
            "split": "row",
            "panes": [{ "profile": "pwsh", "cwd": "C:/work/api" }, { "split": "column", "panes": [{}, { "command": "npm start" }] }],
        });
        state.save_layout(&dev).unwrap();
        state.save_layout(&serde_json::json!({ "name": "solo", "cwd": "D:/x" })).unwrap();
        state.save_layout(&serde_json::json!({ "name": "dev", "split": "column", "panes": [{}, {}] })).unwrap();

        let text = std::fs::read_to_string(state.path()).unwrap();
        assert!(text.starts_with("# qterm settings."), "comments kept");
        let config = Config::parse(&text).unwrap();
        assert_eq!(config.layouts.iter().map(|l| l.name.as_str()).collect::<Vec<_>>(), ["dev", "solo"]);
        assert_eq!(config.layouts[0].split, Some(SplitDir::Column), "replaced in place");

        state.delete_layout("dev").unwrap();
        state.delete_layout("solo").unwrap();
        let text = std::fs::read_to_string(state.path()).unwrap();
        assert!(Config::parse(&text).unwrap().layouts.is_empty());
        assert!(!text.lines().any(|l| l.trim() == "[[layouts]]"), "no table left (commented examples stay)");
        let _ = std::fs::remove_dir_all(&dir);
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
    fn editing_keeps_comments_and_layout() {
        let changes = serde_json::json!({
            "height": 0.4,
            "slide_ms": 0,
            "theme": "nord",
            "font.size": 16,
            "keybindings": { "new_tab": "ctrl+t" },
        });
        let updated = apply_changes(DEFAULT_FILE, changes.as_object().unwrap()).unwrap();

        let config = Config::parse(&updated).unwrap();
        assert_eq!((config.height, config.slide_ms, config.theme.as_str(), config.font.size), (0.4, 0, "nord", 16.0));
        assert_eq!(config.keybindings["new_tab"], "ctrl+t");
        assert!(updated.contains("height = 0.4   # 0.1 - 1.0"), "trailing comment kept:
{updated}");
        assert!(updated.starts_with("# qterm settings."), "header kept");
        assert_eq!(updated.lines().count(), DEFAULT_FILE.lines().count() + 1, "only the new binding added a line");
    }

    #[test]
    fn editing_an_inline_table_keeps_it_inline() {
        let start = "[scrollback]\nrestore = true\nprofiles = {}\n";
        let changes = serde_json::json!({ "scrollback.profiles": { "cmd": false, "wsl:Ubuntu": true } });
        let updated = apply_changes(start, changes.as_object().unwrap()).unwrap();
        let config = Config::parse(&updated).unwrap();
        assert_eq!(config.scrollback.profiles.len(), 2);
        assert!(!config.scrollback.profiles["cmd"]);
        assert!(updated.contains("profiles = {"), "still inline:\n{updated}");
    }

    #[test]
    fn editing_replaces_the_whole_keybindings_table() {
        let start = "[keybindings]
new_tab = \"ctrl+t\"
find = \"f3\"
";
        let changes = serde_json::json!({ "keybindings": { "find": "ctrl+f" } });
        let config = Config::parse(&apply_changes(start, changes.as_object().unwrap()).unwrap()).unwrap();
        assert_eq!(config.keybindings.len(), 1);
        assert_eq!(config.keybindings["find"], "ctrl+f");
    }

    #[test]
    fn invalid_edits_are_refused_before_writing() {
        let dir = std::env::temp_dir().join(format!("qterm-config-update-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let state = ConfigState::load(&dir);
        let bad = serde_json::json!({ "hotkey": "ctrl+Backquote" });
        assert!(state.update(bad.as_object().unwrap()).unwrap_err().contains("single key"));
        assert_eq!(std::fs::read_to_string(state.path()).unwrap(), DEFAULT_FILE, "file untouched");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn load_writes_defaults_then_reload_tracks_edits() {
        let dir = std::env::temp_dir().join(format!("qterm-config-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let state = ConfigState::load(&dir);
        assert_eq!(state.get(), Config::default());
        assert!(state.path().exists());

        std::fs::write(state.path(), "height = 0.3").unwrap();
        assert!(matches!(state.reload(), Reload::Changed(old) if *old == Config::default()));
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
