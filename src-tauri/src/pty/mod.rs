//! PTY sessions: one ConPTY plus one shell process per terminal pane.
//!
//! Tauri-agnostic: output and exit are delivered through callbacks, which the
//! command layer wires to an IPC `Channel` and an event. Output is batched so
//! heavy output doesn't flood IPC, and flow-controlled by acknowledgements (`ack`).

pub mod conpty;
mod flow;
mod profiles;

pub use profiles::{merge as merge_profiles, split_command, ssh_profiles, Profile};

use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::{Arc, Mutex, Once, OnceLock};
use std::thread;
use std::time::{Duration, Instant};

use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};

use flow::Flow;

pub type SessionId = u32;

const READ_BUF_BYTES: usize = 64 * 1024;
/// Send a batch to the UI once this many bytes are buffered...
const FLUSH_BYTES: usize = 16 * 1024;
/// ...or once the first buffered chunk is this old, whichever comes first.
const FLUSH_INTERVAL: Duration = Duration::from_millis(5);

struct Session {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    killer: Box<dyn ChildKiller + Send + Sync>,
    flow: Arc<Flow>,
    /// The shell's process id, to see what runs inside it.
    pid: Option<u32>,
}

type Sessions = Arc<Mutex<HashMap<SessionId, Session>>>;

/// What the UI asks for when it opens a pane.
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpawnRequest {
    /// `None` means the default profile.
    pub profile_id: Option<String>,
    /// Start here when the folder exists (else the profile's home).
    pub cwd: Option<String>,
    /// Exported to the shell as QTERM_PANE, so tools in it (Claude Code's
    /// notification hook) can say which pane they belong to.
    pub pane_id: Option<String>,
    pub cols: u16,
    pub rows: u16,
    /// Run as administrator through Windows' sudo (inline mode only).
    #[serde(default)]
    pub elevated: bool,
}

#[derive(Default)]
pub struct SessionManager {
    next_id: AtomicU32,
    sessions: Sessions,
    profiles: OnceLock<Vec<Profile>>,
}

impl SessionManager {
    /// Detected on first use: listing WSL distros runs `wsl.exe`, which takes a moment.
    pub fn detected_profiles(&self) -> &[Profile] {
        self.profiles.get_or_init(profiles::detect)
    }

    /// Starts the requested profile from `profiles` (or the first one), with shell
    /// integration when `integrate` is set.
    pub fn spawn_profile(
        &self,
        request: &SpawnRequest,
        profiles: &[Profile],
        integrate: bool,
        inbox: Option<&std::path::Path>,
        on_output: impl FnMut(Vec<u8>) -> bool + Send + 'static,
        on_exit: impl FnOnce(SessionId, u32) + Send + 'static,
    ) -> Result<SessionId, String> {
        let profile = match &request.profile_id {
            Some(id) => profiles.iter().find(|p| &p.id == id).ok_or_else(|| format!("unknown profile {id}"))?,
            None => profiles.first().ok_or("no shell profiles found")?,
        };
        let mut cmd = profile.command(request.cwd.as_deref(), integrate);
        if let Some(pane_id) = &request.pane_id {
            cmd.env(crate::alerts::PANE_ENV, pane_id);
        }
        if let Some(inbox) = inbox {
            cmd.env(crate::alerts::INBOX_ENV, inbox);
        }
        if request.elevated {
            if crate::elevation::sudo_mode() != crate::elevation::SudoMode::Inline {
                return Err("administrator tabs need Windows' sudo set to Inline".into());
            }
            crate::elevation::elevate(&mut cmd);
        }
        self.spawn(cmd, request.cols, request.rows, on_output, on_exit)
    }

    /// `on_output` receives batched bytes and returns `false` once nobody is listening;
    /// the receiver must `ack` them as it processes them, or reading pauses.
    /// `on_exit` gets the id and exit code after the session has been removed.
    pub fn spawn(
        &self,
        cmd: CommandBuilder,
        cols: u16,
        rows: u16,
        on_output: impl FnMut(Vec<u8>) -> bool + Send + 'static,
        on_exit: impl FnOnce(SessionId, u32) + Send + 'static,
    ) -> Result<SessionId, String> {
        allow_ctrl_c_in_children();
        let pair = native_pty_system()
            .openpty(pty_size(cols, rows))
            .map_err(|e| e.to_string())?;
        let mut child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
        drop(pair.slave);

        let reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
        let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
        let killer = child.clone_killer();
        let pid = child.process_id();

        let flow = Arc::new(Flow::default());
        let id = self.next_id.fetch_add(1, Ordering::Relaxed) + 1;
        self.sessions.lock().unwrap().insert(
            id,
            Session { master: pair.master, writer, killer, flow: Arc::clone(&flow), pid },
        );

        pump_output(reader, flow, on_output);

        // ConPTY doesn't signal EOF when the shell exits; the pseudoconsole has to be
        // closed (by dropping the master) before the reader thread can finish.
        let sessions = Arc::clone(&self.sessions);
        thread::spawn(move || {
            let code = child.wait().map(|status| status.exit_code()).unwrap_or(1);
            drop(take(&sessions, id));
            on_exit(id, code);
        });

        Ok(id)
    }

    pub fn write(&self, id: SessionId, data: &str) -> Result<(), String> {
        let mut sessions = self.sessions.lock().unwrap();
        let session = sessions.get_mut(&id).ok_or("no such session")?;
        session
            .writer
            .write_all(data.as_bytes())
            .and_then(|()| session.writer.flush())
            .map_err(|e| e.to_string())
    }

    pub fn resize(&self, id: SessionId, cols: u16, rows: u16) -> Result<(), String> {
        let sessions = self.sessions.lock().unwrap();
        let session = sessions.get(&id).ok_or("no such session")?;
        session.master.resize(pty_size(cols, rows)).map_err(|e| e.to_string())
    }

    /// Sessions with `program` (e.g. "claude.exe") running inside their shell.
    pub fn running(&self, program: &str) -> Vec<SessionId> {
        let shells: Vec<(SessionId, u32)> = self
            .sessions
            .lock()
            .unwrap()
            .iter()
            .filter_map(|(id, s)| Some((*id, s.pid?)))
            .collect();
        if shells.is_empty() {
            return Vec::new();
        }
        let processes = crate::procs::snapshot();
        shells
            .into_iter()
            .filter(|(_, pid)| crate::procs::runs_below(&processes, *pid, program))
            .map(|(id, _)| id)
            .collect()
    }

    /// The UI has processed `bytes` of this session's output.
    pub fn ack(&self, id: SessionId, bytes: usize) {
        if let Some(session) = self.sessions.lock().unwrap().get(&id) {
            session.flow.ack(bytes);
        }
    }

    pub fn kill(&self, id: SessionId) {
        if let Some(mut session) = take(&self.sessions, id) {
            let _ = session.killer.kill();
        }
    }
}

/// Removes a session so it drops outside the lock: closing a pseudoconsole can
/// block until its output pipe is drained, which is also why the flow is closed
/// (the reader stops pausing and drains to EOF) before the caller drops it.
fn take(sessions: &Sessions, id: SessionId) -> Option<Session> {
    let session = sessions.lock().unwrap().remove(&id);
    if let Some(session) = &session {
        session.flow.close();
    }
    session
}

/// Windows passes "ignore Ctrl+C" from parent to child process. If whatever
/// launched qterm set it (a terminal, pnpm/node, some launchers), every shell
/// would inherit it and Ctrl+C would silently do nothing. Clear it once, before
/// the first shell starts.
fn allow_ctrl_c_in_children() {
    static ONCE: Once = Once::new();
    ONCE.call_once(|| {
        #[link(name = "kernel32")]
        unsafe extern "system" {
            fn SetConsoleCtrlHandler(handler: *const core::ffi::c_void, add: i32) -> i32;
        }
        // SAFETY: a NULL handler with FALSE only clears this process's ignore flag.
        unsafe { SetConsoleCtrlHandler(core::ptr::null(), 0) };
    });
}

fn pty_size(cols: u16, rows: u16) -> PtySize {
    PtySize { cols, rows, pixel_width: 0, pixel_height: 0 }
}

/// Reader thread: blocking reads from the PTY, paused while the UI is too far
/// behind. Flusher thread: coalesces chunks into batches of up to `FLUSH_BYTES` or
/// `FLUSH_INTERVAL`, then sends them.
fn pump_output(
    mut reader: Box<dyn Read + Send>,
    flow: Arc<Flow>,
    mut on_output: impl FnMut(Vec<u8>) -> bool + Send + 'static,
) {
    let (tx, rx) = mpsc::channel::<Vec<u8>>();

    let reader_flow = Arc::clone(&flow);
    thread::spawn(move || {
        let mut buf = vec![0u8; READ_BUF_BYTES];
        loop {
            reader_flow.wait_until_ready();
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                // Keep draining even when nobody listens any more; see `take`.
                Ok(n) => {
                    let _ = tx.send(buf[..n].to_vec());
                }
            }
        }
    });

    thread::spawn(move || {
        while let Ok(mut batch) = rx.recv() {
            let deadline = Instant::now() + FLUSH_INTERVAL;
            while batch.len() < FLUSH_BYTES {
                match rx.recv_timeout(deadline.saturating_duration_since(Instant::now())) {
                    Ok(more) => batch.extend_from_slice(&more),
                    Err(RecvTimeoutError::Timeout | RecvTimeoutError::Disconnected) => break,
                }
            }
            flow.sent(batch.len());
            if !on_output(batch) {
                break;
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    const TIMEOUT: Duration = Duration::from_secs(10);

    struct Probe {
        output: Arc<Mutex<Vec<u8>>>,
        exit: mpsc::Receiver<(SessionId, u32)>,
    }

    impl Probe {
        fn text(&self) -> String {
            String::from_utf8_lossy(&self.output.lock().unwrap()).into_owned()
        }

        fn wait_exit(&self) -> (SessionId, u32) {
            self.exit.recv_timeout(TIMEOUT).expect("session did not exit")
        }

        /// Exit fires when the process ends; the last output batch may still be in flight.
        fn wait_for_text(&self, needle: &str) -> bool {
            let deadline = Instant::now() + TIMEOUT;
            while Instant::now() < deadline {
                if self.text().contains(needle) {
                    return true;
                }
                thread::sleep(Duration::from_millis(20));
            }
            false
        }
    }

    fn spawn(manager: &SessionManager, args: &[&str]) -> (SessionId, Probe) {
        let mut cmd = CommandBuilder::new("cmd.exe");
        cmd.args(args);
        let output = Arc::new(Mutex::new(Vec::new()));
        let (exit_tx, exit) = mpsc::channel();
        let sink = Arc::clone(&output);
        let id = manager
            .spawn(
                cmd,
                80,
                24,
                move |bytes| {
                    sink.lock().unwrap().extend(bytes);
                    true
                },
                move |id, code| exit_tx.send((id, code)).unwrap(),
            )
            .expect("spawn failed");
        let probe = Probe { output, exit };

        // ConPTY opens with a cursor-position query and holds all output until a
        // terminal answers it. xterm.js replies on its own; here we play the terminal.
        assert!(probe.wait_for_text("[6n"), "no cursor query, got: {:?}", probe.text());
        manager.write(id, "[1;1R").unwrap();
        (id, probe)
    }

    #[test]
    fn streams_output_and_reports_exit_code() {
        let manager = SessionManager::default();
        let (id, probe) = spawn(&manager, &["/c", "echo qterm-hello & exit /b 3"]);

        assert_eq!(probe.wait_exit(), (id, 3));
        assert!(probe.wait_for_text("qterm-hello"), "output was: {:?}", probe.text());
        assert!(manager.sessions.lock().unwrap().is_empty(), "exited session not removed");
    }

    #[test]
    fn forwards_input_to_the_shell() {
        let manager = SessionManager::default();
        let (id, probe) = spawn(&manager, &["/q", "/k"]);

        // `set /a` prints the result, which never appears in the echoed input.
        manager.write(id, "set /a 6*7\r\n").unwrap();
        assert!(probe.wait_for_text("42"), "output was: {:?}", probe.text());

        manager.write(id, "exit 7\r\n").unwrap();
        assert_eq!(probe.wait_exit(), (id, 7));
    }

    #[test]
    fn kill_ends_the_session() {
        let manager = SessionManager::default();
        let (id, probe) = spawn(&manager, &["/q", "/k"]);

        manager.kill(id);

        assert_eq!(probe.wait_exit().0, id);
        assert!(manager.write(id, "dir\r\n").is_err());
    }

    #[test]
    fn unacknowledged_output_pauses_the_shell_until_acked() {
        let manager = SessionManager::default();
        // ~6 MB of output, far above the high-water mark.
        let line = "x".repeat(100);
        let (id, probe) = spawn(&manager, &["/c", &format!("for /L %i in (1,1,60000) do @echo %i {line}")]);

        thread::sleep(Duration::from_secs(2));
        let received = probe.output.lock().unwrap().len();
        assert!(received >= flow::HIGH_WATER, "paused too early: {received} bytes");
        assert!(received < flow::HIGH_WATER + 512 * 1024, "did not pause: {received} bytes");
        assert!(probe.exit.try_recv().is_err(), "the shell should be blocked, not finished");

        // Acknowledge as the UI would; the flood then runs to completion.
        let mut acked = 0;
        let deadline = Instant::now() + Duration::from_secs(60);
        let exit = loop {
            let total = probe.output.lock().unwrap().len();
            manager.ack(id, total - acked);
            acked = total;
            if let Ok(exit) = probe.exit.try_recv() {
                break exit;
            }
            assert!(Instant::now() < deadline, "flood never finished");
            thread::sleep(Duration::from_millis(10));
        };
        assert_eq!(exit, (id, 0));
        // The line wraps at 80 columns, so look for its start.
        assert!(probe.wait_for_text("60000 xxxxxxxxxx"));
    }

    #[test]
    fn ctrl_c_interrupts_the_running_program() {
        let manager = SessionManager::default();
        let (id, probe) = spawn(&manager, &["/c", "ping -n 30 127.0.0.1"]);
        assert!(probe.wait_for_text("127.0.0.1"), "ping did not start: {:?}", probe.text());

        manager.write(id, "").unwrap();

        let (exited, _) = probe.exit.recv_timeout(Duration::from_secs(5)).expect("Ctrl+C was ignored");
        assert_eq!(exited, id);
    }

    /// Child half of the crash test below: owns a session whose shell runs ping,
    /// reports the shell's pid, then waits to be killed.
    #[test]
    #[ignore]
    fn crash_helper_owns_a_session() {
        if std::env::var_os("QTERM_CRASH_HELPER").is_none() {
            return;
        }
        let manager = SessionManager::default();
        let (id, _probe) = spawn(&manager, &["/c", "ping -n 100 127.0.0.1"]);
        let pid = manager.sessions.lock().unwrap()[&id].pid.unwrap();
        println!("SHELL_PID={pid}");
        std::io::Write::flush(&mut std::io::stdout()).unwrap();
        thread::sleep(Duration::from_secs(60));
    }

    /// Why qterm needs no Job Object: when the process that owns a pseudoconsole dies
    /// (crash, Task Manager), the console host goes with it and Windows ends every
    /// process attached to that console: the shell and the programs running in it.
    #[test]
    fn a_crash_takes_the_shell_and_its_programs_with_it() {
        use std::io::BufRead;
        use std::process::{Command, Stdio};

        let mut helper = Command::new(std::env::current_exe().unwrap())
            .args(["--ignored", "--exact", "pty::tests::crash_helper_owns_a_session", "--nocapture", "--test-threads=1"])
            .env("QTERM_CRASH_HELPER", "1")
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        let stdout = std::io::BufReader::new(helper.stdout.take().unwrap());
        let shell: u32 = stdout
            .lines()
            .map_while(Result::ok)
            // The harness prints "test <name> ... " without a newline, so it can share the line.
            .find_map(|line| line.split("SHELL_PID=").nth(1).map(|pid| pid.trim().parse().unwrap()))
            .expect("helper reported no shell");

        // Wait for ping to run inside the shell, and remember its pid.
        let deadline = Instant::now() + TIMEOUT;
        let ping = loop {
            let found = crate::procs::snapshot().into_iter().find(|p| p.parent == shell && p.name == "ping.exe");
            if let Some(p) = found {
                break p.pid;
            }
            assert!(Instant::now() < deadline, "ping never started");
            thread::sleep(Duration::from_millis(100));
        };

        helper.kill().unwrap(); // TerminateProcess, as a crash would end it
        helper.wait().unwrap();

        let alive = |pid: u32| crate::procs::snapshot().iter().any(|p| p.pid == pid);
        let deadline = Instant::now() + TIMEOUT;
        while (alive(shell) || alive(ping)) && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(100));
        }
        assert!(!alive(shell), "the shell outlived its owner");
        assert!(!alive(ping), "a program in the shell outlived its owner");
    }

    #[test]
    fn resize_unknown_session_is_an_error() {
        assert!(SessionManager::default().resize(99, 80, 24).is_err());
    }
}
