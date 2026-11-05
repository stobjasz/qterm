//! A separate Windows-owned lifetime for each recognized WSL pane.
//! No child inherits the file handle; Windows removes the name even after a crash.
use std::{fs::File, path::PathBuf};

pub(crate) const SCRIPT: &str = include_str!("wsl_owner.py");
pub(crate) struct Owner {
    _file: File,
    pub path: PathBuf,
    pub token: String,
    distribution: String,
}
impl Owner {
    pub fn new(distribution: &str) -> Result<Self, String> {
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
            distribution: distribution.into(),
        })
    }
    pub fn control(&self) -> Control {
        Control {
            distribution: self.distribution.clone(),
            token: self.token.clone(),
        }
    }
}

#[derive(Clone)]
pub(crate) struct Control {
    pub distribution: String,
    pub token: String,
}
impl Control {
    pub fn ensure_shell(&self)->Result<(),String>{
        match crate::wsl::call(&self.distribution,serde_json::json!({"method":"owner","token":self.token,"action":"can_stop"})).map_err(|error|format!("Could not stop Linux programs in {}: {error}",self.distribution))?{
            serde_json::Value::Bool(true)=>Ok(()),
            serde_json::Value::Bool(false)=>Err("This WSL profile is running a program directly, so there is no shell to keep. Interrupt it or close the pane explicitly.".into()),
            _=>Err("Could not verify whether this WSL profile has an interactive shell".into()),
        }
    }
    pub fn bootstrap(&self,launch:bool,active:impl Fn()->bool)->Result<(),String>{
        let deadline=std::time::Instant::now()+std::time::Duration::from_secs(8);
        loop{
            if !active(){return Err("The starting pane closed".into());}
            let result=crate::wsl::call(&self.distribution,serde_json::json!({"method":"owner","token":self.token,"action":if launch{"launch"}else{"ready"}}));
            match result{
                Ok(serde_json::Value::Bool(true))=>return Ok(()),
                Err(error) if !launch&&std::time::Instant::now()<deadline=>{let _=error;std::thread::sleep(std::time::Duration::from_millis(20));}
                other=>return Err(format!("Could not prepare owned WSL startup: {}",other.err().unwrap_or_else(||"Invalid bootstrap response".into()))),
            }
        }
    }

    pub fn request(&self, stop: bool) -> Result<Vec<String>, String> {
        let result = crate::wsl::call(
            &self.distribution,
            serde_json::json!({
                "method": "owner", "token": self.token,
                "action": if stop { "stop" } else { "programs" }
            }),
        )
        .map_err(|e| {
            format!(
                "Could not {} Linux programs in {}: {e}",
                if stop { "stop" } else { "inspect" },
                self.distribution
            )
        })?;
        let names: Vec<String> = serde_json::from_value(result)
            .map_err(|e| format!("Invalid Linux program response: {e}"))?;
        if names.len() > 4096
            || names
                .iter()
                .any(|name| name.len() > 1024 || name.chars().any(char::is_control))
        {
            return Err("Linux program response exceeded its bounds".into());
        }
        Ok(names)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn distinct_lifetimes_are_immutable_and_removed_independently_on_close() {
        let first = Owner::new("Ubuntu").unwrap();
        let second = Owner::new("Ubuntu").unwrap();
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
