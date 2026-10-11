// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Claude Code's Notification hook runs the exe in this mode: hand the alert to
    // the running qterm and exit, without ever starting a window.
    if std::env::args().nth(1).as_deref() == Some(qterm_lib::HOOK_ARG) {
        return qterm_lib::run_claude_hook();
    }
    qterm_lib::run()
}
