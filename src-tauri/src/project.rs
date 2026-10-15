//! A pane's project, found from the folder it is in: the scripts its manifests define
//! (package.json, Cargo.toml, Makefile, justfile, composer.json, pyproject.toml), its
//! git status, and its own qterm settings (`.qterm.toml`: tab name, colour and icon,
//! snippets and triggers for panes inside it).

use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::Command;

use serde::{Deserialize, Serialize};

use crate::config::{Snippet, Trigger, TAB_COLORS};

const CREATE_NO_WINDOW: u32 = 0x0800_0000;
/// The project settings file, in the project's folder or any folder above.
pub const SETTINGS_FILE: &str = ".qterm.toml";
/// More scripts than this are not something to pick from a list.
const MAX_TASKS: usize = 200;
/// Larger manifests and settings files aren't read.
const MAX_FILE: u64 = 1 << 20;

/// Everything qterm knows about the project a folder is in.
#[derive(Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectInfo {
    pub git: Option<GitStatus>,
    pub tasks: Option<Tasks>,
    pub settings: Option<ProjectSettingsFile>,
    /// Why the `.qterm.toml` found isn't used.
    pub settings_error: Option<String>,
}

/// For a folder that exists; anything else (a WSL path, a removed folder) knows nothing.
pub fn info(cwd: &Path) -> ProjectInfo {
    if !cwd.is_dir() {
        return ProjectInfo::default();
    }
    let (settings, settings_error) = match find_settings(cwd) {
        Some(Ok(file)) => (Some(file), None),
        Some(Err(e)) => (None, Some(e)),
        None => (None, None),
    };
    ProjectInfo { git: git_status(cwd), tasks: tasks(cwd), settings, settings_error }
}

// --- scripts ---------------------------------------------------------------------------

/// A script to run, e.g. `pnpm run dev` from package.json.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub name: String,
    pub command: String,
    /// The file it comes from ("package.json").
    pub source: String,
}

/// The scripts of the nearest folder (from `cwd` up to the repository's root) that has any.
#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Tasks {
    /// Where they run.
    pub dir: String,
    pub tasks: Vec<Task>,
}

pub fn tasks(cwd: &Path) -> Option<Tasks> {
    for dir in cwd.ancestors() {
        let mut found = tasks_in(dir);
        if !found.is_empty() {
            found.truncate(MAX_TASKS);
            return Some(Tasks { dir: dir.to_string_lossy().into_owned(), tasks: found });
        }
        if dir.join(".git").exists() {
            break;
        }
    }
    None
}

/// The scripts defined by the manifests in `dir` itself.
fn tasks_in(dir: &Path) -> Vec<Task> {
    let mut tasks = Vec::new();
    let mut add = |source: &str, names: Vec<String>, command: &dyn Fn(&str) -> String| {
        for name in names {
            if !tasks.iter().any(|t: &Task| t.source == source && t.name == name) {
                tasks.push(Task { command: command(&name), name, source: source.to_string() });
            }
        }
    };
    if let Some(json) = read_json(&dir.join("package.json")) {
        let pm = package_manager(dir, &json);
        add("package.json", object_keys(&json, "/scripts"), &|name| format!("{pm} run {name}"));
    }
    if dir.join("Cargo.toml").is_file() {
        let names = ["build", "check", "test", "run", "clippy"].map(String::from).to_vec();
        add("Cargo.toml", names, &|name| format!("cargo {name}"));
    }
    if let Some((file, text)) = ["Makefile", "makefile", "GNUmakefile"].iter().find_map(|f| Some((*f, read_text(&dir.join(f))?))) {
        add(file, make_targets(&text), &|name| format!("make {name}"));
    }
    if let Some((file, text)) = ["justfile", "Justfile", ".justfile"].iter().find_map(|f| Some((*f, read_text(&dir.join(f))?))) {
        add(file, just_recipes(&text), &|name| format!("just {name}"));
    }
    if let Some(json) = read_json(&dir.join("composer.json")) {
        add("composer.json", object_keys(&json, "/scripts"), &|name| format!("composer run-script {name}"));
    }
    if let Some(toml) = read_text(&dir.join("pyproject.toml")).and_then(|t| t.parse::<toml::Table>().ok()) {
        let keys = |path: &[&str]| -> Vec<String> {
            let mut value: Option<&toml::Value> = None;
            for (i, key) in path.iter().enumerate() {
                value = if i == 0 { toml.get(*key) } else { value.and_then(|v| v.get(*key)) };
            }
            value.and_then(toml::Value::as_table).map(|t| t.keys().filter(|k| !k.starts_with('_')).cloned().collect()).unwrap_or_default()
        };
        add("pyproject.toml", keys(&["tool", "poe", "tasks"]), &|name| format!("poe {name}"));
        add("pyproject.toml", keys(&["tool", "pdm", "scripts"]), &|name| format!("pdm run {name}"));
        add("pyproject.toml", keys(&["tool", "hatch", "envs", "default", "scripts"]), &|name| format!("hatch run {name}"));
        // Entry points: run through the project's environment.
        let runner = if dir.join("uv.lock").is_file() {
            "uv run "
        } else if dir.join("poetry.lock").is_file() || toml.get("tool").and_then(|t| t.get("poetry")).is_some() {
            "poetry run "
        } else {
            ""
        };
        let mut entry_points = keys(&["project", "scripts"]);
        entry_points.extend(keys(&["tool", "poetry", "scripts"]));
        add("pyproject.toml", entry_points, &|name| format!("{runner}{name}"));
    }
    tasks
}

/// pnpm, yarn or bun when the project says so (`packageManager`, or its lockfile
/// here or in a folder above, up to the repository's root), else npm.
fn package_manager(dir: &Path, package: &serde_json::Value) -> &'static str {
    const KNOWN: [(&str, &str); 4] = [("pnpm", "pnpm-lock.yaml"), ("yarn", "yarn.lock"), ("bun", "bun.lock"), ("npm", "package-lock.json")];
    if let Some(declared) = package.get("packageManager").and_then(|v| v.as_str())
        && let Some((pm, _)) = KNOWN.iter().find(|(pm, _)| declared.starts_with(&format!("{pm}@")))
    {
        return pm;
    }
    for folder in dir.ancestors() {
        if let Some((pm, _)) = KNOWN.iter().find(|(_, lock)| folder.join(lock).is_file()) {
            return pm;
        }
        if folder.join("bun.lockb").is_file() {
            return "bun";
        }
        if folder.join(".git").exists() {
            break;
        }
    }
    "npm"
}

/// A Makefile's explicit targets: not pattern rules, special targets or variables.
fn make_targets(text: &str) -> Vec<String> {
    let mut targets = Vec::new();
    for line in text.lines() {
        if line.starts_with(['\t', ' ', '#']) {
            continue;
        }
        let Some((names, rest)) = line.split_once(':') else { continue };
        // `x := 1` and `x ::= 1` assign; a `=` before the colon too.
        if rest.starts_with('=') || rest.starts_with(":=") || names.contains('=') {
            continue;
        }
        for name in names.split_whitespace() {
            let usable = !name.starts_with('.') && !name.contains(['%', '$', '(', ')']) && !targets.iter().any(|t| t == name);
            if usable {
                targets.push(name.to_string());
            }
        }
    }
    targets
}

/// A justfile's public recipes (a leading `_` makes one private).
fn just_recipes(text: &str) -> Vec<String> {
    const NOT_RECIPES: [&str; 6] = ["set ", "alias ", "import ", "mod ", "export ", "["];
    let mut recipes = Vec::new();
    for line in text.lines() {
        if line.starts_with([' ', '\t', '#']) || NOT_RECIPES.iter().any(|p| line.starts_with(p)) {
            continue;
        }
        let line = line.trim_start_matches('@');
        let end = line.find(|c: char| !(c.is_alphanumeric() || c == '_' || c == '-')).unwrap_or(line.len());
        let (name, rest) = line.split_at(end);
        let rest = rest.trim_start();
        // A recipe's name is followed by its parameters, then a colon; `name := value` is a variable.
        let recipe = !name.is_empty() && !rest.starts_with(":=") && (rest.starts_with(':') || rest.contains(':'));
        if recipe && !name.starts_with('_') && !recipes.iter().any(|r| r == name) {
            recipes.push(name.to_string());
        }
    }
    recipes
}

fn object_keys(json: &serde_json::Value, pointer: &str) -> Vec<String> {
    json.pointer(pointer).and_then(|v| v.as_object()).map(|o| o.keys().cloned().collect()).unwrap_or_default()
}

fn read_text(path: &Path) -> Option<String> {
    let meta = std::fs::metadata(path).ok()?;
    if !meta.is_file() || meta.len() > MAX_FILE {
        return None;
    }
    std::fs::read_to_string(path).ok()
}

fn read_json(path: &Path) -> Option<serde_json::Value> {
    serde_json::from_str(&read_text(path)?).ok()
}

// --- git -------------------------------------------------------------------------------

#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatus {
    /// The branch, or the commit (short) when detached.
    pub branch: String,
    /// Commits ahead of and behind its upstream; None without one.
    pub ahead: Option<u32>,
    pub behind: Option<u32>,
    /// Files with changes (staged or not, conflicts included), and new files.
    pub changed: u32,
    pub untracked: u32,
}

/// The git status of the repository `cwd` is in; None outside one or without git.
pub fn git_status(cwd: &Path) -> Option<GitStatus> {
    // No repository above: no git process at all.
    cwd.ancestors().find(|dir| dir.join(".git").exists())?;
    let output = Command::new("git")
        .args(["--no-optional-locks", "status", "--porcelain=v2", "--branch"])
        .current_dir(cwd)
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .ok()?;
    output.status.success().then(|| parse_status(&String::from_utf8_lossy(&output.stdout)))
}

/// `git status --porcelain=v2 --branch` output, read.
fn parse_status(text: &str) -> GitStatus {
    let mut status = GitStatus::default();
    let mut oid = "";
    for line in text.lines() {
        if let Some(head) = line.strip_prefix("# branch.head ") {
            status.branch = head.to_string();
        } else if let Some(commit) = line.strip_prefix("# branch.oid ") {
            oid = commit;
        } else if let Some(ab) = line.strip_prefix("# branch.ab ") {
            let mut counts = ab.split_whitespace().map(|n| n.trim_start_matches(['+', '-']).parse().ok());
            status.ahead = counts.next().flatten();
            status.behind = counts.next().flatten();
        } else if line.starts_with("1 ") || line.starts_with("2 ") || line.starts_with("u ") {
            status.changed += 1;
        } else if line.starts_with("? ") {
            status.untracked += 1;
        }
    }
    if status.branch == "(detached)" {
        status.branch = oid.chars().take(7).collect();
    }
    status
}

// --- .qterm.toml -------------------------------------------------------------------------

/// What a project's `.qterm.toml` may say.
#[derive(Clone, Debug, Default, PartialEq, Deserialize, Serialize)]
#[serde(default, deny_unknown_fields, rename_all(deserialize = "snake_case", serialize = "camelCase"))]
pub struct ProjectSettings {
    /// Names tabs whose pane is in the project (a name you give a tab wins).
    pub name: Option<String>,
    pub tab_color: Option<String>,
    pub icon: Option<String>,
    /// Added to the palette's snippets in panes inside the project.
    pub snippets: Vec<Snippet>,
    /// Watch panes inside the project, next to the triggers in the settings.
    pub triggers: Vec<Trigger>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSettingsFile {
    pub path: String,
    #[serde(flatten)]
    pub settings: ProjectSettings,
}

/// The nearest `.qterm.toml` at or above `cwd`, read and checked.
pub fn find_settings(cwd: &Path) -> Option<Result<ProjectSettingsFile, String>> {
    let path: PathBuf = cwd.ancestors().map(|dir| dir.join(SETTINGS_FILE)).find(|p| p.is_file())?;
    let shown = path.to_string_lossy().into_owned();
    Some(
        read_text(&path)
            .ok_or_else(|| format!("{shown}: could not read it"))
            .and_then(|text| parse_settings(&text).map_err(|e| format!("{shown}: {e}")))
            .map(|settings| ProjectSettingsFile { path: shown, settings }),
    )
}

pub(crate) fn parse_settings(text: &str) -> Result<ProjectSettings, String> {
    let settings: ProjectSettings = toml::from_str(text).map_err(|e| e.to_string().trim().to_string())?;
    if let Some(color) = settings.tab_color.as_deref().filter(|c| !TAB_COLORS.contains(c)) {
        return Err(format!("tab_color \"{color}\" is not one of {}", TAB_COLORS.join(", ")));
    }
    if settings.icon.as_ref().is_some_and(|icon| icon.chars().count() > 4) {
        return Err("icon is longer than 4 characters".into());
    }
    if settings.name.as_ref().is_some_and(|name| name.chars().count() > 80) {
        return Err("name is longer than 80 characters".into());
    }
    crate::config::check_triggers(&settings.triggers)?;
    Ok(settings)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn folder(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("qterm-project-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn package_scripts_run_with_the_projects_package_manager() {
        let root = folder("npm");
        std::fs::create_dir(root.join(".git")).unwrap();
        std::fs::write(root.join("pnpm-lock.yaml"), "").unwrap();
        let app = root.join("packages").join("app");
        std::fs::create_dir_all(app.join("src")).unwrap();
        std::fs::write(app.join("package.json"), r#"{"scripts":{"dev":"vite","build:prod":"vite build"}}"#).unwrap();

        // From a folder inside the package: its scripts, run in the package's folder.
        let found = tasks(&app.join("src")).unwrap();
        assert_eq!(found.dir, app.to_string_lossy());
        let commands: Vec<&str> = found.tasks.iter().map(|t| t.command.as_str()).collect();
        assert_eq!(commands, ["pnpm run dev", "pnpm run build:prod"], "the lockfile at the root decides");

        // `packageManager` wins over lockfiles.
        std::fs::write(app.join("package.json"), r#"{"packageManager":"yarn@4.1.0","scripts":{"dev":"vite"}}"#).unwrap();
        assert_eq!(tasks(&app).unwrap().tasks[0].command, "yarn run dev");
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn stops_at_the_repository_root() {
        let root = folder("stop");
        std::fs::write(root.join("Makefile"), "build:\n\tcc x.c\n").unwrap();
        let repo = root.join("repo");
        std::fs::create_dir_all(repo.join(".git")).unwrap();
        assert_eq!(tasks(&repo), None, "a Makefile above the repository isn't its own");
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn reads_make_targets_but_not_variables_or_special_targets() {
        let text = ".PHONY: all test\nCC := gcc\nFLAGS = -O2\nall: build test\n\t$(CC) x\nbuild test: deps\n%.o: %.c\n# lint:\ninstall::\n";
        assert_eq!(make_targets(text), ["all", "build", "test", "install"]);
    }

    #[test]
    fn reads_public_just_recipes() {
        let text = "set shell := [\"pwsh\", \"-c\"]\nversion := \"1\"\n# build it\nbuild target='debug':\n    cargo build\n@test: build\n_private:\n[private]\nalias b := build\nserve port=\"8080\" : build\n";
        assert_eq!(just_recipes(text), ["build", "test", "serve"]);
    }

    #[test]
    fn reads_pyproject_cargo_and_composer() {
        let dir = folder("py");
        std::fs::write(dir.join("uv.lock"), "").unwrap();
        std::fs::write(
            dir.join("pyproject.toml"),
            "[project.scripts]\nserve = \"app:main\"\n[tool.poe.tasks]\nlint = \"ruff check\"\n[tool.pdm.scripts]\n_ = 1\nfmt = \"black .\"\n",
        )
        .unwrap();
        std::fs::write(dir.join("Cargo.toml"), "[package]\nname = \"x\"\n").unwrap();
        std::fs::write(dir.join("composer.json"), r#"{"scripts":{"test":"phpunit"}}"#).unwrap();
        let commands: Vec<String> = tasks_in(&dir).into_iter().map(|t| format!("{}: {}", t.source, t.command)).collect();
        assert_eq!(
            commands,
            [
                "Cargo.toml: cargo build",
                "Cargo.toml: cargo check",
                "Cargo.toml: cargo test",
                "Cargo.toml: cargo run",
                "Cargo.toml: cargo clippy",
                "composer.json: composer run-script test",
                "pyproject.toml: poe lint",
                "pyproject.toml: pdm run fmt",
                "pyproject.toml: uv run serve",
            ]
        );
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn reads_git_status() {
        let text = "# branch.oid 1234567890abcdef\n# branch.head main\n# branch.upstream origin/main\n# branch.ab +2 -1\n1 .M N... 100644 100644 100644 a b src/a.ts\n2 R. N... 100644 100644 100644 a b R100 new.ts\told.ts\nu UU N... 1 2 3 4 a b c x.ts\n? notes.txt\n";
        assert_eq!(parse_status(text), GitStatus { branch: "main".into(), ahead: Some(2), behind: Some(1), changed: 3, untracked: 1 });
        let detached = parse_status("# branch.oid 1234567890abcdef\n# branch.head (detached)\n");
        assert_eq!(detached, GitStatus { branch: "1234567".into(), ..GitStatus::default() });
    }

    #[test]
    fn this_repository_has_a_git_status() {
        let status = git_status(Path::new(env!("CARGO_MANIFEST_DIR"))).expect("qterm's own repository");
        assert!(!status.branch.is_empty());
        assert_eq!(git_status(&std::env::temp_dir().join("qterm-no-such-folder")), None);
    }

    #[test]
    fn finds_and_checks_the_project_settings() {
        let root = folder("settings");
        let inner = root.join("src").join("deep");
        std::fs::create_dir_all(&inner).unwrap();
        std::fs::write(
            root.join(SETTINGS_FILE),
            "name = \"Web shop\"\ntab_color = \"green\"\nicon = \"🛒\"\n[[snippets]]\nname = \"Seed\"\ncommand = \"npm run seed\"\n[[triggers]]\npattern = \"error TS\"\naction = \"highlight\"\n",
        )
        .unwrap();
        let file = find_settings(&inner).unwrap().unwrap();
        assert_eq!(file.settings.name.as_deref(), Some("Web shop"));
        assert_eq!(file.settings.snippets[0].command, "npm run seed");
        assert_eq!(file.settings.triggers.len(), 1);

        std::fs::write(root.join(SETTINGS_FILE), "tab_color = \"mauve\"\n").unwrap();
        assert!(find_settings(&inner).unwrap().unwrap_err().contains("tab_color \"mauve\""));
        std::fs::write(root.join(SETTINGS_FILE), "colour = \"green\"\n").unwrap();
        assert!(find_settings(&inner).unwrap().unwrap_err().contains("unknown field"));
        let _ = std::fs::remove_dir_all(root);
    }
}
