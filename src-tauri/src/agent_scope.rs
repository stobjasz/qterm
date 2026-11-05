//! A grant's immutable environment and project boundary.
use crate::{repo_state, wsl_tasks};
use std::{collections::HashSet, path::PathBuf};
#[derive(Clone)]
pub(crate) enum Scope {
    Native(PathBuf),
    Linux(wsl_tasks::Project),
}
impl Scope {
    pub fn capture(cwd: &str, environment: &str) -> Result<Self, String> {
        match environment {
            "native" => Ok(Self::Native(repo_state::root(&repo_state::native_folder(
                cwd,
            )?)?)),
            value if value.starts_with("wsl:") => Ok(Self::Linux(
                wsl_tasks::Project::capture(&value[4..], cwd)?.0,
            )),
            _ => Err("Choose an explicit project environment".into()),
        }
    }
    pub fn project(&self) -> String {
        match self {
            Self::Native(path) => repo_state::display(path),
            Self::Linux(project) => project.path.clone(),
        }
    }
    pub fn environment(&self) -> String {
        match self {
            Self::Native(_) => "native".into(),
            Self::Linux(project) => project.environment(),
        }
    }
    pub fn validate(&self) -> Result<(), String> {
        match self {
            Self::Native(path) => {
                if repo_state::native_folder(&repo_state::display(path))? == *path {
                    Ok(())
                } else {
                    Err("Project folder changed".into())
                }
            }
            Self::Linux(project) => project.validate(),
        }
    }
    pub fn accepts(&self, environment: Option<&str>, kind: &str) -> bool {
        match self {
            Self::Native(_) => environment.is_none_or(|env| env == "native") && kind != "wsl",
            Self::Linux(project) => {
                environment == Some(project.environment().as_str()) && kind == "wsl"
            }
        }
    }
    pub fn paths(&self, paths: &[String]) -> Result<HashSet<String>, String> {
        match self {
            Self::Native(root) => Ok(paths
                .iter()
                .filter(|cwd| {
                    repo_state::native_folder(cwd).is_ok_and(|path| path.starts_with(root))
                })
                .cloned()
                .collect()),
            Self::Linux(project) => {
                let mut allowed = HashSet::new();
                for chunk in paths.chunks(256) {
                    for (path, inside) in chunk.iter().zip(project.scoped_paths(chunk)?) {
                        if inside {
                            allowed.insert(path.clone());
                        }
                    }
                }
                Ok(allowed)
            }
        }
    }
    pub fn same_project(&self, environment: &str, project: &str) -> bool {
        if environment != self.environment() {
            return false;
        }
        match self {
            Self::Native(path) => repo_state::native_folder(project).ok().as_ref() == Some(path),
            Self::Linux(root) => project == root.path,
        }
    }
}
