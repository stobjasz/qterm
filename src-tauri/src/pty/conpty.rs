//! The newer ConPTY (conpty.dll + OpenConsole.exe from Microsoft's NuGet package),
//! embedded in the exe so a single-file build gets it too.
//!
//! portable-pty loads "conpty.dll" by bare name on first use and falls back to the
//! ConPTY in kernel32. We extract the embedded files to a per-version folder and
//! preload the DLL by full path: Windows then hands that already-loaded module to
//! the bare-name load. conpty.dll starts the OpenConsole.exe that sits beside it.

use std::path::{Path, PathBuf};

/// Which ConPTY the sessions will use, for logs and diagnostics.
#[derive(Debug)]
pub enum Host {
    Bundled { version: &'static str, dir: PathBuf },
    Inbox { reason: String },
}

/// Must run before the first PTY is opened. Never fails hard: on any problem the
/// sessions use the ConPTY built into Windows.
pub fn install(cache_dir: &Path) -> Host {
    match bundled::install(cache_dir) {
        Ok(host) => host,
        Err(reason) => Host::Inbox { reason },
    }
}

#[cfg(bundled_conpty)]
mod bundled {
    use super::*;

    const VERSION: &str = env!("QTERM_CONPTY_VERSION");
    const FILES: [(&str, &[u8]); 2] = [
        ("conpty.dll", include_bytes!(concat!(env!("QTERM_CONPTY_DIR"), "/conpty.dll"))),
        ("OpenConsole.exe", include_bytes!(concat!(env!("QTERM_CONPTY_DIR"), "/OpenConsole.exe"))),
    ];

    pub fn install(cache_dir: &Path) -> Result<Host, String> {
        let dir = cache_dir.join("conpty").join(VERSION);
        std::fs::create_dir_all(&dir).map_err(|e| format!("could not create {}: {e}", dir.display()))?;
        for (name, bytes) in FILES {
            write_if_different(&dir.join(name), bytes)?;
        }
        preload(&dir.join("conpty.dll"))?;
        Ok(Host::Bundled { version: VERSION, dir })
    }

    /// Rewrites the file when it is missing or differs from the embedded copy, so a
    /// damaged or tampered extraction is replaced rather than loaded.
    pub(super) fn write_if_different(path: &Path, bytes: &[u8]) -> Result<(), String> {
        if std::fs::read(path).is_ok_and(|current| current == bytes) {
            return Ok(());
        }
        // Write beside it and rename, so a crash never leaves a half-written DLL.
        let partial = path.with_extension("partial");
        std::fs::write(&partial, bytes)
            .and_then(|()| std::fs::rename(&partial, path))
            .map_err(|e| format!("could not write {}: {e}", path.display()))
    }

    fn preload(dll: &Path) -> Result<(), String> {
        use std::os::windows::ffi::OsStrExt;

        #[link(name = "kernel32")]
        unsafe extern "system" {
            fn LoadLibraryW(name: *const u16) -> *mut core::ffi::c_void;
        }

        let wide: Vec<u16> = dll.as_os_str().encode_wide().chain(Some(0)).collect();
        // SAFETY: `wide` is a NUL-terminated UTF-16 path that outlives the call. The
        // module stays loaded for the life of the process, which is what we want.
        let module = unsafe { LoadLibraryW(wide.as_ptr()) };
        if module.is_null() {
            return Err(format!("could not load {}: {}", dll.display(), std::io::Error::last_os_error()));
        }
        Ok(())
    }
}

#[cfg(not(bundled_conpty))]
mod bundled {
    use super::*;

    pub fn install(_cache_dir: &Path) -> Result<Host, String> {
        Err("not bundled in this build (run scripts/fetch-conpty.ps1 before building)".into())
    }
}

#[cfg(all(test, bundled_conpty))]
mod tests {
    use super::*;

    #[test]
    fn extraction_replaces_damaged_files_and_is_idempotent() {
        let dir = std::env::temp_dir().join(format!("qterm-conpty-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("OpenConsole.exe");

        bundled::write_if_different(&file, b"embedded").unwrap();
        assert_eq!(std::fs::read(&file).unwrap(), b"embedded");

        std::fs::write(&file, b"tampered").unwrap();
        bundled::write_if_different(&file, b"embedded").unwrap();
        assert_eq!(std::fs::read(&file).unwrap(), b"embedded");

        bundled::write_if_different(&file, b"embedded").unwrap();
        assert!(!file.with_extension("partial").exists());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
