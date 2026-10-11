//! Pane output kept across restarts: one file per pane in the local data folder,
//! written by the UI (xterm's serialized buffer, colours included).

use std::path::PathBuf;

pub struct ScrollbackStore {
    dir: PathBuf,
}

impl ScrollbackStore {
    pub fn new(dir: PathBuf) -> Self {
        Self { dir }
    }

    pub fn save(&self, pane_id: &str, text: &str) -> Result<(), String> {
        crate::claude::write_atomically(&self.file(pane_id)?, text)
    }

    pub fn load(&self, pane_id: &str) -> Option<String> {
        std::fs::read_to_string(self.file(pane_id).ok()?).ok()
    }

    /// Deletes every saved buffer except those of `keep` (closed panes, shells
    /// switched off).
    pub fn prune(&self, keep: &[String]) {
        let Ok(entries) = std::fs::read_dir(&self.dir) else { return };
        for entry in entries.flatten() {
            let path = entry.path();
            let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or_default();
            if path.extension().is_some_and(|e| e == "txt") && !keep.iter().any(|k| k == stem) {
                let _ = std::fs::remove_file(&path);
            }
        }
    }

    /// Pane ids become file names, so only plain ids are accepted.
    fn file(&self, pane_id: &str) -> Result<PathBuf, String> {
        let plain = !pane_id.is_empty()
            && pane_id.len() <= 64
            && pane_id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_');
        if !plain {
            return Err(format!("not a pane id: {pane_id:?}"));
        }
        Ok(self.dir.join(format!("{pane_id}.txt")))
    }

    #[cfg(test)]
    fn dir(&self) -> &std::path::Path {
        &self.dir
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store(name: &str) -> ScrollbackStore {
        let dir = std::env::temp_dir().join(format!("qterm-scrollback-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        ScrollbackStore::new(dir)
    }

    #[test]
    fn saves_loads_and_prunes() {
        let s = store("cycle");
        s.save("pane-1a2b3c4d", "\x1b[32mhello\x1b[0m").unwrap();
        s.save("pane-ffff0000", "bye").unwrap();
        assert_eq!(s.load("pane-1a2b3c4d").as_deref(), Some("\x1b[32mhello\x1b[0m"));
        s.prune(&["pane-ffff0000".to_string()]);
        assert_eq!(s.load("pane-1a2b3c4d"), None);
        assert_eq!(s.load("pane-ffff0000").as_deref(), Some("bye"));
        let _ = std::fs::remove_dir_all(s.dir());
    }

    #[test]
    fn refuses_ids_that_are_paths() {
        let s = store("ids");
        for bad in ["../config", "a/b", "", "pane.txt"] {
            assert!(s.save(bad, "x").is_err(), "{bad}");
            assert_eq!(s.load(bad), None);
        }
    }
}
