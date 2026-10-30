//! Durable, provider-neutral attention. Viewing is independent of resolution;
//! only resolved history is trimmed. Failed writes keep events in memory for retry.
use crate::agent_health::Provider;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    fs,
    io::Read,
    path::{Path, PathBuf},
    sync::{
        Mutex,
        atomic::{AtomicU64, Ordering},
    },
    time::{SystemTime, UNIX_EPOCH},
};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Approval,
    Permission,
    Input,
    Completed,
    Failure,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Event {
    pub id: String,
    pub provider: Provider,
    pub pane_id: String,
    pub session_id: Option<String>,
    pub cwd: Option<String>,
    pub kind: Kind,
    pub title: String,
    pub message: String,
    pub created_at: u64,
    pub updated_at: u64,
    pub viewed_at: Option<u64>,
    pub resolved_at: Option<u64>,
    pub resolution: Option<String>,
    pub repeats: u32,
    pub run_id: String,
}

#[derive(Serialize, Deserialize)]
struct Saved {
    version: u32,
    events: Vec<Event>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub revision: u64,
    pub run_id: String,
    pub events: Vec<Event>,
    pub error: Option<String>,
    pub recovery_required: bool,
    pub backup_path: Option<String>,
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Action {
    View,
    Resolve,
    Reopen,
    ClearResolved,
    Retry,
    ResetSaved,
}

struct Inner {
    events: Vec<Event>,
    revision: u64,
    load_error: Option<String>,
    write_error: Option<String>,
    backup_path: Option<String>,
}
pub struct Store {
    path: PathBuf,
    run_id: String,
    inner: Mutex<Inner>,
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
fn id() -> String {
    static NEXT: AtomicU64 = AtomicU64::new(0);
    format!(
        "{}-{}-{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    )
}
fn limited(text: &str, max: usize) -> String {
    text.chars().take(max).collect()
}

fn read(path: &Path) -> Result<Vec<Event>, String> {
    let file = match fs::File::open(path) {
        Ok(file) => file,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(format!("Could not read saved agent inbox: {e}")),
    };
    let mut bytes = Vec::new();
    file.take(32 * 1024 * 1024 + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| format!("Could not read saved agent inbox: {e}"))?;
    if bytes.len() > 32 * 1024 * 1024 {
        return Err("Saved agent inbox exceeds 32 MiB; it has been preserved for recovery".into());
    }
    let saved: Saved = serde_json::from_slice(&bytes)
        .map_err(|e| format!("Could not read saved agent inbox: {e}"))?;
    if saved.version != 1 && saved.version != 2 {
        return Err(format!(
            "Unsupported saved agent inbox version {}",
            saved.version
        ));
    }
    let mut unique = HashSet::new();
    for e in &saved.events {
        if e.id.is_empty()
            || e.id.len() > 128
            || !unique.insert(&e.id)
            || e.message.chars().count() > 4000
            || e.title.chars().count() > 256
            || e.cwd.as_ref().is_some_and(|p| p.chars().count() > 4096)
        {
            return Err(
                "Saved agent inbox contains invalid event data; the original file was preserved"
                    .into(),
            );
        }
    }
    let mut events = saved.events;
    if saved.version == 1 {
        for event in &mut events {
            if event.provider == Provider::Codex && event.kind == Kind::Permission {
                event.kind = Kind::Approval;
                event.title = "Codex approval check".into();
                event.message = "An older qterm recorded an approval-routing hook as a question. A user-facing prompt was not confirmed.".into();
                event.resolved_at = Some(now());
                event.resolution = Some(
                    "Informational approval check; no permission decision was made by qterm."
                        .into(),
                );
            }
        }
    }
    Ok(events)
}

impl Store {
    pub fn load(path: PathBuf) -> Self {
        let (events, load_error) = match read(&path) {
            Ok(events) => (events, None),
            Err(error) => (Vec::new(), Some(error)),
        };
        Self {
            path,
            run_id: id(),
            inner: Mutex::new(Inner {
                events,
                revision: 0,
                load_error,
                write_error: None,
                backup_path: None,
            }),
        }
    }

    fn snapshot_of(&self, inner: &Inner) -> Snapshot {
        Snapshot {
            revision: inner.revision,
            run_id: self.run_id.clone(),
            events: inner.events.clone(),
            error: inner
                .load_error
                .clone()
                .or_else(|| inner.write_error.clone()),
            recovery_required: inner.load_error.is_some(),
            backup_path: inner.backup_path.clone(),
        }
    }
    pub fn snapshot(&self) -> Snapshot {
        self.snapshot_of(&self.inner.lock().unwrap())
    }

    fn persist(&self, inner: &mut Inner) {
        inner.revision += 1;
        if inner.load_error.is_some() {
            return;
        }
        // Keep every unresolved event, plus the newest 200 resolved events.
        inner
            .events
            .sort_by_key(|e| std::cmp::Reverse(e.created_at));
        let mut resolved = 0;
        inner.events.retain(|e| {
            if e.resolved_at.is_none() {
                true
            } else {
                resolved += 1;
                resolved <= 200
            }
        });
        let text = serde_json::to_string(&Saved {
            version: 2,
            events: inner.events.clone(),
        });
        inner.write_error = text
            .map_err(|e| e.to_string())
            .and_then(|s| crate::claude::write_atomically(&self.path, &s))
            .err();
    }

    #[allow(clippy::too_many_arguments)] // The normalized hook's event fields.
    pub fn record(
        &self,
        provider: Provider,
        pane: &str,
        session: Option<&str>,
        cwd: Option<&str>,
        kind: Kind,
        title: &str,
        message: &str,
    ) -> Snapshot {
        let mut inner = self.inner.lock().unwrap();
        let message = limited(message, 4000);
        let duplicate = if matches!(kind, Kind::Permission | Kind::Input) {
            inner.events.iter_mut().find(|e| {
                e.resolved_at.is_none()
                    && e.provider == provider
                    && e.run_id == self.run_id
                    && e.pane_id == pane
                    && e.session_id.as_deref() == session
                    && e.kind == kind
                    && e.message == message
            })
        } else {
            None
        };
        if let Some(existing) = duplicate {
            existing.updated_at = now();
            existing.repeats = existing.repeats.saturating_add(1);
        } else {
            let at = now();
            inner.events.push(Event {
                id: id(),
                provider,
                pane_id: limited(pane, 128),
                session_id: session.map(|s| limited(s, 256)),
                cwd: cwd.map(|s| limited(s, 4096)),
                kind,
                title: limited(title, 256),
                message,
                created_at: at,
                updated_at: at,
                viewed_at: None,
                resolved_at: (kind == Kind::Approval).then_some(at),
                resolution: (kind == Kind::Approval).then(|| "Informational approval check; no user prompt was confirmed and qterm made no permission decision.".into()),
                repeats: 1,
                run_id: self.run_id.clone(),
            });
        }
        self.persist(&mut inner);
        self.snapshot_of(&inner)
    }

    /// Working/completed events settle an outstanding request, not unread replies
    /// or failures. A different session/provider in the same pane cannot settle it.
    pub fn continued(
        &self,
        provider: Provider,
        pane: &str,
        session: Option<&str>,
    ) -> Option<Snapshot> {
        let mut inner = self.inner.lock().unwrap();
        let mut changed = false;
        for e in &mut inner.events {
            if e.resolved_at.is_none()
                && e.provider == provider
                && e.pane_id == pane
                && e.session_id.as_deref() == session
                && matches!(e.kind, Kind::Permission | Kind::Input)
            {
                e.resolved_at = Some(now());
                e.resolution = Some("Superseded by a later provider event".into());
                changed = true;
            }
        }
        if !changed {
            return None;
        }
        self.persist(&mut inner);
        Some(self.snapshot_of(&inner))
    }

    pub fn act(&self, action: Action, ids: &[String]) -> Result<Snapshot, String> {
        if ids.len() > 256 || ids.iter().any(|id| id.len() > 128) {
            return Err("Expected at most 256 inbox event IDs".into());
        }
        let mut inner = self.inner.lock().unwrap();
        let at = now();
        match action {
            Action::View | Action::Resolve | Action::Reopen => {
                for e in &mut inner.events {
                    if ids.contains(&e.id) {
                        match action {
                            Action::View => {
                                e.viewed_at.get_or_insert(at);
                            }
                            Action::Resolve => {
                                e.resolved_at = Some(at);
                                e.resolution = Some("Resolved by you".into());
                            }
                            Action::Reopen if e.kind != Kind::Approval => {
                                e.resolved_at = None;
                                e.resolution = None;
                            }
                            Action::Reopen => {}
                            _ => unreachable!(),
                        }
                    }
                }
            }
            Action::ClearResolved => inner.events.retain(|e| e.resolved_at.is_none()),
            Action::Retry if inner.load_error.is_some() => match read(&self.path) {
                Ok(mut saved) => {
                    let pending: HashSet<_> = inner.events.iter().map(|e| e.id.clone()).collect();
                    saved.retain(|e| !pending.contains(&e.id));
                    saved.extend(inner.events.clone());
                    inner.events = saved;
                    inner.load_error = None;
                }
                Err(error) => inner.load_error = Some(error),
            },
            Action::ResetSaved => {
                if inner.load_error.is_some() {
                    let backup = self.path.with_extension(format!("backup-{}.json", id()));
                    match fs::rename(&self.path, &backup) {
                        Ok(()) => inner.backup_path = Some(backup.to_string_lossy().into_owned()),
                        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                        Err(e) => {
                            return Err(format!(
                                "Could not preserve the original inbox for recovery: {e}"
                            ));
                        }
                    }
                    inner.load_error = None;
                }
            }
            Action::Retry => {}
        }
        self.persist(&mut inner);
        Ok(self.snapshot_of(&inner))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn store() -> (PathBuf, Store) {
        let dir = std::env::temp_dir().join(format!("qterm-agent-inbox-{}", id()));
        fs::create_dir_all(&dir).unwrap();
        let store = Store::load(dir.join("agent-inbox.json"));
        (dir, store)
    }
    fn cleanup(dir: PathBuf) {
        for entry in fs::read_dir(&dir).unwrap().flatten() {
            if entry.file_type().unwrap().is_dir() {
                fs::remove_dir(entry.path()).unwrap();
            } else {
                fs::remove_file(entry.path()).unwrap();
            }
        }
        fs::remove_dir(dir).unwrap();
    }
    #[test]
    fn approval_routing_is_informational_and_cannot_be_reopened_as_a_question() {
        let (dir, store) = store();
        let snapshot = store.record(
            Provider::Codex,
            "pane",
            Some("session"),
            None,
            Kind::Approval,
            "Approval check",
            "A human prompt is not confirmed",
        );
        let event = &snapshot.events[0];
        assert!(event.resolved_at.is_some());
        assert!(
            store
                .act(Action::Reopen, std::slice::from_ref(&event.id))
                .unwrap()
                .events[0]
                .resolved_at
                .is_some()
        );
        cleanup(dir);
    }
    #[test]
    fn migrates_old_codex_false_questions_without_claiming_they_were_approved() {
        let (dir, store) = store();
        let old = store.record(
            Provider::Codex,
            "pane",
            Some("session"),
            None,
            Kind::Permission,
            "Codex needs permission",
            "Waiting for you",
        );
        fs::write(
            &store.path,
            serde_json::to_vec(&Saved {
                version: 1,
                events: old.events,
            })
            .unwrap(),
        )
        .unwrap();
        let reloaded = Store::load(store.path.clone());
        let event = reloaded.snapshot().events.remove(0);
        assert_eq!(event.kind, Kind::Approval);
        assert!(event.resolved_at.is_some());
        assert!(event.resolution.unwrap().contains("no permission decision"));
        reloaded.act(Action::Retry, &[]).unwrap();
        assert_eq!(
            serde_json::from_slice::<Saved>(&fs::read(&store.path).unwrap())
                .unwrap()
                .version,
            2
        );
        cleanup(dir);
    }
    #[test]
    fn viewed_is_not_resolved_and_both_survive_restart() {
        let (dir, store) = store();
        let event = store
            .record(
                Provider::Codex,
                "pane",
                Some("session"),
                Some("C:/project"),
                Kind::Permission,
                "Permission",
                "Review the command",
            )
            .events[0]
            .clone();
        let viewed = store
            .act(Action::View, std::slice::from_ref(&event.id))
            .unwrap();
        assert!(viewed.events[0].viewed_at.is_some());
        assert!(viewed.events[0].resolved_at.is_none());
        let reloaded = Store::load(store.path.clone());
        assert_eq!(
            reloaded.snapshot().events[0].cwd.as_deref(),
            Some("C:/project")
        );
        assert!(reloaded.snapshot().events[0].viewed_at.is_some());
        assert_ne!(reloaded.snapshot().run_id, event.run_id);
        reloaded.act(Action::Resolve, &[event.id]).unwrap();
        assert!(
            Store::load(store.path.clone()).snapshot().events[0]
                .resolved_at
                .is_some()
        );
        cleanup(dir);
    }
    #[test]
    fn continuation_does_not_resolve_other_sessions_or_unreviewed_replies() {
        let (dir, store) = store();
        store.record(
            Provider::Codex,
            "pane",
            Some("one"),
            None,
            Kind::Permission,
            "Permission",
            "Review",
        );
        store.record(
            Provider::Claude,
            "pane",
            Some("one"),
            None,
            Kind::Permission,
            "Permission",
            "Review",
        );
        store.record(
            Provider::Codex,
            "pane",
            Some("two"),
            None,
            Kind::Permission,
            "Permission",
            "Review",
        );
        store.record(
            Provider::Codex,
            "pane",
            Some("one"),
            None,
            Kind::Completed,
            "Done",
            "Reply",
        );
        assert!(
            store
                .continued(Provider::Codex, "pane", Some("other"))
                .is_none()
        );
        let snapshot = store
            .continued(Provider::Codex, "pane", Some("one"))
            .unwrap();
        assert_eq!(
            snapshot
                .events
                .iter()
                .filter(|e| e.resolved_at.is_some())
                .count(),
            1
        );
        assert!(
            snapshot
                .events
                .iter()
                .find(|e| e.kind == Kind::Completed)
                .unwrap()
                .resolved_at
                .is_none()
        );
        cleanup(dir);
    }
    #[test]
    fn failed_writes_keep_events_and_retry_without_a_new_event() {
        let (dir, store) = store();
        fs::create_dir(&store.path).unwrap();
        let failed = store.record(
            Provider::Claude,
            "closed-pane",
            None,
            None,
            Kind::Failure,
            "Failed",
            "Rate limit",
        );
        assert!(failed.error.is_some());
        assert_eq!(failed.events.len(), 1);
        fs::remove_dir(&store.path).unwrap();
        let recovered = store.act(Action::Retry, &[]).unwrap();
        assert!(recovered.error.is_none());
        assert_eq!(
            Store::load(store.path.clone()).snapshot().events[0].message,
            "Rate limit"
        );
        cleanup(dir);
    }
    #[test]
    fn corrupt_history_is_not_overwritten_and_reset_preserves_a_backup() {
        let (dir, initial) = store();
        fs::write(&initial.path, "broken history").unwrap();
        let store = Store::load(initial.path.clone());
        assert!(store.snapshot().recovery_required);
        store.record(
            Provider::Codex,
            "pane",
            None,
            None,
            Kind::Completed,
            "Done",
            "New reply",
        );
        assert_eq!(fs::read_to_string(&store.path).unwrap(), "broken history");
        assert!(store.act(Action::Retry, &[]).unwrap().recovery_required);
        let recovered = store.act(Action::ResetSaved, &[]).unwrap();
        assert!(!recovered.recovery_required);
        assert!(recovered.error.is_none());
        assert_eq!(
            fs::read_to_string(recovered.backup_path.unwrap()).unwrap(),
            "broken history"
        );
        assert_eq!(
            Store::load(store.path.clone()).snapshot().events[0].message,
            "New reply"
        );
        cleanup(dir);
    }
    #[test]
    fn repeated_pending_requests_do_not_flood_and_resolved_clear_keeps_pending() {
        let (dir, store) = store();
        store.record(
            Provider::Codex,
            "pane",
            Some("one"),
            None,
            Kind::Permission,
            "Permission",
            "Review",
        );
        let repeated = store.record(
            Provider::Codex,
            "pane",
            Some("one"),
            None,
            Kind::Permission,
            "Permission",
            "Review",
        );
        assert_eq!(repeated.events.len(), 1);
        assert_eq!(repeated.events[0].repeats, 2);
        let id = repeated.events[0].id.clone();
        store.act(Action::Resolve, &[id]).unwrap();
        store.record(
            Provider::Claude,
            "pane",
            None,
            None,
            Kind::Completed,
            "Done",
            "Keep me",
        );
        let cleared = store.act(Action::ClearResolved, &[]).unwrap();
        assert_eq!(cleared.events.len(), 1);
        assert_eq!(cleared.events[0].message, "Keep me");
        cleanup(dir);
    }
}
