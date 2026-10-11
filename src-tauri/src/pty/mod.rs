//! PTY sessions: one ConPTY plus one shell process per terminal pane.
//!
//! Tauri-agnostic: output and exit are delivered through callbacks, which the
//! command layer wires to an IPC `Channel` and an event. Output is batched so
//! heavy output doesn't flood IPC.

mod profiles;

use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};

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
}

type Sessions = Arc<Mutex<HashMap<SessionId, Session>>>;

#[derive(Default)]
pub struct SessionManager {
    next_id: AtomicU32,
    sessions: Sessions,
}

impl SessionManager {
    /// Starts the default shell in its home directory.
    pub fn spawn_default(
        &self,
        cols: u16,
        rows: u16,
        on_output: impl FnMut(Vec<u8>) -> bool + Send + 'static,
        on_exit: impl FnOnce(SessionId, u32) + Send + 'static,
    ) -> Result<SessionId, String> {
        let mut cmd = CommandBuilder::new(profiles::default_shell());
        if let Some(home) = std::env::var_os("USERPROFILE") {
            cmd.cwd(home);
        }
        self.spawn(cmd, cols, rows, on_output, on_exit)
    }

    /// `on_output` receives batched bytes and returns `false` once nobody is listening.
    /// `on_exit` gets the id and exit code after the session has been removed.
    pub fn spawn(
        &self,
        cmd: CommandBuilder,
        cols: u16,
        rows: u16,
        on_output: impl FnMut(Vec<u8>) -> bool + Send + 'static,
        on_exit: impl FnOnce(SessionId, u32) + Send + 'static,
    ) -> Result<SessionId, String> {
        let pair = native_pty_system()
            .openpty(pty_size(cols, rows))
            .map_err(|e| e.to_string())?;
        let mut child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
        drop(pair.slave);

        let reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
        let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
        let killer = child.clone_killer();

        let id = self.next_id.fetch_add(1, Ordering::Relaxed) + 1;
        self.sessions.lock().unwrap().insert(
            id,
            Session { master: pair.master, writer, killer },
        );

        pump_output(reader, on_output);

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

    pub fn kill(&self, id: SessionId) {
        if let Some(mut session) = take(&self.sessions, id) {
            let _ = session.killer.kill();
        }
    }
}

/// Removes a session so it drops outside the lock: closing a pseudoconsole can
/// block until its output pipe is drained.
fn take(sessions: &Sessions, id: SessionId) -> Option<Session> {
    sessions.lock().unwrap().remove(&id)
}

fn pty_size(cols: u16, rows: u16) -> PtySize {
    PtySize { cols, rows, pixel_width: 0, pixel_height: 0 }
}

/// Reader thread: blocking reads from the PTY. Flusher thread: coalesces chunks
/// into batches of up to `FLUSH_BYTES` or `FLUSH_INTERVAL`, then sends them.
fn pump_output(mut reader: Box<dyn Read + Send>, mut on_output: impl FnMut(Vec<u8>) -> bool + Send + 'static) {
    let (tx, rx) = mpsc::channel::<Vec<u8>>();

    thread::spawn(move || {
        let mut buf = vec![0u8; READ_BUF_BYTES];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    if tx.send(buf[..n].to_vec()).is_err() {
                        break;
                    }
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
    fn resize_unknown_session_is_an_error() {
        assert!(SessionManager::default().resize(99, 80, 24).is_err());
    }
}
