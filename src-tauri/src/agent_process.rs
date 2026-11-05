//! Per-session process evidence. Unknown/error is distinct from observed absence.
use crate::{pty::SessionId, wsl_owner::Control};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

pub(crate) struct Target {
    pub id: SessionId,
    pub pid: Option<u32>,
    pub environment: String,
    pub owner: Option<Control>,
    pub ended: bool,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Observation {
    pub session: SessionId,
    pub environment: String,
    pub providers: Option<Vec<String>>,
    pub error: Option<String>,
    pub observed_at: u64,
    pub ended: bool,
}
#[derive(Deserialize)]
struct LinuxResult {
    providers: Option<Vec<String>>,
    error: Option<String>,
}
pub(crate) fn scan(targets: Vec<Target>) -> Vec<Observation> {
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(12);
    let native = targets
        .iter()
        .any(|target| target.environment == "native")
        .then(crate::procs::snapshot_result);
    let mut result: Vec<_> = targets
        .iter()
        .map(|target| Observation {
            session: target.id,
            environment: target.environment.clone(),
            providers: target.ended.then(Vec::new),
            error: (!target.ended).then(|| "Process context is unsupported or not ready".into()),
            observed_at: crate::repo_state::now(),
            ended: target.ended,
        })
        .collect();
    let mut groups: BTreeMap<String, Vec<(usize, String)>> = BTreeMap::new();
    for (index, target) in targets.iter().enumerate() {
        if target.ended {
            continue;
        }
        if let Some(owner) = &target.owner {
            groups
                .entry(owner.distribution.clone())
                .or_default()
                .push((index, owner.token.clone()));
        } else if target.environment == "native" {
            match &native {
                Some(Ok(processes)) => {
                    if let Some(pid) = target.pid {
                        result[index].providers = Some(
                            [("claude", "claude.exe"), ("codex", "codex.exe")]
                                .into_iter()
                                .filter(|(_, program)| {
                                    crate::procs::runs_below(processes, pid, program)
                                })
                                .map(|(provider, _)| provider.into())
                                .collect(),
                        );
                        result[index].error = None;
                    }
                }
                Some(Err(error)) => result[index].error = Some(error.clone()),
                None => {}
            }
        }
    }
    for (distribution, owners) in groups {
        for chunk in owners.chunks(4) {
            if std::time::Instant::now() >= deadline {
                for (index, _) in chunk {
                    result[*index].error =
                        Some("Linux process scan deferred by its time budget".into());
                }
                continue;
            }
            let response=crate::wsl::call(&distribution,serde_json::json!({"method":"owner_presence","tokens":chunk.iter().map(|(_,token)|token).collect::<Vec<_>>()})).and_then(|value|serde_json::from_value::<Vec<LinuxResult>>(value).map_err(|error|error.to_string()));
            match response {
                Ok(values) if values.len() == chunk.len() => {
                    for ((index, _), value) in chunk.iter().zip(values) {
                        let valid = value.providers.as_ref().is_some_and(|providers| {
                            providers.len() <= 2
                                && providers
                                    .iter()
                                    .all(|p| matches!(p.as_str(), "claude" | "codex"))
                        });
                        result[*index].providers = if valid && value.error.is_none() {
                            value.providers
                        } else {
                            None
                        };
                        result[*index].error = if valid && value.error.is_none() {
                            None
                        } else {
                            Some(
                                value
                                    .error
                                    .unwrap_or_else(|| "Invalid Linux process response".into()),
                            )
                        };
                        result[*index].observed_at = crate::repo_state::now();
                    }
                }
                other => {
                    let error = other
                        .err()
                        .unwrap_or_else(|| "Linux process response count changed".into());
                    for (index, _) in chunk {
                        result[*index].error = Some(error.clone());
                    }
                }
            }
        }
    }
    result
}
