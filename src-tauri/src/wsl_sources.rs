//! Explicit transcript sources. Scanner state never crosses provider/environment/home.
use crate::{
    config::Config,
    session_library::{Enabled, Provider, Scan, ScopedScan, SourceConfig},
};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};
enum Scanner {
    Claude(crate::claude::TranscriptIndex),
    Codex(crate::codex::Index),
}

type ScanKey = (Provider, String, String, String);
#[derive(Default)]
pub struct State {
    indices: Mutex<HashMap<ScanKey, Arc<Scanner>>>,
}
pub fn configs(config: &Config) -> Vec<SourceConfig> {
    let mut result = crate::session_library::native_sources();
    for source in &config.wsl_sources {
        for provider in [Provider::Claude, Provider::Codex] {
            let home = match provider {
                Provider::Claude => &source.claude_home,
                Provider::Codex => &source.codex_home,
            };
            result.push(SourceConfig {
                provider,
                environment: format!("wsl:{}", source.distribution.to_lowercase()),
                signature: serde_json::to_string(source).unwrap(),
                home: (!home.is_empty()).then(|| home.clone()),
                enabled: source.enabled,
            });
        }
    }
    result
}
pub fn enabled(config: &Config) -> Enabled {
    Enabled {
        claude: config.claude_sessions,
        codex: config.codex_sessions,
    }
}
pub fn authorization(
    config: &Config,
    identity: &crate::session_library::Identity,
) -> Result<String, String> {
    if !enabled(config).get(identity.provider) {
        return Err("Source provider history is disabled".into());
    }
    configs(config)
        .into_iter()
        .find(|source| {
            source.enabled
                && source.provider == identity.provider
                && source.environment == identity.environment
        })
        .map(|source| source.signature)
        .ok_or_else(|| "The transcript source is disabled or unavailable".into())
}
impl State {
    pub fn retain(&self, config: &Config) {
        let configs = configs(config);
        let enabled = enabled(config);
        self.indices
            .lock()
            .unwrap()
            .retain(|(provider, environment, signature, _), _| {
                enabled.get(*provider)
                    && configs.iter().any(|source| {
                        source.enabled
                            && source.provider == *provider
                            && source.environment == *environment
                            && source.signature == *signature
                    })
            });
    }
    pub fn scan(&self, config: &Config) -> Vec<ScopedScan> {
        self.retain(config);
        let mut scans = vec![];
        let enabled = enabled(config);
        for source in configs(config).into_iter().filter(|source| {
            source.environment.starts_with("wsl:") && source.enabled && enabled.get(source.provider)
        }) {
            let mut scan = Scan {
                provider: source.provider,
                home: source.home.clone(),
                sessions: vec![],
                errors: vec![],
            };
            let result = (|| -> Result<(), String> {
                let distro = source.environment.strip_prefix("wsl:").unwrap();
                let value = crate::wsl::call(
                    distro,
                    serde_json::json!({"method":"source_home","provider":match source.provider{Provider::Claude=>"claude",Provider::Codex=>"codex"},"override":source.home}),
                )?;
                let home = value["home"]
                    .as_str()
                    .ok_or("WSL returned no source home")?;
                scan.home = Some(home.into());
                let unc = crate::wsl::unc(distro, home)?;
                let key = (
                    source.provider,
                    source.environment.clone(),
                    source.signature.clone(),
                    home.to_owned(),
                );
                let mut indices = self.indices.lock().unwrap();
                indices.retain(|(provider, environment, _, previous), _| {
                    *provider != source.provider
                        || *environment != source.environment
                        || previous == home
                });
                let index = indices
                    .entry(key)
                    .or_insert_with(|| {
                        Arc::new(match source.provider {
                            Provider::Claude => Scanner::Claude(Default::default()),
                            Provider::Codex => Scanner::Codex(Default::default()),
                        })
                    })
                    .clone();
                drop(indices);
                match index.as_ref() {
                    Scanner::Claude(index) => {
                        let (sessions, errors) =
                            index.scan_with_diagnostics(std::path::Path::new(&unc));
                        scan.sessions = sessions;
                        scan.errors = errors;
                    }
                    Scanner::Codex(index) => {
                        let result = index.scan_with_diagnostics(std::path::Path::new(&unc));
                        scan.sessions = result.sessions;
                        scan.errors = result.diagnostics.errors;
                        if result.diagnostics.missing_sessions_folder {
                            scan.errors
                                .push("Codex sessions folder was not found".into());
                        }
                        if result.diagnostics.unrecognized_files > 0 {
                            scan.errors.push(format!(
                                "{} unrecognized Codex files",
                                result.diagnostics.unrecognized_files
                            ));
                        }
                    }
                }
                Ok(())
            })();
            if let Err(error) = result {
                scan.errors.push(error);
            }
            scans.push(ScopedScan {
                environment: source.environment,
                signature: source.signature,
                scan,
            });
        }
        scans
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn disabled_sources_and_disabled_provider_history_never_attempt_a_distro_scan() {
        let state = State::default();
        let mut config = Config::default();
        config.wsl_sources.push(crate::config::WslSource {
            distribution: "qterm-unit-unavailable".into(),
            enabled: true,
            claude_home: "/qterm-unit-absent/claude".into(),
            codex_home: "/qterm-unit-absent/codex".into(),
        });
        assert!(state.scan(&config).is_empty());
        config.claude_sessions = true;
        config.codex_sessions = true;
        config.wsl_sources[0].enabled = false;
        assert!(state.scan(&config).is_empty());
        assert!(state.indices.lock().unwrap().is_empty());
    }
}
