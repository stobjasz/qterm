//! PTY sessions: one ConPTY plus one shell process per terminal pane.
//!
//! Tauri-agnostic: output and exit are delivered through callbacks, which the
//! command layer wires to an IPC `Channel` and an event. Output is batched so
//! heavy output doesn't flood IPC, and flow-controlled by acknowledgements (`ack`).

pub mod conpty;
mod flow;
mod profiles;

pub use profiles::Profile;

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
    pub cols: u16,
    pub rows: u16,
}

#[derive(Default)]
pub struct SessionManager {
    next_id: AtomicU32,
    sessions: Sessions,
    profiles: OnceLock<Vec<Profile>>,
}

impl SessionManager {
    /// Detected on first use: listing WSL distros runs `wsl.exe`, which takes a moment.
    pub fn profiles(&self) -> &[Profile] {
        self.profiles.get_or_init(profiles::detect)
    }

    /// Starts the requested profile, or the default (first) one, with shell
    /// integration when `integrate` is set.
    pub fn spawn_profile(
        &self,
        request: &SpawnRequest,
        integrate: bool,
        on_output: impl FnMut(Vec<u8>) -> bool + Send + 'static,
        on_exit: impl FnOnce(SessionId, u32) + Send + 'static,
    ) -> Result<SessionId, String> {
        let profiles = self.profiles();
        let profile = match &request.profile_id {
            Some(id) => profiles.iter().find(|p| &p.id == id).ok_or_else(|| format!("unknown profile {id}"))?,
            None => profiles.first().ok_or("no shell profiles found")?,
        };
        let cmd = profile.command(request.cwd.as_deref(), integrate);
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

        let flow = Arc::new(Flow::default());
        let id = self.next_id.fetch_add(1, Ordering::Relaxed) + 1;
        self.sessions.lock().unwrap().insert(
            id,
            Session { master: pair.master, writer, killer, flow: Arc::clone(&flow) },
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

    #[test]
    fn resize_unknown_session_is_an_error() {
        assert!(SessionManager::default().resize(99, 80, 24).is_err());
    }
}
