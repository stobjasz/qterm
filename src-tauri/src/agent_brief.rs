//! Explicitly reviewed agent briefs. Terminal output stays in a data file, never
//! in shell source or a CLI command line. No provider is invoked by this module.
use serde::Serialize;
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::Path,
    sync::atomic::{AtomicU64, Ordering},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

const MAX_BYTES: usize = 128 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Brief {
    pub path: String,
}

pub fn create(dir: &Path, text: &str) -> Result<Brief, String> {
    if text.trim().is_empty() || text.len() > MAX_BYTES {
        return Err("An agent brief must contain 1–131072 UTF-8 bytes".into());
    }
    fs::create_dir_all(dir).map_err(|e| format!("Could not create the agent brief folder: {e}"))?;
    // Only our plain files, never directories or symlinks. Cleanup is bounded and
    // opportunistic; opening a project alone never creates/deletes a brief.
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.take(512).flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if !name.starts_with("brief-")
                || !name.ends_with(".md")
                || !entry.file_type().is_ok_and(|t| t.is_file())
            {
                continue;
            }
            if entry
                .metadata()
                .ok()
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.elapsed().ok())
                .is_some_and(|age| age > Duration::from_secs(7 * 86400))
            {
                let _ = fs::remove_file(entry.path());
            }
        }
    }
    static NEXT: AtomicU64 = AtomicU64::new(0);
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let file = dir.join(format!(
        "brief-{nanos}-{}-{}.md",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    ));
    let mut handle = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&file)
        .map_err(|e| format!("Could not create agent brief: {e}"))?;
    if let Err(error) = handle.write_all(text.as_bytes()) {
        drop(handle);
        let _ = fs::remove_file(&file);
        return Err(format!("Could not write agent brief: {error}"));
    }
    Ok(Brief {
        path: file.to_string_lossy().into_owned(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn writes_exact_unicode_data_and_keeps_briefs_distinct() {
        let dir = std::env::temp_dir().join(format!("qterm-agent-brief-{}", std::process::id()));
        let text = "Request\n$(do-not-execute); `code` %PATH% & <script>\n你好 🦀";
        let first = create(&dir, text).unwrap();
        let second = create(&dir, text).unwrap();
        assert_ne!(first.path, second.path);
        assert_eq!(fs::read_to_string(&first.path).unwrap(), text);
        assert!(create(&dir, " ").is_err());
        assert!(create(&dir, &"🦀".repeat(MAX_BYTES / 4 + 1)).is_err());
        fs::remove_file(first.path).unwrap();
        fs::remove_file(second.path).unwrap();
        fs::remove_dir(dir).unwrap();
    }
}
