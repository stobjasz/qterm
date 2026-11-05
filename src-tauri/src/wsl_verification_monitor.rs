//! Windows-owned lifetime for a fixed-context Linux repository monitor.
use crate::{repo_state::Snapshot, wsl_owner::Owner};
use serde::Deserialize;
use serde_json::json;
use std::sync::{
    Mutex,
    atomic::{AtomicUsize, Ordering},
};

static ACTIVE: AtomicUsize = AtomicUsize::new(0);
struct Permit;
impl Drop for Permit {
    fn drop(&mut self) {
        ACTIVE.fetch_sub(1, Ordering::AcqRel);
    }
}

pub(crate) struct Monitor {
    owner: Mutex<Option<Owner>>,
    _permit: Permit,
    distribution: String,
    token: String,
    pub cwd: String,
    pub before: Snapshot,
    #[cfg(test)]
    pub identity: [u64; 2],
}
#[derive(Deserialize)]
struct Started {
    cwd: String,
    before: Snapshot,
    identity: [u64; 2],
}
#[derive(Deserialize)]
pub(crate) struct Finished {
    pub after: Option<Snapshot>,
    pub changed: bool,
}

impl Monitor {
    pub fn start(distribution: &str, cwd: &str) -> Result<Self, String> {
        ACTIVE
            .try_update(Ordering::AcqRel, Ordering::Acquire, |value| {
                (value < 16).then_some(value + 1)
            })
            .map_err(|_| "At most 16 Linux verification monitors can be pending")?;
        let permit = Permit;
        let owner = Owner::new(distribution)?;
        let mut started: Started = serde_json::from_value(crate::wsl::call(
            distribution,
            json!({
                "method":"verification_start", "token":owner.token,
                "lifetime":crate::repo_state::display(&owner.path), "cwd":cwd
            }),
        )?)
        .map_err(|error| error.to_string())?;
        if started.identity[0] <= 1
            || started.identity[0] > u32::MAX as u64
            || started.identity[1] == 0
            || !started.cwd.starts_with('/')
            || started.cwd.len() > 4096
            || !started.before.root.starts_with('/')
        {
            return Err("Invalid Linux verification startup identity".into());
        }
        // Command timestamps are recorded by the Windows app. This is the point
        // at which the Linux snapshot and continuous coverage were acknowledged.
        started.before.captured_at = crate::repo_state::now();
        Ok(Self {
            token: owner.token.clone(),
            owner: Mutex::new(Some(owner)),
            _permit: permit,
            distribution: distribution.into(),
            cwd: started.cwd,
            before: started.before,
            #[cfg(test)]
            identity: started.identity,
        })
    }
    pub fn cancel(&self) {
        self.owner.lock().unwrap().take();
    }
    fn request(&self, action: &str) -> Result<Finished, String> {
        if self.owner.lock().unwrap().is_none() {
            return Err("Linux verification was cancelled".into());
        }
        let result: Finished = serde_json::from_value(crate::wsl::call(
            &self.distribution,
            json!({
                "method":"verification_request", "token":self.token, "action":action
            }),
        )?)
        .map_err(|error| error.to_string())?;
        if self.owner.lock().unwrap().is_none() {
            return Err("Linux verification owner ended".into());
        }
        if result
            .after
            .as_ref()
            .is_some_and(|after| after.root != self.before.root)
        {
            return Err("Linux verification returned a different repository context".into());
        }
        Ok(result)
    }
    pub fn changed(&self) -> Result<bool, String> {
        Ok(self.request("status")?.changed)
    }
    pub fn finish(&self) -> Result<Finished, String> {
        self.request("finish")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::run_records::{Freshness, Run, Store};
    use std::{
        fs,
        os::windows::process::CommandExt,
        path::PathBuf,
        process::{Child, Command, Stdio},
        thread,
        time::{Duration, Instant},
    };
    const FIXTURE: &str = r#"
import json,os,select,shutil,signal,tempfile
request=QTERM_REQUEST
action=request['action']
if action=='seed':
    root=tempfile.mkdtemp(prefix='qterm-wsl-verification-native-')
    cwd=root+'/Case';os.mkdir(cwd)
    repo_git(cwd,['init','--quiet','--initial-branch=source'])
    with open(cwd+'/value.txt','w') as stream:stream.write('one')
    print(json.dumps({'root':root,'cwd':cwd}))
else:
    root=request['root']
    assert os.path.realpath(root)==root and os.path.dirname(root)=='/tmp' and os.path.basename(root).startswith('qterm-wsl-verification-native-')
    if action=='write':
        with open(root+'/Case/value.txt','w') as stream:stream.write(request['text'])
        print('true')
    elif action in ('alive','terminate'):
        pid,birth=request['identity'];alive=False
        try:
            handle=os.pidfd_open(pid)
            try:
                with open('/proc/'+str(pid)+'/stat') as stream:fields=stream.read().rpartition(') ')[2].split()
                with open('/proc/'+str(pid)+'/cmdline','rb') as stream:args=stream.read(65536).rstrip(b'\0').split(b'\0')
                alive=int(fields[19])==birth and fields[0]!='Z' and os.stat('/proc/'+str(pid)).st_uid==os.getuid() and args[-1]==request['bootstrap'].encode() and not select.select([handle],[],[],0)[0]
                if alive and action=='terminate':signal.pidfd_send_signal(handle,signal.SIGTERM)
            finally:os.close(handle)
        except (FileNotFoundError,ProcessLookupError):pass
        print(json.dumps(alive))
    elif action=='cleanup':
        if os.path.exists(root):shutil.rmtree(root)
        print('true')
"#;
    struct Fixture {
        distro: String,
        root: String,
        cwd: String,
        data: PathBuf,
        identities: Mutex<Vec<[u64; 2]>>,
    }
    impl Fixture {
        fn new() -> Self {
            let distro = std::env::var("QTERM_E2E_WSL_DISTRIBUTION")
                .expect("Set QTERM_E2E_WSL_DISTRIBUTION for this opt-in test");
            let value = crate::wsl::test_python(
                &distro,
                &format!("{}\n{FIXTURE}", include_str!("wsl_repository.py")),
                json!({"action":"seed"}),
            )
            .unwrap();
            let data = std::env::temp_dir().join(format!(
                "qterm-verification-monitor-{}",
                crate::run_records::id()
            ));
            fs::create_dir(&data).unwrap();
            Self {
                distro,
                root: value["root"].as_str().unwrap().into(),
                cwd: value["cwd"].as_str().unwrap().into(),
                data,
                identities: Mutex::new(Vec::new()),
            }
        }
        fn call(&self, mut request: serde_json::Value) -> serde_json::Value {
            request["root"] = json!(self.root);
            request["bootstrap"] = json!(include_str!("wsl_bootstrap.py"));
            crate::wsl::test_python(
                &self.distro,
                &format!("{}\n{FIXTURE}", include_str!("wsl_repository.py")),
                request,
            )
            .unwrap()
        }
        fn track(&self, monitor: &Monitor) {
            self.identities.lock().unwrap().push(monitor.identity);
        }
        fn alive(&self, identity: [u64; 2]) -> bool {
            self.call(json!({"action":"alive","identity":identity}))
                .as_bool()
                .unwrap()
        }
        fn ended(&self, identity: [u64; 2]) {
            let end = Instant::now() + Duration::from_secs(5);
            while self.alive(identity) {
                assert!(
                    Instant::now() < end,
                    "monitor survived Windows lifetime removal"
                );
                thread::yield_now();
            }
        }
        fn profile(&self) -> crate::pty::Profile {
            crate::pty::Profile::custom(&serde_json::from_value(json!({"id":"monitor-test","name":"Monitor test","command":format!("wsl.exe --distribution \"{}\" --exec /bin/bash -i",self.distro)})).unwrap())
        }
        fn record(&self, at: u64) -> Run {
            Run {
                id: crate::run_records::id(),
                pane_id: "test-pane".into(),
                profile_id: Some("monitor-test".into()),
                shell_kind: Some("wsl".into()),
                environment: Some(format!("wsl:{}", self.distro.to_lowercase())),
                app_run_id: None,
                cwd: Some(self.cwd.clone()),
                command: "check".into(),
                command_truncated: false,
                exit_code: Some(0),
                started_at: at,
                finished_at: at + 1,
                output: "fixture result".into(),
                output_truncated: false,
                verification: None,
                requester: None,
            }
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            for identity in self.identities.lock().unwrap().iter() {
                let _ = crate::wsl::test_python(
                    &self.distro,
                    &format!("{}\n{FIXTURE}", include_str!("wsl_repository.py")),
                    json!({"action":"terminate","root":self.root,"identity":identity,"bootstrap":include_str!("wsl_bootstrap.py")}),
                );
            }
            let _ = crate::wsl::test_python(
                &self.distro,
                &format!("{}\n{FIXTURE}", include_str!("wsl_repository.py")),
                json!({"action":"cleanup","root":self.root}),
            );
            if let (Ok(target), Ok(parent)) = (
                self.data.canonicalize(),
                std::env::temp_dir().canonicalize(),
            ) && target.parent() == Some(parent.as_path())
                && target.file_name().is_some_and(|name| {
                    name.to_string_lossy()
                        .starts_with("qterm-verification-monitor-")
                })
            {
                let _ = fs::remove_dir_all(target);
            }
        }
    }
    #[test]
    #[ignore = "Requires an explicitly selected real WSL distribution"]
    fn windows_lifetimes_and_backend_records_retain_linux_coverage() {
        let fixture = Fixture::new();
        let first = Monitor::start(&fixture.distro, &fixture.cwd).unwrap();
        fixture.track(&first);
        let first_id = first.identity;
        let other = Monitor::start(&fixture.distro, &fixture.cwd).unwrap();
        fixture.track(&other);
        assert!(!first.changed().unwrap());
        assert!(fixture.alive(first_id));
        drop(first);
        fixture.ended(first_id);
        assert!(!other.changed().unwrap());
        let other_id = other.identity;
        other.cancel();
        fixture.ended(other_id);
        assert!(other.changed().is_err());
        drop(other);
        let store = Store::load(fixture.data.join("history.json"));
        let profile = fixture.profile();
        let unauthorized = store
            .prepare_wsl(&fixture.distro, &fixture.cwd, "check", &profile)
            .unwrap();
        let result = store
            .append(
                fixture.record(unauthorized.before.captured_at + 1),
                Some(&unauthorized.id),
            )
            .unwrap();
        assert!(!result.runs[0].verification.as_ref().unwrap().eligible);
        let prepared = store
            .prepare_wsl(&fixture.distro, &fixture.cwd, "check", &profile)
            .unwrap();
        assert!(
            store
                .authorize_wsl(
                    &prepared.id,
                    "test-pane",
                    &|_| Err("profile changed".into())
                )
                .is_err()
        );
        store.cancel(&prepared.id);
        assert!(store.launch_context(&prepared.id).is_err());
        let mismatched = store
            .prepare_wsl(&fixture.distro, &fixture.cwd, "check", &profile)
            .unwrap();
        store
            .authorize_wsl(&mismatched.id, "test-pane", &|_| Ok(()))
            .unwrap();
        let mut wrong = fixture.record(mismatched.before.captured_at + 1);
        wrong.environment = Some("native".into());
        let wrong_id = wrong.id.clone();
        let result = store.append(wrong, Some(&mismatched.id)).unwrap();
        assert!(
            !result
                .runs
                .iter()
                .find(|run| run.id == wrong_id)
                .unwrap()
                .verification
                .as_ref()
                .unwrap()
                .eligible
        );
        let prepared = store
            .prepare_wsl(&fixture.distro, &fixture.cwd, "check", &profile)
            .unwrap();
        store
            .authorize_wsl(&prepared.id, "test-pane", &|launch| {
                assert_eq!(launch.profile_key, profile.launch_key());
                Ok(())
            })
            .unwrap();
        let run = fixture.record(prepared.before.captured_at + 1);
        let id = run.id.clone();
        let result = store.append(run, Some(&prepared.id)).unwrap();
        assert_eq!(
            result
                .runs
                .iter()
                .find(|run| run.id == id)
                .unwrap()
                .verification
                .as_ref()
                .unwrap()
                .status,
            Freshness::Matches
        );
        // Retained history can contain the same root spelling in another
        // environment. A missing native checkout must not borrow Linux proof.
        let history = fixture.data.join("history.json");
        let mut saved: serde_json::Value =
            serde_json::from_slice(&fs::read(&history).unwrap()).unwrap();
        saved["runs"]
            .as_array_mut()
            .unwrap()
            .iter_mut()
            .find(|run| run["id"] == wrong_id)
            .unwrap()["verification"]["eligible"] = json!(true);
        fs::write(&history, serde_json::to_vec(&saved).unwrap()).unwrap();
        let restored = Store::load(history);
        assert_eq!(
            restored
                .snapshot()
                .runs
                .iter()
                .find(|run| run.id == id)
                .unwrap()
                .verification
                .as_ref()
                .unwrap()
                .status,
            Freshness::Unknown
        );
        let compared = restored.refresh();
        assert_eq!(
            compared
                .runs
                .iter()
                .find(|run| run.id == wrong_id)
                .unwrap()
                .verification
                .as_ref()
                .unwrap()
                .status,
            Freshness::Unknown
        );
        assert_eq!(
            compared
                .runs
                .iter()
                .find(|run| run.id == id)
                .unwrap()
                .verification
                .as_ref()
                .unwrap()
                .status,
            Freshness::Matches
        );
        let prepared = store
            .prepare_wsl(&fixture.distro, &fixture.cwd, "check", &profile)
            .unwrap();
        store
            .authorize_wsl(&prepared.id, "test-pane", &|_| Ok(()))
            .unwrap();
        fixture.call(json!({"action":"write","text":"two"}));
        fixture.call(json!({"action":"write","text":"one"}));
        let changed = fixture.record(prepared.before.captured_at + 1);
        let changed_id = changed.id.clone();
        let result = store.append(changed, Some(&prepared.id)).unwrap();
        let evidence = result
            .runs
            .iter()
            .find(|run| run.id == changed_id)
            .unwrap()
            .verification
            .as_ref()
            .unwrap();
        assert_eq!(evidence.status, Freshness::Stale);
        assert!(evidence.changed_during_run);
        assert!(!evidence.eligible);
    }
    struct OwnedChild(Child);
    impl Drop for OwnedChild {
        fn drop(&mut self) {
            let _ = self.0.kill();
            let _ = self.0.wait();
        }
    }
    #[test]
    #[ignore = "Requires an explicitly selected real WSL distribution"]
    fn direct_windows_owner_crash_ends_its_linux_monitor() {
        let fixture = Fixture::new();
        let report = fixture.data.join("crash.json");
        let mut child = OwnedChild(
            Command::new(std::env::current_exe().unwrap())
                .args([
                    "--ignored",
                    "--exact",
                    "wsl_verification_monitor::tests::crash_child",
                    "--nocapture",
                ])
                .env("QTERM_VERIFICATION_CRASH_REPORT", &report)
                .env("QTERM_VERIFICATION_CRASH_CWD", &fixture.cwd)
                .creation_flags(0x08000000)
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .unwrap(),
        );
        let end = Instant::now() + Duration::from_secs(20);
        let identity: [u64; 2] = loop {
            if let Ok(bytes) = fs::read(&report)
                && let Ok(identity) = serde_json::from_slice(&bytes)
            {
                break identity;
            }
            assert!(
                Instant::now() < end,
                "crash helper did not prepare its monitor"
            );
            assert!(
                child.0.try_wait().unwrap().is_none(),
                "crash helper ended early"
            );
            thread::sleep(Duration::from_millis(20));
        };
        fixture.identities.lock().unwrap().push(identity);
        assert!(fixture.alive(identity));
        child.0.kill().unwrap();
        child.0.wait().unwrap();
        fixture.ended(identity);
    }
    #[test]
    #[ignore = "Only launched as a child by the direct Windows crash test"]
    fn crash_child() {
        let Ok(report) = std::env::var("QTERM_VERIFICATION_CRASH_REPORT") else {
            return;
        };
        let monitor = Monitor::start(
            &std::env::var("QTERM_E2E_WSL_DISTRIBUTION").unwrap(),
            &std::env::var("QTERM_VERIFICATION_CRASH_CWD").unwrap(),
        )
        .unwrap();
        fs::write(report, serde_json::to_vec(&monitor.identity).unwrap()).unwrap();
        thread::sleep(Duration::from_secs(30));
        drop(monitor);
    }
}
