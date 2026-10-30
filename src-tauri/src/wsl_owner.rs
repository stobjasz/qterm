//! A separate Windows-owned lifetime for each recognized WSL pane.
//! No child inherits the file handle; Windows removes the name even after a crash.
use std::{fs::File, path::PathBuf};

pub(crate) const SCRIPT: &str = include_str!("wsl_owner.py");
pub(crate) struct Owner {
    _file: File,
    pub path: PathBuf,
    pub token: String,
}
impl Owner {
    pub fn new() -> Result<Self, String> {
        let token = crate::agent_pipe::random()?;
        let path = std::env::temp_dir().join(format!("qterm-lifetime-{token}.alive"));
        let file = crate::agent_pipe::owned_file(&path, token.as_bytes())?;
        // Resolve junctions before WSLENV converts the path using the distro's
        // actual mount configuration. No fixed /mnt/<drive> assumptions.
        let path = path.canonicalize().map_err(|e| e.to_string())?;
        Ok(Self {
            _file: file,
            path,
            token,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn distinct_lifetimes_are_immutable_and_removed_independently_on_close() {
        let first = Owner::new().unwrap();
        let second = Owner::new().unwrap();
        assert_ne!(first.path, second.path);
        assert_eq!(std::fs::read_to_string(&first.path).unwrap(), first.token);
        assert!(
            std::fs::OpenOptions::new()
                .write(true)
                .open(&first.path)
                .is_err()
        );
        let path = first.path.clone();
        drop(first);
        assert!(!path.exists());
        assert_eq!(std::fs::read_to_string(&second.path).unwrap(), second.token);
    }
}
