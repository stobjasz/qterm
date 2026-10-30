//! Local hook transport health. A successful probe verifies qterm's executable,
//! inbox and watcher only; it never establishes provider hook configuration/trust.
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    io::Write,
    process::{Command, Stdio},
    sync::{
        Mutex,
        atomic::{AtomicU64, Ordering},
        mpsc,
    },
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Provider {
    Claude,
    Codex,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReceivedEvent {
    pub event: String,
    pub pane_id: String,
    pub session_id: Option<String>,
    pub received_at: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeResult {
    pub checked_at: u64,
    pub success: bool,
    pub error: Option<String>,
}

#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderHealth {
    pub last_event: Option<ReceivedEvent>,
    pub last_probe: Option<ProbeResult>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub provider: Provider,
    pub home: Option<String>,
    pub executable: String,
    pub inbox: Option<String>,
    #[serde(flatten)]
    pub health: ProviderHealth,
}

type PendingProbes = HashMap<String, (Provider, mpsc::Sender<()>)>;
#[derive(Default)]
pub struct Health {
    providers: Mutex<HashMap<Provider, ProviderHealth>>,
    pending: Mutex<PendingProbes>,
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

impl Health {
    pub fn record(&self, provider: Provider, event: &str, pane: &str, session: Option<&str>) {
        self.providers
            .lock()
            .unwrap()
            .entry(provider)
            .or_default()
            .last_event = Some(ReceivedEvent {
            event: event.into(),
            pane_id: pane.into(),
            session_id: session.map(str::to_owned),
            received_at: now(),
        });
    }

    fn begin(&self, provider: Provider) -> Result<(String, mpsc::Receiver<()>), String> {
        static NEXT: AtomicU64 = AtomicU64::new(0);
        let mut pending = self.pending.lock().unwrap();
        if pending.values().any(|(p, _)| *p == provider) {
            return Err("A local delivery test is already running for this provider".into());
        }
        let nonce = format!(
            "{}-{}-{}",
            std::process::id(),
            now(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        );
        let (tx, rx) = mpsc::channel();
        pending.insert(nonce.clone(), (provider, tx));
        Ok((nonce, rx))
    }

    pub fn acknowledge(&self, provider: Provider, nonce: &str) {
        let mut pending = self.pending.lock().unwrap();
        if pending.get(nonce).is_some_and(|(p, _)| *p == provider)
            && let Some((_, tx)) = pending.remove(nonce)
        {
            let _ = tx.send(());
        }
    }

    fn finish(&self, provider: Provider, nonce: &str, result: Result<(), String>) {
        self.pending.lock().unwrap().remove(nonce);
        self.providers
            .lock()
            .unwrap()
            .entry(provider)
            .or_default()
            .last_probe = Some(ProbeResult {
            checked_at: now(),
            success: result.is_ok(),
            error: result.err(),
        });
    }

    pub fn snapshot(&self, app: &AppHandle, provider: Provider) -> Result<Snapshot, String> {
        let home = match provider {
            Provider::Claude => crate::claude::claude_home(),
            Provider::Codex => crate::codex::home(),
        };
        Ok(Snapshot {
            provider,
            home: home.map(|p| p.to_string_lossy().into_owned()),
            executable: std::env::current_exe()
                .map_err(|e| e.to_string())?
                .to_string_lossy()
                .into_owned(),
            inbox: crate::alerts::inbox_dir(app).map(|p| p.to_string_lossy().into_owned()),
            health: self
                .providers
                .lock()
                .unwrap()
                .get(&provider)
                .cloned()
                .unwrap_or_default(),
        })
    }
}

pub fn test_delivery(app: &AppHandle, provider: Provider) -> Result<Snapshot, String> {
    let health = app.state::<Health>();
    let (nonce, rx) = health.begin(provider)?;
    let result = run_probe(app, provider, &nonce, rx);
    health.finish(provider, &nonce, result);
    health.snapshot(app, provider)
}

fn run_probe(
    app: &AppHandle,
    provider: Provider,
    nonce: &str,
    rx: mpsc::Receiver<()>,
) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    let inbox = crate::alerts::inbox_dir(app).ok_or("qterm has no local inbox folder")?;
    let arg = match provider {
        Provider::Claude => crate::alerts::HOOK_ARG,
        Provider::Codex => crate::codex_hook::HOOK_ARG,
    };
    let mut child = Command::new(std::env::current_exe().map_err(|e| e.to_string())?)
        .arg(arg)
        .env(crate::alerts::PANE_ENV, "qterm-local-delivery-test")
        .env(crate::alerts::INBOX_ENV, inbox)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .creation_flags(0x08000000)
        .spawn()
        .map_err(|e| format!("Could not start qterm's hook executable: {e}"))?;
    let deadline = Instant::now() + Duration::from_secs(5);
    let input =
        serde_json::json!({ "hook_event_name": "QtermDeliveryProbe", "probe_nonce": nonce });
    let written = child
        .stdin
        .take()
        .ok_or("Hook stdin was not available".to_string())
        .and_then(|mut stdin| {
            stdin
                .write_all(input.to_string().as_bytes())
                .map_err(|e| format!("Could not send the local probe: {e}"))
        });
    if let Err(error) = written {
        let _ = child.kill();
        let _ = child.wait();
        return Err(error);
    }
    loop {
        match child.try_wait() {
            Ok(Some(status)) if status.success() => break,
            Ok(Some(status)) => return Err(format!("Hook executable exited with {status}")),
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!("Could not inspect hook process: {error}"));
            }
            Ok(None) if Instant::now() >= deadline => {
                let _ = child.kill();
                let _ = child.wait();
                return Err("Hook executable did not exit within five seconds".into());
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(20)),
        }
    }
    rx.recv_timeout(deadline.saturating_duration_since(Instant::now()))
        .map_err(|_| "The hook exited but its probe did not reach qterm's inbox watcher. Check access to the inbox folder and restart qterm.".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn probes_are_provider_scoped_bounded_and_do_not_replace_real_events() {
        let health = Health::default();
        health.record(
            Provider::Codex,
            "session-start",
            "pane-real",
            Some("session"),
        );
        let (nonce, rx) = health.begin(Provider::Codex).unwrap();
        assert!(health.begin(Provider::Codex).is_err());
        health.acknowledge(Provider::Claude, &nonce);
        health.acknowledge(Provider::Codex, "unknown");
        assert!(rx.try_recv().is_err());
        health.acknowledge(Provider::Codex, &nonce);
        rx.recv_timeout(Duration::from_millis(100)).unwrap();
        health.finish(Provider::Codex, &nonce, Ok(()));
        let providers = health.providers.lock().unwrap();
        let current = providers.get(&Provider::Codex).unwrap();
        assert_eq!(current.last_event.as_ref().unwrap().pane_id, "pane-real");
        assert!(current.last_probe.as_ref().unwrap().success);
    }
    #[test]
    fn failed_probes_are_reported_and_can_be_retried() {
        let health = Health::default();
        let (nonce, _) = health.begin(Provider::Claude).unwrap();
        health.finish(Provider::Claude, &nonce, Err("inbox unavailable".into()));
        let failed = health
            .providers
            .lock()
            .unwrap()
            .get(&Provider::Claude)
            .cloned()
            .unwrap();
        assert!(!failed.last_probe.unwrap().success);
        assert!(health.begin(Provider::Claude).is_ok());
    }
}
