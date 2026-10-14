//! "What's new" after an update: the version that ran last is kept in the config
//! folder (`last-version`); a start with a newer version reports the change once, and
//! the UI shows that release's notes.

use serde::Serialize;
use tauri::{AppHandle, Manager};

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct VersionChange {
    pub from: String,
    pub to: String,
}

/// Records this version as the last one run; the change if it is newer than the one
/// before. None on a first start, or when an older copy runs (portable and installed
/// side by side).
pub fn take_change(app: &AppHandle) -> Option<VersionChange> {
    let path = app.path().app_config_dir().ok()?.join("last-version");
    let current = app.package_info().version.to_string();
    let previous = std::fs::read_to_string(&path).ok().map(|s| s.trim().to_string());
    if previous.as_deref() != Some(current.as_str()) {
        let _ = std::fs::create_dir_all(path.parent()?);
        let _ = std::fs::write(&path, &current);
    }
    let previous = previous?;
    newer(&current, &previous).then_some(VersionChange { from: previous, to: current })
}

/// "0.2.10" > "0.2.9": compared number by number; anything unreadable counts as 0.
fn newer(a: &str, b: &str) -> bool {
    let parts = |v: &str| -> Vec<u64> { v.split(['.', '-', '+']).take(3).map(|p| p.parse().unwrap_or(0)).collect() };
    parts(a) > parts(b)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compares_versions_by_number() {
        assert!(newer("0.2.1", "0.2.0"));
        assert!(newer("0.2.10", "0.2.9"));
        assert!(newer("1.0.0", "0.9.9"));
        assert!(!newer("0.2.0", "0.2.1"));
        assert!(!newer("0.2.1", "0.2.1"));
    }
}
