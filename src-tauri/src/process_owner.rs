//! Every descendant belongs to this instance, including detached shell tools.
//! The sole non-inheritable job handle lives until process termination. Windows
//! closes it even after a crash, ending the entire job rather than only ConPTY.
use std::{
    os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle},
    sync::{Mutex, OnceLock},
};
use windows_sys::Win32::System::{
    JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        JOB_OBJECT_LIMIT_SILENT_BREAKAWAY_OK, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JobObjectExtendedLimitInformation, SetInformationJobObject,
    },
    Threading::GetCurrentProcess,
};

static OWNER: OnceLock<Result<OwnedHandle, String>> = OnceLock::new();
static UPDATE: Mutex<()> = Mutex::new(());

fn limits(job: &OwnedHandle, updating: bool) -> Result<(), String> {
    let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
    info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
        | if updating {
            JOB_OBJECT_LIMIT_SILENT_BREAKAWAY_OK
        } else {
            0
        };
    // SAFETY: a valid owned job handle and correctly sized initialized structure.
    if unsafe {
        SetInformationJobObject(
            job.as_raw_handle(),
            JobObjectExtendedLimitInformation,
            (&info as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
            std::mem::size_of_val(&info) as u32,
        )
    } == 0
    {
        return Err(format!(
            "Could not configure process ownership: {}",
            std::io::Error::last_os_error()
        ));
    }
    Ok(())
}

fn owner() -> Result<&'static OwnedHandle, String> {
    OWNER
        .get_or_init(|| {
            // SAFETY: unnamed job, default security, handle inheritance disabled.
            let handle = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
            if handle.is_null() {
                return Err(format!(
                    "Could not create process ownership job: {}",
                    std::io::Error::last_os_error()
                ));
            }
            // SAFETY: take ownership of the newly created non-null handle exactly once.
            let job = unsafe { OwnedHandle::from_raw_handle(handle) };
            limits(&job, false)?;
            // Associate before creating children; assigning an already running shell
            // would leave a race in which its early children escape the job.
            // SAFETY: valid job and current-process pseudo handle.
            if unsafe { AssignProcessToJobObject(job.as_raw_handle(), GetCurrentProcess()) } == 0 {
                return Err(format!(
                    "Could not establish process ownership: {}",
                    std::io::Error::last_os_error()
                ));
            }
            Ok(job)
        })
        .as_ref()
        .map_err(Clone::clone)
}

pub fn ensure() -> Result<(), String> {
    owner().map(|_| ())
}

/// Only a verified update's installer/replacement should survive its old owner.
/// Existing children stay owned. On a launch failure, normal ownership is restored.
pub fn during_update<T>(launch: impl FnOnce() -> Result<T, String>) -> Result<T, String> {
    let _lock = UPDATE.lock().unwrap();
    let job = owner()?;
    limits(job, true)?;
    struct Restore(&'static OwnedHandle);
    impl Drop for Restore {
        fn drop(&mut self) {
            if let Err(error) = limits(self.0, false) {
                crate::qlog!("{error}");
            }
        }
    }
    let _restore = Restore(job);
    launch()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        io::{BufRead, Write},
        os::windows::process::CommandExt,
        process::{Child, Command, Stdio},
    };
    use windows_sys::Win32::{
        Foundation::{WAIT_OBJECT_0, WAIT_TIMEOUT},
        System::Threading::{OpenProcess, PROCESS_SYNCHRONIZE, WaitForSingleObject},
    };

    #[test]
    #[ignore]
    fn ownership_helper() {
        if std::env::var_os("QTERM_OWNERSHIP_HELPER").is_none() {
            return;
        }
        ensure().unwrap();
        let spawn = || {
            Command::new("ping.exe")
                .args(["-n", "100", "127.0.0.1"])
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .creation_flags(0x00000008)
                .spawn()
                .map_err(|e| e.to_string())
        };
        let normal = spawn().unwrap();
        // Also verify a failed update restores normal ownership before the next launch.
        assert!(during_update::<()>(|| Err("failed launch".into())).is_err());
        let after_failure = spawn().unwrap();
        let replacement = during_update(spawn).unwrap();
        println!(
            "CHILDREN={},{},{}",
            normal.id(),
            after_failure.id(),
            replacement.id()
        );
        std::io::stdout().flush().unwrap();
        let mut input = String::new();
        std::io::stdin().read_line(&mut input).unwrap();
        // Child handles close normally; no explicit child kill masks job cleanup.
        drop((normal, after_failure, replacement));
    }

    fn observe(pid: u32) -> OwnedHandle {
        // SAFETY: exact process identity pinned before its owner exits; handle owned.
        let handle = unsafe { OpenProcess(PROCESS_SYNCHRONIZE, 0, pid) };
        assert!(!handle.is_null());
        unsafe { OwnedHandle::from_raw_handle(handle) }
    }
    fn helper() -> (Child, Vec<(u32, OwnedHandle)>) {
        let mut child = Command::new(std::env::current_exe().unwrap())
            .args([
                "--ignored",
                "--exact",
                "process_owner::tests::ownership_helper",
                "--nocapture",
                "--test-threads=1",
            ])
            .env("QTERM_OWNERSHIP_HELPER", "1")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .unwrap();
        let line = std::io::BufReader::new(child.stdout.as_mut().unwrap())
            .lines()
            .map_while(Result::ok)
            .find_map(|line| line.split("CHILDREN=").nth(1).map(str::to_owned))
            .expect("helper children");
        let handles = line
            .split(',')
            .map(|s| s.parse::<u32>().unwrap())
            .map(|pid| (pid, observe(pid)))
            .collect();
        (child, handles)
    }
    fn check(crash: bool) {
        let (mut child, handles) = helper();
        if crash {
            child.kill().unwrap();
        } else {
            writeln!(child.stdin.take().unwrap(), "exit").unwrap();
        }
        child.wait().unwrap();
        // SAFETY: handles are live and non-inheritable throughout the waits.
        let wait =
            |at: usize, ms| unsafe { WaitForSingleObject(handles[at].1.as_raw_handle(), ms) };
        assert_eq!(
            wait(0, 10000),
            WAIT_OBJECT_0,
            "detached tool outlived qterm"
        );
        assert_eq!(
            wait(1, 10000),
            WAIT_OBJECT_0,
            "failed update left breakaway enabled"
        );
        assert_eq!(wait(2, 0), WAIT_TIMEOUT, "replacement died with old qterm");
        // Cleanup only the known replacement, which is deliberately outside the job.
        let processes = crate::procs::snapshot();
        crate::procs::terminate(&crate::procs::tree_of(&processes, handles[2].0));
        assert_eq!(wait(2, 10000), WAIT_OBJECT_0);
    }
    #[test]
    fn crash_ends_detached_tools_but_preserves_the_update_replacement() {
        check(true);
    }
    #[test]
    fn normal_exit_ends_detached_tools_but_preserves_the_update_replacement() {
        check(false);
    }
}
