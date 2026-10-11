//! Ctrl+click on "src/app.ts:42" in a terminal: resolve the path against the
//! pane's folder and open it at that line with the configured editor command.

use std::ffi::OsString;
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::Command;

/// Keeps a console window from flashing up for the editor's launcher (code.cmd).
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Absolute paths of the candidates that are existing files; `None` for the rest.
pub fn resolve_files(paths: &[String], cwd: Option<&str>) -> Vec<Option<String>> {
    paths
        .iter()
        .map(|path| {
            let candidate = Path::new(path);
            let full = if candidate.is_absolute() {
                candidate.to_path_buf()
            } else {
                Path::new(cwd?).join(candidate)
            };
            full.is_file().then(|| clean(&full))
        })
        .collect()
}

/// Opens `file` at `line`/`col` with `template`, e.g. `code --goto {file}:{line}:{col}`.
/// Falls back to the file's default app when the editor isn't installed.
pub fn open(template: &str, file: &str, line: Option<u32>, col: Option<u32>) -> Result<(), String> {
    let args = expand(template, file, line.unwrap_or(1), col.unwrap_or(1));
    let (program, rest) = args.split_first().ok_or("the editor setting is empty")?;
    let Some(program) = find_program(program) else {
        return opener::open(file);
    };
    Command::new(program)
        .args(rest)
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map(drop)
        .map_err(|e| format!("could not start the editor: {e}"))
}

/// Splits the template on whitespace and fills in the placeholders per argument,
/// so a path with spaces stays one argument.
fn expand(template: &str, file: &str, line: u32, col: u32) -> Vec<String> {
    template
        .split_whitespace()
        .map(|arg| {
            arg.replace("{file}", file)
                .replace("{line}", &line.to_string())
                .replace("{col}", &col.to_string())
        })
        .collect()
}

/// Like the shell: a path as given, else PATH × PATHEXT (finds `code.cmd`).
/// Rust's std escapes arguments correctly for .cmd files.
fn find_program(name: &str) -> Option<PathBuf> {
    let direct = Path::new(name);
    if direct.components().count() > 1 {
        return direct.is_file().then(|| direct.to_path_buf());
    }
    let extensions: Vec<OsString> = std::env::var_os("PATHEXT")
        .map(|exts| exts.to_string_lossy().split(';').filter(|e| !e.is_empty()).map(OsString::from).collect())
        .unwrap_or_else(|| vec![".EXE".into(), ".CMD".into(), ".BAT".into()]);
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path).find_map(|dir| {
        std::iter::once(OsString::new())
            .chain(extensions.iter().cloned())
            .map(|ext| {
                let mut file = OsString::from(name);
                file.push(ext);
                dir.join(file)
            })
            .find(|candidate| candidate.is_file() && candidate.extension().is_some())
    })
}

/// "C:\work\.\src\..\a.ts" → "C:\work\a.ts" without touching the file system.
fn clean(path: &Path) -> String {
    let mut out = PathBuf::new();
    for part in path.components() {
        match part {
            std::path::Component::CurDir => {}
            std::path::Component::ParentDir => {
                out.pop();
            }
            other => out.push(other),
        }
    }
    out.to_string_lossy().into_owned()
}

mod opener {
    /// The file's default app, as Explorer would open it.
    pub fn open(file: &str) -> Result<(), String> {
        std::process::Command::new("explorer.exe")
            .arg(file)
            .spawn()
            .map(drop)
            .map_err(|e| format!("could not open {file}: {e}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fills_in_placeholders_per_argument() {
        assert_eq!(
            expand("code --goto {file}:{line}:{col}", r"C:\my repo\a.ts", 42, 7),
            ["code", "--goto", r"C:\my repo\a.ts:42:7"]
        );
        assert_eq!(expand("notepad++ -n{line} {file}", "x.txt", 3, 1), ["notepad++", "-n3", "x.txt"]);
    }

    #[test]
    fn resolves_relative_paths_against_the_pane_folder_and_skips_missing_files() {
        let windows = std::env::var("SystemRoot").unwrap();
        let found = resolve_files(
            &[r"System32\..\win.ini".into(), "nope.txt".into(), format!(r"{windows}\win.ini")],
            Some(&windows),
        );
        let expected = format!(r"{windows}\win.ini");
        assert_eq!(found, [Some(expected.clone()), None, Some(expected)]);
        assert_eq!(resolve_files(&["win.ini".into()], None), [None], "relative without a folder");
    }

    #[test]
    fn finds_programs_on_path_including_cmd_shims() {
        let cmd = find_program("cmd").unwrap().to_string_lossy().to_lowercase();
        assert!(cmd.ends_with(r"\cmd.exe"), "{cmd}");
        assert!(find_program("definitely-not-installed-qterm").is_none());
    }
}
