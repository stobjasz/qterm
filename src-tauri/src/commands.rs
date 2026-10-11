//! IPC surface. Thin wrappers only; the logic lives in the modules they call.

use serde::Serialize;
use tauri::ipc::{Channel, Response};
use tauri::{AppHandle, Emitter, State};

use crate::pty::{Profile, SessionId, SessionManager};
use crate::window;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PtyExit {
    id: SessionId,
    code: u32,
}

/// Async so the first call, which detects profiles, runs off the main thread.
#[tauri::command]
pub async fn list_profiles(sessions: State<'_, SessionManager>) -> Result<Vec<Profile>, String> {
    Ok(sessions.profiles().to_vec())
}

#[tauri::command]
pub async fn pty_spawn(
    app: AppHandle,
    sessions: State<'_, SessionManager>,
    profile_id: Option<String>,
    cols: u16,
    rows: u16,
    on_output: Channel<Response>,
) -> Result<SessionId, String> {
    sessions.spawn_profile(
        profile_id.as_deref(),
        cols,
        rows,
        // Raw bytes reach the UI as an ArrayBuffer, with no JSON/base64 encoding.
        move |bytes| on_output.send(Response::new(bytes)).is_ok(),
        move |id, code| {
            let _ = app.emit("pty-exit", PtyExit { id, code });
        },
    )
}

#[tauri::command]
pub fn pty_write(sessions: State<'_, SessionManager>, id: SessionId, data: String) -> Result<(), String> {
    sessions.write(id, &data)
}

#[tauri::command]
pub fn pty_resize(
    sessions: State<'_, SessionManager>,
    id: SessionId,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    sessions.resize(id, cols, rows)
}

#[tauri::command]
pub fn pty_kill(sessions: State<'_, SessionManager>, id: SessionId) {
    sessions.kill(id);
}

#[tauri::command]
pub fn hide_window(app: AppHandle) {
    window::dismiss(&app);
}
