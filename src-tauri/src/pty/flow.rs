//! Output backpressure. The UI acknowledges bytes once xterm.js has processed them;
//! when too many are outstanding the PTY reader stops reading, ConPTY's pipe fills,
//! and the shell blocks on its next write. A flood then waits in the shell instead
//! of piling up in the webview's memory.

use std::sync::{Condvar, Mutex};

/// Stop reading once this many bytes are sent but not yet acknowledged...
pub const HIGH_WATER: usize = 512 * 1024;
/// ...and resume once the UI has caught up to this.
pub const LOW_WATER: usize = 128 * 1024;

#[derive(Default)]
pub struct Flow {
    state: Mutex<State>,
    resumed: Condvar,
}

#[derive(Default)]
struct State {
    unacked: usize,
    paused: bool,
    closed: bool,
}

impl Flow {
    /// Records bytes handed to the UI.
    pub fn sent(&self, bytes: usize) {
        let mut state = self.state.lock().unwrap();
        state.unacked += bytes;
        if state.unacked >= HIGH_WATER {
            state.paused = true;
        }
    }

    /// Records bytes the UI has processed; resumes reading below the low-water mark.
    pub fn ack(&self, bytes: usize) {
        let mut state = self.state.lock().unwrap();
        state.unacked = state.unacked.saturating_sub(bytes);
        if state.paused && state.unacked <= LOW_WATER {
            state.paused = false;
            self.resumed.notify_all();
        }
    }

    /// Blocks the reader while paused. After `close` it never blocks again, so the
    /// reader drains the pipe to EOF: closing a pseudoconsole can hang while its
    /// output pipe is full.
    pub fn wait_until_ready(&self) {
        let mut state = self.state.lock().unwrap();
        while state.paused && !state.closed {
            state = self.resumed.wait(state).unwrap();
        }
    }

    pub fn close(&self) {
        self.state.lock().unwrap().closed = true;
        self.resumed.notify_all();
    }

    #[cfg(test)]
    pub fn is_paused(&self) -> bool {
        self.state.lock().unwrap().paused
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use std::thread;
    use std::time::Duration;

    #[test]
    fn pauses_at_high_water_and_resumes_at_low_water() {
        let flow = Flow::default();
        flow.sent(HIGH_WATER - 1);
        assert!(!flow.is_paused());
        flow.sent(1);
        assert!(flow.is_paused());

        flow.ack(HIGH_WATER - LOW_WATER - 1);
        assert!(flow.is_paused(), "still above low water");
        flow.ack(1);
        assert!(!flow.is_paused());
    }

    #[test]
    fn ack_never_underflows() {
        let flow = Flow::default();
        flow.ack(10);
        flow.sent(HIGH_WATER);
        assert!(flow.is_paused(), "a stray ack must not hide real backlog");
    }

    #[test]
    fn a_waiting_reader_wakes_on_ack_and_on_close() {
        for wake in [|f: &Flow| f.ack(HIGH_WATER), |f: &Flow| f.close()] {
            let flow = Arc::new(Flow::default());
            flow.sent(HIGH_WATER);
            let reader = {
                let flow = Arc::clone(&flow);
                thread::spawn(move || flow.wait_until_ready())
            };
            thread::sleep(Duration::from_millis(50));
            assert!(!reader.is_finished(), "reader should be blocked");
            wake(&flow);
            reader.join().unwrap();
        }
    }

    #[test]
    fn a_closed_flow_never_blocks() {
        let flow = Flow::default();
        flow.close();
        flow.sent(HIGH_WATER * 2);
        flow.wait_until_ready();
    }
}
