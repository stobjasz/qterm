//! Current-user-only, local, cancellable pipe transport. No listener before a grant.
use std::{
    fs::File,
    io::{self, Write},
    os::windows::{
        ffi::OsStrExt,
        io::{FromRawHandle, OwnedHandle},
    },
    path::Path,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::windows::named_pipe::{ClientOptions, NamedPipeServer, ServerOptions},
    sync::Semaphore,
    time::timeout,
};
use windows_sys::Win32::{
    Foundation::{GENERIC_READ, GENERIC_WRITE, INVALID_HANDLE_VALUE, LocalFree},
    Security::{
        Authorization::{
            ConvertSidToStringSidW, ConvertStringSecurityDescriptorToSecurityDescriptorW,
        },
        Cryptography::{BCRYPT_USE_SYSTEM_PREFERRED_RNG, BCryptGenRandom},
        GetTokenInformation, SECURITY_ATTRIBUTES, TOKEN_QUERY, TOKEN_USER, TokenUser,
    },
    Storage::FileSystem::{
        CREATE_NEW, CreateFileW, DELETE, FILE_FLAG_DELETE_ON_CLOSE, FILE_SHARE_DELETE,
        FILE_SHARE_READ,
    },
    System::Threading::{GetCurrentProcess, OpenProcessToken},
};

const REQUEST_LIMIT: usize = 64 * 1024;
const RESPONSE_LIMIT: usize = 512 * 1024;
pub fn random() -> Result<String, String> {
    let mut bytes = [0u8; 32];
    // SAFETY: writable buffer, null provider selects the system RNG.
    if unsafe {
        BCryptGenRandom(
            std::ptr::null_mut(),
            bytes.as_mut_ptr(),
            bytes.len() as u32,
            BCRYPT_USE_SYSTEM_PREFERRED_RNG,
        )
    } < 0
    {
        return Err("Windows random generator unavailable".into());
    }
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}
struct Descriptor(*mut std::ffi::c_void);
impl Drop for Descriptor {
    fn drop(&mut self) {
        unsafe {
            LocalFree(self.0);
        }
    }
}
impl Descriptor {
    fn current_user() -> io::Result<Self> {
        let mut handle = std::ptr::null_mut();
        // SAFETY: current process pseudo-handle and initialized output pointer.
        if unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut handle) } == 0 {
            return Err(io::Error::last_os_error());
        }
        let _token = unsafe { OwnedHandle::from_raw_handle(handle) };
        let mut size = 0;
        unsafe {
            GetTokenInformation(handle, TokenUser, std::ptr::null_mut(), 0, &mut size);
        }
        if size == 0 || size > 65536 {
            return Err(io::Error::other("Invalid user token size"));
        }
        let mut buffer = vec![0usize; (size as usize).div_ceil(std::mem::size_of::<usize>())];
        if unsafe {
            GetTokenInformation(
                handle,
                TokenUser,
                buffer.as_mut_ptr().cast(),
                size,
                &mut size,
            )
        } == 0
        {
            return Err(io::Error::last_os_error());
        }
        // SAFETY: buffer is aligned and contains the TOKEN_USER from Windows.
        let user = unsafe { &*buffer.as_ptr().cast::<TOKEN_USER>() };
        let mut sid = std::ptr::null_mut();
        if unsafe { ConvertSidToStringSidW(user.User.Sid, &mut sid) } == 0 {
            return Err(io::Error::last_os_error());
        }
        let allocation = Descriptor(sid.cast());
        let mut len = 0;
        while len < 256 && unsafe { *sid.add(len) } != 0 {
            len += 1;
        }
        if len == 256 {
            return Err(io::Error::other("Invalid user SID"));
        }
        let sid = String::from_utf16(unsafe { std::slice::from_raw_parts(sid, len) })
            .map_err(io::Error::other)?;
        drop(allocation);
        let sddl: Vec<u16> = format!("D:P(A;;GA;;;{sid})")
            .encode_utf16()
            .chain(Some(0))
            .collect();
        let mut descriptor = std::ptr::null_mut();
        if unsafe {
            ConvertStringSecurityDescriptorToSecurityDescriptorW(
                sddl.as_ptr(),
                1,
                &mut descriptor,
                std::ptr::null_mut(),
            )
        } == 0
        {
            return Err(io::Error::last_os_error());
        }
        Ok(Self(descriptor))
    }
    fn attributes(&self) -> SECURITY_ATTRIBUTES {
        SECURITY_ATTRIBUTES {
            nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
            lpSecurityDescriptor: self.0,
            bInheritHandle: 0,
        }
    }
}
fn server(name: &str, first: bool) -> io::Result<NamedPipeServer> {
    let descriptor = Descriptor::current_user()?;
    let mut attributes = descriptor.attributes();
    // SAFETY: descriptor/attributes live through creation; Tokio owns the new handle.
    unsafe {
        ServerOptions::new()
            .first_pipe_instance(first)
            .reject_remote_clients(true)
            .max_instances(9)
            .in_buffer_size(REQUEST_LIMIT as u32)
            .out_buffer_size(RESPONSE_LIMIT as u32)
            .create_with_security_attributes_raw(
                name,
                (&mut attributes as *mut SECURITY_ATTRIBUTES).cast(),
            )
    }
}
/// The owner retains this file handle. Windows deletes credentials on close, even
/// after a crash. Readers must share deletion; the CLI's ordinary File::open does.
pub fn credentials(path: &Path, bytes: &[u8]) -> Result<File, String> {
    owned_file(path,bytes)
}
/// Immutable current-user file, with a non-inheritable owner handle and automatic
/// removal after normal close or a crash. Used for credentials and WSL lifetime.
pub(crate) fn owned_file(path: &Path, bytes: &[u8]) -> Result<File, String> {
    let descriptor = Descriptor::current_user().map_err(|e| e.to_string())?;
    let attributes = descriptor.attributes();
    let name: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
    let handle = unsafe {
        CreateFileW(
            name.as_ptr(),
            GENERIC_READ | GENERIC_WRITE | DELETE,
            FILE_SHARE_READ | FILE_SHARE_DELETE,
            &attributes,
            CREATE_NEW,
            FILE_FLAG_DELETE_ON_CLOSE,
            std::ptr::null_mut(),
        )
    };
    if handle == INVALID_HANDLE_VALUE {
        return Err(format!(
            "Could not create private owned file: {}",
            io::Error::last_os_error()
        ));
    }
    let mut file = unsafe { File::from_raw_handle(handle) };
    file.write_all(bytes)
        .and_then(|()| file.flush())
        .map_err(|e| e.to_string())?;
    Ok(file)
}
pub struct Listener {
    pub name: String,
    stop: Arc<AtomicBool>,
}
impl Drop for Listener {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Release);
    }
}
impl Listener {
    pub fn is_running(&self) -> bool {
        !self.stop.load(Ordering::Acquire)
    }
    pub fn start(
        handler: Arc<dyn Fn(serde_json::Value) -> serde_json::Value + Send + Sync>,
    ) -> Result<Self, String> {
        let name = format!(r"\\.\pipe\qterm-agent-{}", random()?);
        let stop = Arc::new(AtomicBool::new(false));
        let stopping = stop.clone();
        let pipe = name.clone();
        let (ready, receive) = std::sync::mpsc::sync_channel(1);
        std::thread::spawn(move || {
            let runtime = match tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
            {
                Ok(r) => r,
                Err(e) => {
                    let _ = ready.send(Err(e.to_string()));
                    return;
                }
            };
            let ended = stopping.clone();
            runtime.block_on(async move {
                let mut listening = match server(&pipe, true) { Ok(s) => s, Err(e) => { let _ = ready.send(Err(e.to_string())); return; } };
                let _ = ready.send(Ok(()));
                let slots = Arc::new(Semaphore::new(8));
                while !stopping.load(Ordering::Acquire) {
                    match timeout(Duration::from_millis(250), listening.connect()).await {
                        Err(_) => continue,
                        Ok(Err(_)) => break,
                        Ok(Ok(())) => {},
                    }
                    let connected = listening;
                    listening = match server(&pipe, false) { Ok(s) => s, Err(_) => break };
                    let Ok(slot) = slots.clone().try_acquire_owned() else { drop(connected); continue; };
                    let handler = handler.clone();
                    tokio::spawn(async move {
                        let slot = Arc::new(slot);
                        let work_slot = slot.clone();
                        let _slot = slot;
                        let _ = timeout(Duration::from_secs(15), async move {
                            let mut pipe = connected;
                            let bytes = read_frame(&mut pipe, REQUEST_LIMIT).await?;
                            let request: serde_json::Value = serde_json::from_slice(&bytes).map_err(io::Error::other)?;
                            // An I/O timeout cannot cancel a running filesystem
                            // operation. Keep its permit until the worker exits.
                            let result = tokio::task::spawn_blocking(move || { let _slot = work_slot; handler(request) }).await.map_err(io::Error::other)?;
                            let mut output = serde_json::to_vec(&result).map_err(io::Error::other)?;
                            if output.len() > RESPONSE_LIMIT { output = br#"{"version":1,"error":{"code":"response_too_large","message":"Use a smaller page limit"}}"#.to_vec(); }
                            write_frame(&mut pipe, &output).await
                        }).await;
                    });
                }
            });
            ended.store(true, Ordering::Release);
            // Accepted blocking handlers are bounded by their domain operations;
            // shutdown does not leave an unbounded runtime worker behind.
            runtime.shutdown_timeout(Duration::from_secs(1));
        });
        match receive.recv_timeout(Duration::from_secs(5)) {
            Ok(Ok(())) => {}
            Ok(Err(message)) => {
                stop.store(true, Ordering::Release);
                return Err(message);
            }
            Err(_) => {
                stop.store(true, Ordering::Release);
                return Err("Agent listener did not start".into());
            }
        }
        Ok(Self { name, stop })
    }
}
async fn read_frame(
    reader: &mut (impl tokio::io::AsyncRead + Unpin),
    limit: usize,
) -> io::Result<Vec<u8>> {
    let size = reader.read_u32_le().await? as usize;
    if size == 0 || size > limit {
        return Err(io::Error::other("Invalid agent frame length"));
    }
    let mut bytes = vec![0; size];
    reader.read_exact(&mut bytes).await?;
    Ok(bytes)
}
async fn write_frame(
    writer: &mut (impl tokio::io::AsyncWrite + Unpin),
    bytes: &[u8],
) -> io::Result<()> {
    writer.write_u32_le(bytes.len() as u32).await?;
    writer.write_all(bytes).await?;
    writer.flush().await
}
pub fn call(name: &str, request: &serde_json::Value) -> Result<serde_json::Value, String> {
    if !name.starts_with(r"\\.\pipe\qterm-agent-")
        || name.len() != r"\\.\pipe\qterm-agent-".len() + 64
        || name[r"\\.\pipe\qterm-agent-".len()..]
            .chars()
            .any(|c| !c.is_ascii_hexdigit())
    {
        return Err("Invalid local qterm pipe name".into());
    }
    let bytes = serde_json::to_vec(request).map_err(|e| e.to_string())?;
    if bytes.len() > REQUEST_LIMIT {
        return Err("Agent request exceeds 64 KiB".into());
    }
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|e| e.to_string())?;
    runtime.block_on(async {
        timeout(Duration::from_secs(20), async {
            let mut pipe = loop {
                match ClientOptions::new().open(name) {
                    Ok(p) => break p,
                    Err(e) if e.raw_os_error() == Some(231) => {
                        tokio::time::sleep(Duration::from_millis(20)).await
                    }
                    Err(e) => return Err(e),
                }
            };
            write_frame(&mut pipe, &bytes).await?;
            let bytes = read_frame(&mut pipe, RESPONSE_LIMIT).await?;
            serde_json::from_slice(&bytes).map_err(io::Error::other)
        })
        .await
        .map_err(|_| "Agent request timed out".to_owned())?
        .map_err(|e| format!("Agent connection unavailable: {e}"))
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::repo_state::tests::until;
    use std::os::windows::{io::AsRawHandle, process::CommandExt};
    #[test]
    fn credentials_and_pipe_have_protected_current_user_only_dacls_and_delete_on_close() {
        use windows_sys::Win32::Security::{
            Authorization::{
                ConvertSecurityDescriptorToStringSecurityDescriptorW, GetSecurityInfo,
                SE_FILE_OBJECT,
            },
            DACL_SECURITY_INFORMATION,
        };
        let path = std::env::temp_dir().join(format!("qterm-agent-{}.json", random().unwrap()));
        let file = credentials(&path, b"private").unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"private");
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let _context = runtime.enter();
        let pipe = server(
            &format!(r"\\.\pipe\qterm-agent-{}", random().unwrap()),
            true,
        )
        .unwrap();
        for handle in [file.as_raw_handle(), pipe.as_raw_handle()] {
            let mut descriptor = std::ptr::null_mut();
            let status = unsafe {
                GetSecurityInfo(
                    handle,
                    SE_FILE_OBJECT,
                    DACL_SECURITY_INFORMATION,
                    std::ptr::null_mut(),
                    std::ptr::null_mut(),
                    std::ptr::null_mut(),
                    std::ptr::null_mut(),
                    &mut descriptor,
                )
            };
            assert_eq!(status, 0);
            let _descriptor = Descriptor(descriptor);
            let mut text = std::ptr::null_mut();
            let mut len = 0;
            assert_ne!(
                unsafe {
                    ConvertSecurityDescriptorToStringSecurityDescriptorW(
                        descriptor,
                        1,
                        DACL_SECURITY_INFORMATION,
                        &mut text,
                        &mut len,
                    )
                },
                0
            );
            let _text = Descriptor(text.cast());
            let sddl =
                String::from_utf16(unsafe { std::slice::from_raw_parts(text, len as usize - 1) })
                    .unwrap();
            assert!(sddl.starts_with("D:P"));
            assert_eq!(sddl.matches("(A;").count(), 1);
            assert!(!sddl.contains(";;;WD)"));
            assert!(!sddl.contains(";;;BU)"));
        }
        drop(file);
        assert!(!path.exists());
    }
    #[test]
    fn oversized_frames_and_remote_connection_names_are_rejected_without_allocation() {
        assert!(call(r"\\remote\pipe\qterm-agent-test", &serde_json::json!({})).is_err());
        assert!(
            call(
                &format!(r"\\.\pipe\qterm-agent-{}", "a".repeat(64)),
                &serde_json::json!({"data":"x".repeat(REQUEST_LIMIT)})
            )
            .is_err()
        );
        let listener =
            Listener::start(Arc::new(|_| serde_json::json!({"result":"unexpected"}))).unwrap();
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        runtime.block_on(async {
            let mut pipe = ClientOptions::new().open(&listener.name).unwrap();
            pipe.write_u32_le((REQUEST_LIMIT + 1) as u32).await.unwrap();
            let mut byte = [0];
            let result = timeout(Duration::from_secs(2), pipe.read(&mut byte))
                .await
                .unwrap();
            assert!(result.is_err() || result.unwrap() == 0);
        });
        let huge = Listener::start(Arc::new(
            |_| serde_json::json!({"result":"x".repeat(RESPONSE_LIMIT+1)}),
        ))
        .unwrap();
        assert_eq!(
            call(&huge.name, &serde_json::json!({})).unwrap()["error"]["code"],
            "response_too_large"
        );
    }
    #[test]
    fn crashing_the_credential_owner_removes_its_connection_file() {
        struct Child(std::process::Child);
        impl Drop for Child {
            fn drop(&mut self) {
                let _ = self.0.kill();
                let _ = self.0.wait();
            }
        }
        let path =
            std::env::temp_dir().join(format!("qterm-agent-crash-{}.json", random().unwrap()));
        let child = std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--ignored",
                "--exact",
                "agent_pipe::tests::credential_child",
                "--nocapture",
            ])
            .env("QTERM_TEST_CONNECTION", &path)
            .creation_flags(0x08000000)
            .spawn()
            .unwrap();
        let mut child = Child(child);
        until(|| std::fs::read(&path).is_ok_and(|s| s == b"ready"));
        child.0.kill().unwrap();
        child.0.wait().unwrap();
        until(|| !path.exists());
    }
    #[test]
    #[ignore = "subprocess helper"]
    fn credential_child() {
        let path = std::env::var_os("QTERM_TEST_CONNECTION").expect("subprocess only");
        let _file = credentials(Path::new(&path), b"ready").unwrap();
        loop {
            std::thread::park();
        }
    }
}
