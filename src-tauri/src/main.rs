// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Claude Code's Notification hook runs the exe in this mode: hand the alert to
    // the running qterm and exit, without ever starting a window.
    let args: Vec<String> = std::env::args().collect();
    if args.get(1).map(String::as_str) == Some(qterm_lib::HOOK_ARG) {
        return qterm_lib::run_claude_hook();
    }
    // Started by a portable self-update: let the old process finish first.
    qterm_lib::wait_for_previous(&args);
    qterm_lib::run()
}
