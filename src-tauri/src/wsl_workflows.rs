//! Typed filesystem facts for explicitly reviewed Linux workflows.
use crate::wsl;
use serde::{Deserialize, Serialize};
use serde_json::json;

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Source {
    pub project: String,
    pub source: String,
    pub digest: String,
    #[serde(skip_serializing)]
    pub text: String,
    project_identity: [u64; 2],
    source_identity: [u64; 2],
}
#[derive(Clone, Deserialize, Serialize)]
pub(crate) struct Directory {
    pub relative: String,
    pub directory: String,
    identity: [u64; 2],
}
impl Source {
    pub fn read(distribution: &str, cwd: &str) -> Result<Self, String> {
        serde_json::from_value(wsl::call(
            distribution,
            json!({"method":"workflow_source","cwd":cwd}),
        )?)
        .map_err(|error| error.to_string())
    }
    pub fn directories(
        &self,
        distribution: &str,
        paths: &[String],
    ) -> Result<Vec<Directory>, String> {
        let result: Vec<Directory> = serde_json::from_value(wsl::call(
            distribution,
            json!({"method":"workflow_directories","source":self,"paths":paths}),
        )?)
        .map_err(|error| error.to_string())?;
        if result.len() != paths.len()
            || result
                .iter()
                .zip(paths)
                .any(|(dir, path)| &dir.relative != path)
        {
            return Err("Linux workflow directory response changed its requested steps".into());
        }
        Ok(result)
    }
    pub fn validate(&self, distribution: &str, directories: &[Directory]) -> Result<(), String> {
        let response = wsl::call(
            distribution,
            json!({"method":"workflow_validate","source":self,"directories":directories}),
        )?;
        if response.get("valid").and_then(serde_json::Value::as_bool) != Some(true) {
            return Err("Linux workflow validation returned no confirmation".into());
        }
        Ok(())
    }
}
