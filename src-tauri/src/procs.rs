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

/// Console plumbing that runs under a shell without being anything the user started.
const HELPERS: [&str; 4] = ["conhost.exe", "openconsole.exe", "wslhost.exe", "wslrelay.exe"];

/// The programs running below `root` (not `root` itself), each once, in the order found,
/// leaving out console helpers.
pub fn programs_below(processes: &[Process], root: u32) -> Vec<String> {
    let mut children: HashMap<u32, Vec<&Process>> = HashMap::new();
    for p in processes {
        if p.pid != p.parent {
            children.entry(p.parent).or_default().push(p);
        }
    }
    let mut found = Vec::new();
    let mut seen = HashSet::new();
    let mut stack = vec![root];
    while let Some(pid) = stack.pop() {
        if !seen.insert(pid) {
            continue;
        }
        for child in children.get(&pid).into_iter().flatten() {
            if !HELPERS.contains(&child.name.as_str()) && !found.contains(&child.name) {
                found.push(child.name.clone());
            }
            stack.push(child.pid);
        }
    }
    found
}

/// Everything running below `root` (not `root` itself, nor console helpers), each
/// process after the ones it started: the order to end them in.
pub fn tree_below(processes: &[Process], root: u32) -> Vec<&Process> {
    let mut children: HashMap<u32, Vec<&Process>> = HashMap::new();
    for p in processes {
        if p.pid != p.parent {
            children.entry(p.parent).or_default().push(p);
        }
    }
    let mut order = Vec::new();
    let mut seen = HashSet::from([root]);
    // Depth first; a process goes in after its whole subtree.
    let mut stack: Vec<(&Process, bool)> = children.get(&root).into_iter().flatten().map(|p| (*p, false)).collect();
    while let Some((process, expanded)) = stack.pop() {
        if expanded {
            order.push(process);
            continue;
        }
        if HELPERS.contains(&process.name.as_str()) || !seen.insert(process.pid) {
            continue;
        }
        stack.push((process, true));
        stack.extend(children.get(&process.pid).into_iter().flatten().map(|p| (*p, false)));
    }
    order
}

/// Whether `pid` is `root` or runs anywhere below it (its chain of parents reaches `root`).
pub fn is_below(processes: &[Process], root: u32, pid: u32) -> bool {
    let parents: HashMap<u32, u32> = processes.iter().filter(|p| p.pid != p.parent).map(|p| (p.pid, p.parent)).collect();
    let mut seen = HashSet::new();
    let mut current = pid;
    loop {
        if current == root {
            return true;
        }
        // Windows reuses ids, so a chain can loop: give up on a pid seen before.
        if !seen.insert(current) {
            return false;
        }
        match parents.get(&current) {
            Some(&parent) => current = parent,
            None => return false,
        }
    }
}

/// `pid` and everything it started, in the order to end them (children first).
pub fn tree_of(processes: &[Process], pid: u32) -> Vec<&Process> {
    let mut order = tree_below(processes, pid);
    order.extend(processes.iter().find(|p| p.pid == pid));
    order
}

/// Ends these processes; returns the names of the ones that ended, each once.
pub fn terminate(processes: &[&Process]) -> Vec<String> {
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::Threading::{OpenProcess, TerminateProcess, PROCESS_TERMINATE};

    let mut ended: Vec<String> = Vec::new();
    for process in processes {
        // SAFETY: the handle is checked before use and closed after.
        let ok = unsafe {
            let handle = OpenProcess(PROCESS_TERMINATE, 0, process.pid);
            if handle.is_null() {
                false
            } else {
                let ok = TerminateProcess(handle, 1) != 0;
                CloseHandle(handle);
                ok
            }
        };
        if ok && !ended.contains(&process.name) {
            ended.push(process.name.clone());
        }
    }
    ended
}

#[cfg(test)]
mod tests {
    use super::*;

    fn p(pid: u32, parent: u32, name: &str) -> Process {
        Process { pid, parent, name: name.into() }
    }

    #[test]
    fn lists_what_runs_below_the_shell_without_console_helpers() {
        let processes = [
            p(10, 1, "pwsh.exe"),
            p(11, 10, "conhost.exe"),
            p(12, 10, "node.exe"),
            p(13, 12, "node.exe"),
            p(14, 12, "esbuild.exe"),
            p(20, 1, "cmd.exe"),
        ];
        assert_eq!(programs_below(&processes, 10), ["node.exe", "esbuild.exe"]);
        assert!(programs_below(&processes, 20).is_empty(), "an idle shell runs nothing");
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
    fn the_tree_below_the_shell_ends_children_before_their_parents() {
        let processes = [
            p(10, 1, "pwsh.exe"),
            p(11, 10, "conhost.exe"),
            p(12, 10, "node.exe"),
            p(13, 12, "esbuild.exe"),
            p(14, 13, "esbuild-worker.exe"),
            p(15, 10, "git.exe"),
            p(20, 1, "cmd.exe"),
        ];
        let order: Vec<u32> = tree_below(&processes, 10).iter().map(|p| p.pid).collect();
        let at = |pid| order.iter().position(|&p| p == pid).unwrap();
        assert_eq!(order.len(), 4, "the shell, console helpers and other trees stay: {order:?}");
        assert!(at(14) < at(13) && at(13) < at(12), "children first: {order:?}");
        assert!(tree_below(&processes, 20).is_empty());
    }

    #[test]
    fn knows_what_runs_below_a_shell_by_its_parents() {
        let processes = [p(10, 1, "pwsh.exe"), p(11, 10, "pnpm.exe"), p(12, 11, "node.exe"), p(20, 21, "a.exe"), p(21, 20, "b.exe")];
        assert!(is_below(&processes, 10, 12));
        assert!(is_below(&processes, 10, 10), "the shell itself counts");
        assert!(!is_below(&processes, 11, 10));
        assert!(!is_below(&processes, 10, 20), "a loop of reused ids ends");
        let order: Vec<u32> = tree_of(&processes, 11).iter().map(|p| p.pid).collect();
        assert_eq!(order, [12, 11], "what it started, then itself");
    }

    #[test]
    fn the_snapshot_contains_this_process() {
        let me = std::process::id();
        assert!(snapshot().iter().any(|p| p.pid == me));
    }
}
