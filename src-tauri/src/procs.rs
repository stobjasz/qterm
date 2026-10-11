//! Which programs run inside a pane: a Windows process snapshot, walked from the
//! pane's shell down through its children.

use std::collections::{HashMap, HashSet};

pub struct Process {
    pub pid: u32,
    pub parent: u32,
    /// Executable file name, lower-cased ("claude.exe").
    pub name: String,
}

/// All running processes (one ToolHelp snapshot). Empty if the snapshot fails.
pub fn snapshot() -> Vec<Process> {
    use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
    };

    let mut processes = Vec::new();
    // SAFETY: the snapshot handle is checked and closed; the entry struct is sized as
    // the API requires before each call.
    unsafe {
        let snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if snap == INVALID_HANDLE_VALUE || snap.is_null() {
            return processes;
        }
        let mut entry: PROCESSENTRY32W = std::mem::zeroed();
        entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
        let mut ok = Process32FirstW(snap, &mut entry);
        while ok != 0 {
            let len = entry.szExeFile.iter().position(|&c| c == 0).unwrap_or(entry.szExeFile.len());
            processes.push(Process {
                pid: entry.th32ProcessID,
                parent: entry.th32ParentProcessID,
                name: String::from_utf16_lossy(&entry.szExeFile[..len]).to_lowercase(),
            });
            ok = Process32NextW(snap, &mut entry);
        }
        CloseHandle(snap);
    }
    processes
}

/// Whether a process named `name` is `root` or runs anywhere below it.
pub fn runs_below(processes: &[Process], root: u32, name: &str) -> bool {
    let mut children: HashMap<u32, Vec<&Process>> = HashMap::new();
    for p in processes {
        // A process can't be its own parent; Windows reuses ids, so guard anyway.
        if p.pid != p.parent {
            children.entry(p.parent).or_default().push(p);
        }
    }
    let mut seen = HashSet::new();
    let mut stack = vec![root];
    while let Some(pid) = stack.pop() {
        if !seen.insert(pid) {
            continue;
        }
        if processes.iter().any(|p| p.pid == pid && p.name == name) {
            return true;
        }
        stack.extend(children.get(&pid).into_iter().flatten().map(|p| p.pid));
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    fn p(pid: u32, parent: u32, name: &str) -> Process {
        Process { pid, parent, name: name.into() }
    }

    #[test]
    fn finds_a_program_anywhere_below_the_shell() {
        let table = [p(10, 1, "pwsh.exe"), p(11, 10, "node.exe"), p(12, 11, "claude.exe"), p(20, 1, "claude.exe")];
        assert!(runs_below(&table, 10, "claude.exe"));
        assert!(!runs_below(&table, 11, "pwsh.exe"));
        assert!(runs_below(&table, 12, "claude.exe"), "the root itself counts");
    }

    #[test]
    fn ignores_other_trees_and_survives_id_cycles() {
        let table = [p(10, 1, "pwsh.exe"), p(20, 21, "cmd.exe"), p(21, 20, "claude.exe")];
        assert!(!runs_below(&table, 10, "claude.exe"));
        assert!(runs_below(&table, 20, "claude.exe"));
    }

    #[test]
    fn the_snapshot_contains_this_process() {
        let me = std::process::id();
        assert!(snapshot().iter().any(|p| p.pid == me));
    }
}
