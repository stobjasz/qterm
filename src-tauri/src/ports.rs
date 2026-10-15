//! Who listens on which TCP port: Windows' TCP tables (IPv4 and IPv6) with the owning
//! process ids, for "Who uses this port?" and for dev server links that last only while
//! their server listens.

use std::net::{Ipv4Addr, Ipv6Addr};

use serde::Serialize;

use crate::procs::Process;

/// A listening socket.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Listener {
    pub port: u16,
    pub pid: u32,
    /// "127.0.0.1", "::", ...
    pub address: String,
}

/// A port and what holds it, as the palette lists it.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PortOwner {
    pub port: u16,
    pub pid: u32,
    /// Executable name ("node.exe"); "" when the process is gone or hidden.
    pub process: String,
    /// Every address it listens on for that port.
    pub addresses: Vec<String>,
    /// The qterm pane session whose shell it runs under, if any.
    pub session_id: Option<crate::pty::SessionId>,
}

const AF_INET: u32 = 2;
const AF_INET6: u32 = 23;
const ERROR_INSUFFICIENT_BUFFER: u32 = 122;

/// Every listening TCP socket (IPv4 and IPv6). Empty if Windows won't say.
pub fn listeners() -> Vec<Listener> {
    use windows_sys::Win32::NetworkManagement::IpHelper::{MIB_TCP6ROW_OWNER_PID, MIB_TCPROW_OWNER_PID};

    let mut found = Vec::new();
    if let Some(buffer) = tcp_table(AF_INET) {
        // SAFETY: the table starts with its entry count, followed by that many rows, all
        // inside `buffer` (sized by Windows); the buffer is u32-aligned.
        unsafe {
            let count = *(buffer.as_ptr()) as usize;
            let rows = buffer.as_ptr().add(1) as *const MIB_TCPROW_OWNER_PID;
            for i in 0..count {
                let row = &*rows.add(i);
                found.push(Listener {
                    port: port_of(row.dwLocalPort),
                    pid: row.dwOwningPid,
                    address: Ipv4Addr::from(u32::from_be(row.dwLocalAddr)).to_string(),
                });
            }
        }
    }
    if let Some(buffer) = tcp_table(AF_INET6) {
        // SAFETY: as above, with the IPv6 row layout.
        unsafe {
            let count = *(buffer.as_ptr()) as usize;
            let rows = buffer.as_ptr().add(1) as *const MIB_TCP6ROW_OWNER_PID;
            for i in 0..count {
                let row = &*rows.add(i);
                found.push(Listener { port: port_of(row.dwLocalPort), pid: row.dwOwningPid, address: Ipv6Addr::from(row.ucLocalAddr).to_string() });
            }
        }
    }
    found
}

/// The port as Windows stores it: network byte order in the low 16 bits.
fn port_of(raw: u32) -> u16 {
    u16::from_be((raw & 0xffff) as u16)
}

/// The listener table of one address family, as raw u32 words.
fn tcp_table(family: u32) -> Option<Vec<u32>> {
    use windows_sys::Win32::NetworkManagement::IpHelper::{GetExtendedTcpTable, TCP_TABLE_OWNER_PID_LISTENER};

    let mut size = 0u32;
    // The table can grow between asking for its size and reading it: try a few times.
    for _ in 0..4 {
        let mut buffer = vec![0u32; (size as usize).div_ceil(4).max(1)];
        let mut bytes = (buffer.len() * 4) as u32;
        // SAFETY: `buffer` holds `bytes` writable bytes; Windows writes at most that much
        // and reports the size it needs otherwise.
        let result = unsafe { GetExtendedTcpTable(buffer.as_mut_ptr().cast(), &mut bytes, 0, family, TCP_TABLE_OWNER_PID_LISTENER, 0) };
        match result {
            0 => return Some(buffer),
            ERROR_INSUFFICIENT_BUFFER => size = bytes,
            _ => return None,
        }
    }
    None
}

/// The listeners grouped by port and process, with each process's name and the pane
/// session (from `shells`: session → its shell's pid) it runs under. Sorted by port.
pub fn owners(listeners: &[Listener], processes: &[Process], shells: &[(crate::pty::SessionId, u32)]) -> Vec<PortOwner> {
    let mut owners: Vec<PortOwner> = Vec::new();
    for listener in listeners {
        match owners.iter_mut().find(|o| o.port == listener.port && o.pid == listener.pid) {
            Some(owner) => {
                if !owner.addresses.contains(&listener.address) {
                    owner.addresses.push(listener.address.clone());
                }
            }
            None => owners.push(PortOwner {
                port: listener.port,
                pid: listener.pid,
                process: processes.iter().find(|p| p.pid == listener.pid).map(|p| p.name.clone()).unwrap_or_default(),
                addresses: vec![listener.address.clone()],
                session_id: shells
                    .iter()
                    .find(|(_, shell)| crate::procs::is_below(processes, *shell, listener.pid))
                    .map(|(id, _)| *id),
            }),
        }
    }
    owners.sort_by_key(|o| (o.port, o.pid));
    owners
}

#[cfg(test)]
mod tests {
    use super::*;

    fn p(pid: u32, parent: u32, name: &str) -> Process {
        Process { pid, parent, name: name.into() }
    }

    #[test]
    fn groups_by_port_and_process_and_finds_the_pane() {
        let processes = [p(10, 1, "pwsh.exe"), p(11, 10, "pnpm.exe"), p(12, 11, "node.exe"), p(20, 1, "svchost.exe")];
        let listeners = [
            Listener { port: 5173, pid: 12, address: "127.0.0.1".into() },
            Listener { port: 5173, pid: 12, address: "::1".into() },
            Listener { port: 135, pid: 20, address: "0.0.0.0".into() },
        ];
        let owners = owners(&listeners, &processes, &[(7, 10)]);
        assert_eq!(owners.len(), 2);
        assert_eq!(owners[0].port, 135);
        assert_eq!(owners[0].session_id, None);
        assert_eq!(owners[1].process, "node.exe");
        assert_eq!(owners[1].addresses, ["127.0.0.1", "::1"]);
        assert_eq!(owners[1].session_id, Some(7), "node runs below the pane's shell");
    }

    #[test]
    fn finds_a_port_this_test_listens_on() {
        let socket = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = socket.local_addr().unwrap().port();
        let me = std::process::id();
        let found = listeners();
        assert!(found.iter().any(|l| l.port == port && l.pid == me && l.address == "127.0.0.1"), "port {port} not in {} listeners", found.len());
        drop(socket);
    }

    #[test]
    fn reads_ports_in_network_order() {
        // 5173 = 0x1435, stored as the bytes 0x14 0x35.
        assert_eq!(port_of(u32::from(u16::from_ne_bytes([0x14, 0x35]))), 5173);
    }
}
