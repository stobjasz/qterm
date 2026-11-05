//! Parent-held, per-pane Windows ownership; attached before the WSL client runs.
use std::{
    os::windows::io::{AsRawHandle, BorrowedHandle, FromRawHandle, OwnedHandle, RawHandle},
    sync::Arc,
    time::{Duration, Instant},
};
use windows_sys::Win32::System::JobObjects::{
    CreateJobObjectW, IsProcessInJob, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JobObjectBasicProcessIdList,
    JobObjectExtendedLimitInformation, QueryInformationJobObject, SetInformationJobObject,
};
use windows_sys::Win32::{
    Foundation::{HANDLE, WAIT_TIMEOUT},
    System::Threading::{
        GetProcessId, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_SYNCHRONIZE,
        PROCESS_TERMINATE, QueryFullProcessImageNameW, TerminateProcess, WaitForSingleObject,
    },
};

#[derive(Clone)]
pub(crate) struct Job {
    handle: Arc<OwnedHandle>,
    client: Option<Arc<OwnedHandle>>,
    transport: Vec<Arc<OwnedHandle>>,
}
struct Member {
    handle: OwnedHandle,
    name: String,
}
pub(crate) struct Stop {
    job: Job,
    first: Vec<Member>,
    deadline: Instant,
}

impl Job {
    pub fn new() -> Result<Self, String> {
        // SAFETY: private unnamed object, non-inheritable handle.
        let raw = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
        if raw.is_null() {
            return Err(std::io::Error::last_os_error().to_string());
        }
        let handle = unsafe { OwnedHandle::from_raw_handle(raw) };
        let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        // SAFETY: valid handle and correctly sized initialized information.
        if unsafe {
            SetInformationJobObject(
                handle.as_raw_handle(),
                JobObjectExtendedLimitInformation,
                (&info as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
                std::mem::size_of_val(&info) as u32,
            )
        } == 0
        {
            return Err(format!(
                "Could not configure Windows pane ownership: {}",
                std::io::Error::last_os_error()
            ));
        }
        Ok(Self {
            handle: Arc::new(handle),
            client: None,
            transport: Vec::new(),
        })
    }

    pub fn handle(&self) -> usize {
        self.handle.as_raw_handle() as usize
    }

    /// Clone the actual CreateProcess handle, never reopen the client by PID.
    pub fn retain_client(&mut self, raw: RawHandle) -> Result<(), String> {
        // SAFETY: portable-pty owns this handle throughout the call.
        self.client = Some(Arc::new(
            unsafe { BorrowedHandle::borrow_raw(raw) }
                .try_clone_to_owned()
                .map_err(|e| e.to_string())?,
        ));
        Ok(())
    }

    fn client(&self) -> Result<u32, String> {
        let client = self
            .client
            .as_ref()
            .ok_or("Windows WSL client identity is unavailable")?;
        if unsafe { WaitForSingleObject(client.as_raw_handle(), 0) } != WAIT_TIMEOUT {
            return Err("The original WSL client has ended; Stop was cancelled".into());
        }
        let pid = unsafe { GetProcessId(client.as_raw_handle()) };
        if pid == 0 {
            return Err(std::io::Error::last_os_error().to_string());
        }
        Ok(pid)
    }

    /// User code is still held by the Linux bootstrap barrier during capture.
    pub fn capture_transport(&mut self) -> Result<(), String> {
        let root = self.client.as_ref().ok_or("Missing original WSL client")?;
        let mut member = 0;
        if unsafe {
            IsProcessInJob(
                root.as_raw_handle(),
                self.handle.as_raw_handle(),
                &mut member,
            )
        } == 0
            || member == 0
        {
            return Err(
                "WSL client was not assigned to its pane job; no user shell was started".into(),
            );
        }
        self.transport = self
            .members(false, Instant::now() + Duration::from_secs(1))?
            .into_iter()
            .map(|m| Arc::new(m.handle))
            .collect();
        Ok(())
    }

    fn ids(&self, deadline: Instant) -> Result<Vec<u32>, String> {
        let header = 8 / std::mem::size_of::<usize>();
        let mut capacity = 32;
        loop {
            if Instant::now() >= deadline {
                return Err("Windows job inspection exceeded its deadline".into());
            }
            let mut buffer = vec![0usize; header + capacity];
            let ok = unsafe {
                QueryInformationJobObject(
                    self.handle.as_raw_handle(),
                    JobObjectBasicProcessIdList,
                    buffer.as_mut_ptr().cast(),
                    std::mem::size_of_val(buffer.as_slice()) as u32,
                    std::ptr::null_mut(),
                )
            };
            let error = std::io::Error::last_os_error();
            // SAFETY: the aligned initialized buffer contains the fixed two-DWORD header.
            let counts = unsafe { std::slice::from_raw_parts(buffer.as_ptr().cast::<u32>(), 2) };
            let assigned = counts[0] as usize;
            let listed = counts[1] as usize;
            if ok != 0 && assigned == listed && listed <= capacity {
                return buffer[header..header + listed]
                    .iter()
                    .map(|pid| {
                        u32::try_from(*pid)
                            .map_err(|_| "Invalid Windows job process identity".into())
                    })
                    .collect();
            }
            if ok == 0 && error.raw_os_error() != Some(234) {
                return Err(format!("Could not inspect Windows pane programs: {error}"));
            }
            if capacity >= 4096 || assigned > 4096 {
                return Err("Windows pane membership exceeded its inspection bound".into());
            }
            capacity = (capacity * 2).max(assigned).min(4096);
        }
    }

    fn members(&self, terminate: bool, deadline: Instant) -> Result<Vec<Member>, String> {
        let client = self.client()?;
        let mut members = Vec::new();
        for pid in self.ids(deadline)? {
            if Instant::now() >= deadline {
                return Err("Windows pane inspection expired".into());
            }
            if pid == client {
                continue;
            }
            let mut protected = false;
            for handle in &self.transport {
                if unsafe { GetProcessId(handle.as_raw_handle()) } == pid
                    && alive(handle.as_raw_handle())?
                {
                    protected = true;
                    break;
                }
            }
            if protected {
                continue;
            }
            let access = PROCESS_QUERY_LIMITED_INFORMATION
                | PROCESS_SYNCHRONIZE
                | if terminate { PROCESS_TERMINATE } else { 0 };
            let raw = unsafe { OpenProcess(access, 0, pid) };
            if raw.is_null() {
                let error = std::io::Error::last_os_error();
                if error.raw_os_error() == Some(87) {
                    continue;
                }
                return Err(format!("Could not open an owned Windows program: {error}"));
            }
            let handle = unsafe { OwnedHandle::from_raw_handle(raw) };
            if !alive(handle.as_raw_handle())? {
                continue;
            }
            let mut member = 0;
            if unsafe {
                IsProcessInJob(
                    handle.as_raw_handle(),
                    self.handle.as_raw_handle(),
                    &mut member,
                )
            } == 0
            {
                return Err(std::io::Error::last_os_error().to_string());
            }
            if member == 0 {
                continue;
            } // The snapshot PID exited/reused before it was pinned.
            let mut text = vec![0u16; 32768];
            let mut size = text.len() as u32;
            if unsafe {
                QueryFullProcessImageNameW(handle.as_raw_handle(), 0, text.as_mut_ptr(), &mut size)
            } == 0
            {
                if !alive(handle.as_raw_handle())? {
                    continue;
                }
                return Err(format!(
                    "Could not identify a Windows pane program: {}",
                    std::io::Error::last_os_error()
                ));
            }
            let image = String::from_utf16_lossy(&text[..size as usize]);
            let name = image
                .rsplit(['\\', '/'])
                .next()
                .unwrap_or("Windows program")
                .chars()
                .filter(|c| !c.is_control())
                .take(256)
                .collect::<String>()
                .to_lowercase();
            members.push(Member { handle, name });
        }
        self.client()?;
        Ok(members)
    }

    pub fn programs(&self) -> Result<Vec<String>, String> {
        Ok(self
            .members(false, Instant::now() + Duration::from_secs(1))?
            .into_iter()
            .map(|m| m.name)
            .collect())
    }

    pub fn prepare_stop(&self) -> Result<Stop, String> {
        let deadline = Instant::now() + Duration::from_secs(5);
        Ok(Stop {
            job: self.clone(),
            first: self.members(true, deadline)?,
            deadline,
        })
    }
}

fn alive(handle: HANDLE) -> Result<bool, String> {
    match unsafe { WaitForSingleObject(handle, 0) } {
        WAIT_TIMEOUT => Ok(true),
        0 => Ok(false),
        _ => Err(std::io::Error::last_os_error().to_string()),
    }
}

impl Stop {
    pub fn finish(self, active: impl Fn() -> bool) -> Result<Vec<String>, String> {
        let deadline = self
            .deadline
            .min(Instant::now() + Duration::from_millis(1500));
        let mut pending = self.first;
        let mut names = Vec::new();
        loop {
            // End programs before their console hosts so WSL's interop relay can
            // restore Linux input processing instead of being killed mid-protocol.
            pending.sort_by_key(|m| m.name == "conhost.exe");
            for member in pending {
                if !active() || Instant::now() >= deadline {
                    return Err("Windows Stop expired or its pane ended".into());
                }
                self.job.client()?;
                if member.name == "conhost.exe" {
                    let remaining = deadline
                        .saturating_duration_since(Instant::now())
                        .as_millis()
                        .min(500) as u32;
                    if unsafe { WaitForSingleObject(member.handle.as_raw_handle(), remaining) } == 0
                    {
                        continue;
                    }
                }
                if alive(member.handle.as_raw_handle())? {
                    let stopped = unsafe { TerminateProcess(member.handle.as_raw_handle(), 1) };
                    let error = std::io::Error::last_os_error();
                    if stopped == 0 {
                        // Linux may already have ended the interop root. Windows
                        // can deny a second termination before its exit event is set.
                        let remaining = deadline
                            .saturating_duration_since(Instant::now())
                            .as_millis()
                            .min(250) as u32;
                        if unsafe { WaitForSingleObject(member.handle.as_raw_handle(), remaining) }
                            != 0
                        {
                            return Err(format!(
                                "Could not end Windows program {}: {error}",
                                member.name
                            ));
                        }
                    }
                }
                if !names.contains(&member.name) {
                    names.push(member.name);
                }
            }
            if !active() || Instant::now() >= deadline {
                return Err("Windows Stop expired or its pane ended".into());
            }
            pending = self.job.members(true, deadline)?;
            if pending.is_empty() {
                return Ok(names);
            }
            std::thread::yield_now();
        }
    }
}
