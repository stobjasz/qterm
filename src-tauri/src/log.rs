//! qterm's log file: `%LOCALAPPDATA%\dev.qterm.app\logs\qterm.log`. What used to go
//! to a console only release builds don't have: setup problems, errors, panics, and
//! errors from the UI. Kept small: past 1 MB it moves to `qterm.log.1` and starts over.

use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

const MAX_BYTES: u64 = 1024 * 1024;

struct Log {
    path: Option<PathBuf>,
    file: Option<File>,
    /// Lines logged before the folder is known (very early in setup).
    early: Vec<String>,
}

static LOG: Mutex<Log> = Mutex::new(Log { path: None, file: None, early: Vec::new() });

/// Writes a line to the log (and to stderr, for `tauri dev`).
#[macro_export]
macro_rules! qlog {
    ($($arg:tt)*) => { $crate::log::write(&format!($($arg)*)) };
}

/// Opens the log in `dir` and writes what was logged before.
pub fn init(dir: &Path) {
    let path = dir.join("qterm.log");
    let _ = std::fs::create_dir_all(dir);
    if std::fs::metadata(&path).is_ok_and(|m| m.len() > MAX_BYTES) {
        let _ = std::fs::rename(&path, dir.join("qterm.log.1"));
    }
    let file = OpenOptions::new().create(true).append(true).open(&path).ok();
    let mut log = LOG.lock().unwrap_or_else(|e| e.into_inner());
    log.path = Some(path);
    log.file = file;
    let early = std::mem::take(&mut log.early);
    if let Some(file) = log.file.as_mut() {
        for line in early {
            let _ = file.write_all(line.as_bytes());
        }
    }
}

pub fn path() -> Option<PathBuf> {
    LOG.lock().unwrap_or_else(|e| e.into_inner()).path.clone()
}

pub fn write(message: &str) {
    eprintln!("qterm: {message}");
    let line = format!("{} {message}\n", timestamp());
    let mut log = LOG.lock().unwrap_or_else(|e| e.into_inner());
    let log = &mut *log;
    match (log.file.as_mut(), &log.path) {
        (Some(file), _) => {
            let _ = file.write_all(line.as_bytes());
        }
        (None, None) => log.early.push(line),
        (None, Some(_)) => {}
    }
}

/// Panics go to the log before the process ends (release builds abort on panic).
pub fn log_panics() {
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let at = info.location().map(|l| format!(" at {}:{}", l.file(), l.line())).unwrap_or_default();
        let what = info
            .payload()
            .downcast_ref::<&str>()
            .map(|s| s.to_string())
            .or_else(|| info.payload().downcast_ref::<String>().cloned())
            .unwrap_or_else(|| "unknown".into());
        write(&format!("PANIC{at}: {what}"));
        previous(info);
    }));
}

/// The last `lines` lines of the log, for "Copy diagnostics".
pub fn tail(lines: usize) -> String {
    let Some(path) = path() else { return String::new() };
    let text = std::fs::read_to_string(path).unwrap_or_default();
    let all: Vec<&str> = text.lines().collect();
    all[all.len().saturating_sub(lines)..].join("\n")
}

fn timestamp() -> String {
    use windows_sys::Win32::System::SystemInformation::GetLocalTime;
    // SAFETY: GetLocalTime fills the struct it is given.
    let t = unsafe {
        let mut t = std::mem::zeroed();
        GetLocalTime(&mut t);
        t
    };
    format!(
        "{:04}-{:02}-{:02} {:02}:{:02}:{:02}.{:03}",
        t.wYear, t.wMonth, t.wDay, t.wHour, t.wMinute, t.wSecond, t.wMilliseconds
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn timestamps_are_local_date_and_time() {
        let t = timestamp();
        assert_eq!(t.len(), "2026-10-14 09:05:01.123".len(), "{t}");
        assert_eq!(&t[4..5], "-");
        assert_eq!(&t[10..11], " ");
    }
}
