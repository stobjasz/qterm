//! Hot reload: watch the config directory (editors often save by replacing the
//! file) and reload shortly after the last change settles.

use std::path::PathBuf;
use std::sync::mpsc;
use std::thread;
use std::time::Duration;

use notify::{RecommendedWatcher, RecursiveMode, Watcher};

/// Editors write in bursts (truncate, write, rename); wait for quiet before reloading.
const SETTLE: Duration = Duration::from_millis(150);

/// Calls `on_change` after the config file changes. Keep the returned watcher alive.
pub fn watch(file: PathBuf, on_change: impl Fn() + Send + 'static) -> notify::Result<RecommendedWatcher> {
    let (tx, rx) = mpsc::channel::<()>();
    let name = file.file_name().map(ToOwned::to_owned);
    let mut watcher = notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
        let Ok(event) = event else { return };
        if event.paths.iter().any(|p| p.file_name() == name.as_deref()) {
            let _ = tx.send(());
        }
    })?;
    let dir = file.parent().map(ToOwned::to_owned).unwrap_or_default();
    watcher.watch(&dir, RecursiveMode::NonRecursive)?;

    thread::spawn(move || {
        while rx.recv().is_ok() {
            while rx.recv_timeout(SETTLE).is_ok() {}
            on_change();
        }
    });
    Ok(watcher)
}
