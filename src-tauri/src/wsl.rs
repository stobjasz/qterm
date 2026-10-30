//! Distribution-specific, bounded data operations. No arbitrary script IPC.
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    io::{Read, Write},
    os::windows::process::CommandExt,
    path::PathBuf,
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicUsize, Ordering},
        mpsc,
    },
    thread,
    time::{Duration, Instant},
};
const SCRIPT: &str = include_str!("wsl_bridge.py");
const OUTPUT: usize = 4 * 1024 * 1024;
static ACTIVE: AtomicUsize = AtomicUsize::new(0);
struct Permit;
impl Drop for Permit {
    fn drop(&mut self) {
        ACTIVE.fetch_sub(1, Ordering::AcqRel);
    }
}
pub(crate) fn program() -> PathBuf {
    std::env::var_os("SystemRoot")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(r"C:\Windows"))
        .join("System32")
        .join("wsl.exe")
}
fn drain(mut input: impl Read) -> Result<Vec<u8>, String> {
    let mut output = vec![];
    let mut buffer = [0; 8192];
    let mut overflow = false;
    loop {
        let count = input.read(&mut buffer).map_err(|e| e.to_string())?;
        if count == 0 {
            break;
        }
        if output.len() + count <= OUTPUT {
            output.extend_from_slice(&buffer[..count]);
        } else {
            overflow = true;
        }
    }
    if overflow {
        Err("WSL output exceeded 4 MiB".into())
    } else {
        Ok(output)
    }
}
fn execute(
    mut command: Command,
    input: Option<Vec<u8>>,
    deadline: Duration,
) -> Result<Vec<u8>, String> {
    ACTIVE
        .try_update(Ordering::AcqRel, Ordering::Acquire, |n| {
            (n < 4).then_some(n + 1)
        })
        .map_err(|_| "Four WSL data operations are already active")?;
    let permit = Permit;
    let (tx, rx) = mpsc::sync_channel(1);
    thread::spawn(move || {
        let _permit = permit;
        let result = (|| {
            let mut child = command
                .creation_flags(0x08000000)
                .stdin(if input.is_some() {
                    Stdio::piped()
                } else {
                    Stdio::null()
                })
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn()
                .map_err(|e| format!("Could not start WSL: {e}"))?;
            let out = child.stdout.take().unwrap();
            let err = child.stderr.take().unwrap();
            let output = thread::spawn(move || drain(out));
            let error = thread::spawn(move || drain(err));
            let writer = input.map(|bytes| {
                let mut stream = child.stdin.take().unwrap();
                thread::spawn(move || stream.write_all(&bytes))
            });
            let end = Instant::now() + deadline;
            let mut expired = false;
            let status = loop {
                match child.try_wait() {
                    Ok(Some(status)) => break status,
                    Ok(None) if Instant::now() < end => thread::sleep(Duration::from_millis(10)),
                    _ => {
                        expired = true;
                        let _ = child.kill();
                        break child.wait().map_err(|e| e.to_string())?;
                    }
                }
            };
            if let Some(writer) = writer {
                let _ = writer.join();
            }
            // Keep the worker permit until all actual I/O ends, even if the caller's
            // observation deadline expires. A slow subsystem cannot leak new workers.
            let output = output.join().map_err(|_| "WSL output reader stopped")??;
            let error = error.join().map_err(|_| "WSL error reader stopped")??;
            if expired {
                return Err("WSL data operation timed out".into());
            }
            if !status.success() {
                return Err(format!(
                    "WSL data operation failed: {}",
                    String::from_utf8_lossy(&error)
                        .chars()
                        .take(2000)
                        .collect::<String>()
                ));
            }
            Ok(output)
        })();
        let _ = tx.send(result);
    });
    rx.recv_timeout(deadline + Duration::from_secs(3))
        .map_err(|_| {
            "WSL data operation did not finish before its observation deadline".to_owned()
        })?
}
pub fn distributions() -> Result<Vec<String>, String> {
    let mut command = Command::new(program());
    command.args(["--list", "--quiet"]);
    let bytes = execute(command, None, Duration::from_secs(10))?;
    Ok(crate::pty::parse_wsl_list(&bytes)
        .into_iter()
        .filter(|s| valid_distribution(s))
        .collect())
}
pub fn valid_distribution(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && !value.starts_with('-')
        && !value
            .chars()
            .any(|c| c.is_control() || "/\\:<>\"|?*".contains(c))
        && value != "."
        && value != ".."
}
fn installed(name: &str) -> Result<String, String> {
    if !valid_distribution(name) {
        return Err("Invalid WSL distribution identity".into());
    }
    distributions()?
        .into_iter()
        .find(|d| d.to_lowercase() == name.to_lowercase())
        .ok_or_else(|| {
            format!(
                "WSL distribution {name} is unavailable; no default distribution was substituted"
            )
        })
}
pub fn profile_distribution(
    profile_id: &str,
    profiles: &[crate::pty::Profile],
) -> Result<Option<String>, String> {
    let profile = profiles
        .iter()
        .find(|p| p.id == profile_id)
        .ok_or("Shell profile is unavailable")?;
    profile.distribution.as_deref().map(installed).transpose()
}
pub fn context(
    profile_id: Option<&str>,
    environment: Option<&str>,
    profiles: &[crate::pty::Profile],
) -> Result<Option<String>, String> {
    match environment {
        Some("native") => Ok(None),
        Some(value) => value
            .strip_prefix("wsl:")
            .ok_or_else(|| "Project/file environment is unknown".into())
            .and_then(|name| installed(name).map(Some)),
        None => profile_id
            .map(|id| profile_distribution(id, profiles))
            .unwrap_or(Ok(None)),
    }
}
pub fn call(distro: &str, request: Value) -> Result<Value, String> {
    let distro = installed(distro)?;
    let bytes = serde_json::to_vec(&request).map_err(|e| e.to_string())?;
    if bytes.len() > 1_048_576 {
        return Err("WSL request exceeds 1 MiB".into());
    }
    let mut command = Command::new(program());
    command.args([
        "--distribution",
        &distro,
        "--exec",
        "/usr/bin/python3",
        "-I",
        "-S",
        "-c",
        SCRIPT,
    ]);
    let output = execute(command, Some(bytes), Duration::from_secs(25))?;
    let response: Value =
        serde_json::from_slice(&output).map_err(|e| format!("Invalid WSL data response: {e}"))?;
    if let Some(error) = response.get("error").and_then(Value::as_str) {
        return Err(error.into());
    }
    response
        .get("result")
        .cloned()
        .ok_or("Missing WSL data result".into())
}
pub fn unc(distro: &str, path: &str) -> Result<String, String> {
    if !valid_distribution(distro)
        || !path.starts_with('/')
        || path.len() > 4096
        || path
            .chars()
            .any(|c| c.is_control() || "\\:<>\"|?*".contains(c))
        || path.split('/').any(|p| p == ".." || p == ".")
    {
        return Err("Invalid distribution-specific Linux path".into());
    }
    Ok(format!(
        r"\\wsl.localhost\{}{}",
        distro,
        path.replace('/', r"\")
    ))
}
fn linux(distro: &str, path: &str) -> Result<String, String> {
    let prefix = format!(r"\\wsl.localhost\{}", distro);
    let tail = path
        .strip_prefix(&prefix)
        .ok_or("File escaped its WSL distribution")?;
    Ok(if tail.is_empty() {
        "/".into()
    } else {
        tail.replace('\\', "/")
    })
}
#[derive(Deserialize)]
struct Folder {
    cwd: String,
    #[serde(default)]
    git: Option<String>,
}
pub fn project(distro: &str, cwd: &str) -> Result<crate::project::ProjectInfo, String> {
    let distro = installed(distro)?;
    let folder: Folder =
        serde_json::from_value(call(&distro, json!({"method":"project","cwd":cwd}))?)
            .map_err(|e| e.to_string())?;
    let root = unc(&distro, &folder.cwd)?;
    let mut info = crate::project::files_info(std::path::Path::new(&root));
    if let Some(tasks) = &mut info.tasks {
        tasks.dir = linux(&distro, &tasks.dir)?;
    }
    if let Some(settings) = &mut info.settings {
        settings.path = linux(&distro, &settings.path)?;
    }
    if let Some(error) = &mut info.settings_error {
        *error = error.replace(
            &format!(r"\\wsl.localhost\{}", distro),
            &format!("{distro}:"),
        );
    }
    info.git = folder.git.as_deref().map(crate::project::parse_status);
    Ok(info)
}
pub fn resolve(distro: &str, cwd: &str, paths: &[String]) -> Result<Vec<Option<String>>, String> {
    let distro = installed(distro)?;
    let result: Vec<Option<String>> = serde_json::from_value(call(
        &distro,
        json!({"method":"resolve","cwd":cwd,"paths":paths}),
    )?)
    .map_err(|e| e.to_string())?;
    result
        .into_iter()
        .map(|p| p.map(|p| unc(&distro, &p)).transpose())
        .collect()
}
pub fn translate(distro: &str, paths: &[String], to_linux: bool) -> Result<Vec<String>, String> {
    if paths.is_empty() || paths.len() > 64 {
        return Err("Expected 1–64 paths for WSL translation".into());
    }
    let distro = installed(distro)?;
    let result: Vec<String> = serde_json::from_value(call(
        &distro,
        json!({"method":"translate","distribution":distro,"paths":paths,"toLinux":to_linux}),
    )?)
    .map_err(|e| e.to_string())?;
    if result.len() != paths.len() {
        return Err("WSL returned a different path count".into());
    }
    if !to_linux {
        for path in &result {
            if !std::path::Path::new(path).is_absolute() || std::fs::metadata(path).is_err() {
                return Err(
                    "The translated Windows path is unavailable; the source pane was kept".into(),
                );
            }
        }
    }
    Ok(result)
}
#[derive(Serialize)]
pub struct Brief {
    pub path: String,
    pub distribution: String,
}
pub fn brief(distro: &str, text: &str) -> Result<Brief, String> {
    let distro = installed(distro)?;
    let result = call(&distro, json!({"method":"brief","text":text}))?;
    let path = result["path"]
        .as_str()
        .ok_or("Missing Linux brief path")?
        .to_owned();
    unc(&distro, &path)?;
    Ok(Brief {
        path,
        distribution: distro,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn distro_paths_preserve_linux_case_and_do_not_become_windows_drive_paths() {
        assert_eq!(
            unc("Ubuntu", "/c/Case/file.py").unwrap(),
            r"\\wsl.localhost\Ubuntu\c\Case\file.py"
        );
        assert_ne!(
            unc("Ubuntu", "/Case/a").unwrap(),
            unc("Ubuntu", "/case/a").unwrap()
        );
        for distro in ["", "..", "Ubuntu/other", "-d", "bad\nname"] {
            assert!(unc(distro, "/work").is_err());
        }
        for path in [
            "relative",
            "/a/../b",
            "/a/./b",
            "/a\\..\\b",
            "/a:stream",
            "/a\nb",
        ] {
            assert!(unc("Ubuntu", path).is_err());
        }
        assert_eq!(
            linux("Ubuntu", r"\\wsl.localhost\Ubuntu\home\User").unwrap(),
            "/home/User"
        );
        assert!(linux("Ubuntu", r"\\wsl.localhost\Other\home\User").is_err());
    }
    #[test]
    fn unknown_context_is_not_treated_as_the_windows_filesystem() {
        assert!(context(None, Some("unknown"), &[]).is_err());
        assert!(context(None, Some("wsl:../elsewhere"), &[]).is_err());
        assert!(context(None, Some("native"), &[]).unwrap().is_none());
    }

    fn python(distro: &str, script: &str, input: Option<Vec<u8>>, cache: Option<&str>) -> Value {
        let mut command = Command::new(program());
        command.args([
            "--distribution",
            distro,
            "--exec",
            "/usr/bin/python3",
            "-c",
            script,
        ]);
        if let Some(cache) = cache {
            command
                .env("XDG_CACHE_HOME", cache)
                .env("WSLENV", "XDG_CACHE_HOME/u");
        }
        serde_json::from_slice(&execute(command, input, Duration::from_secs(25)).unwrap()).unwrap()
    }
    struct Fixture {
        distro: String,
        root: String,
        cwd: String,
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let script = format!(
                "import os,shutil,tempfile; root=os.path.realpath({:?}); assert os.path.dirname(root)==os.path.realpath(tempfile.gettempdir()) and os.path.basename(root).startswith('qterm-wsl-test-'); shutil.rmtree(root); print('null')",
                self.root
            );
            let mut command = Command::new(program());
            command.args([
                "--distribution",
                &self.distro,
                "--exec",
                "/usr/bin/python3",
                "-c",
                &script,
            ]);
            let _ = execute(command, None, Duration::from_secs(10));
        }
    }
    #[test]
    #[ignore = "requires installed Ubuntu; run explicitly for WSL validation"]
    fn real_ubuntu_project_inspection_file_resolution_and_literal_briefs() {
        let distro = installed("Ubuntu").unwrap();
        let source = r#"import os,json,tempfile,subprocess,shlex
root=tempfile.mkdtemp(prefix='qterm-wsl-test-'); cwd=os.path.join(root,'Case project'); os.mkdir(cwd)
for name,text in [('Case.py','upper'),('case.py','lower'),('tracked.txt','original'),('package.json','{"scripts":{"check":"python3 check.py"}}'),('.qterm.toml','name = "WSL proof"\n')]:
    with open(os.path.join(cwd,name),'w') as f:f.write(text)
env={**os.environ,'GIT_CONFIG_GLOBAL':'/dev/null','GIT_CONFIG_SYSTEM':'/dev/null'}
def git(*args):subprocess.run(['/usr/bin/git','-c','core.hooksPath=/dev/null','-c','commit.gpgSign=false','-c','core.fsmonitor=false',*args],cwd=cwd,env=env,check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
git('init','--quiet','--initial-branch=wsl-proof'); git('config','user.email','fixture@example.invalid'); git('config','user.name','qterm fixture'); git('add','.'); git('commit','--quiet','-m','fixture')
sentinel=os.path.join(root,'must-not-run'); hook=os.path.join(root,'forbidden.sh')
with open(hook,'w') as f:f.write('#!/bin/sh\ntouch '+shlex.quote(sentinel)+'\ncat\n')
os.chmod(hook,0o700); git('config','core.fsmonitor',hook);git('config','filter.qterm.clean',hook);git('config','filter.qterm.process',hook);git('config','filter.qterm.required','true')
with open(os.path.join(cwd,'.gitattributes'),'w') as f:f.write('tracked.txt filter=qterm\n')
with open(os.path.join(cwd,'tracked.txt'),'w') as f:f.write('edited')
print(json.dumps({'root':root,'cwd':cwd,'sentinel':sentinel}))"#;
        let created = python(&distro, source, None, None);
        let fixture = Fixture {
            distro: distro.clone(),
            root: created["root"].as_str().unwrap().into(),
            cwd: created["cwd"].as_str().unwrap().into(),
        };
        let index = unc(&distro, &format!("{}/.git/index", fixture.cwd)).unwrap();
        let before = std::fs::read(&index).unwrap();
        let info = project(&distro, &fixture.cwd).unwrap();
        assert_eq!(info.git.unwrap().branch, "wsl-proof");
        assert_eq!(info.tasks.unwrap().dir, fixture.cwd);
        assert_eq!(
            info.settings.unwrap().settings.name.as_deref(),
            Some("WSL proof")
        );
        assert_eq!(std::fs::read(&index).unwrap(), before);
        assert!(
            !std::path::Path::new(&unc(&distro, created["sentinel"].as_str().unwrap()).unwrap())
                .exists()
        );
        let files = resolve(
            &distro,
            &fixture.cwd,
            &[
                "Case.py".into(),
                "case.py".into(),
                "missing.py".into(),
                r"C:\Windows\win.ini".into(),
            ],
        )
        .unwrap();
        assert_eq!(
            std::fs::read_to_string(files[0].as_ref().unwrap()).unwrap(),
            "upper"
        );
        assert_eq!(
            std::fs::read_to_string(files[1].as_ref().unwrap()).unwrap(),
            "lower"
        );
        assert!(files[2].is_none() && files[3].is_none());
        let windows = unc(&distro, &format!("{}/Case.py", fixture.cwd)).unwrap();
        assert_eq!(
            translate(&distro, &[windows], true).unwrap(),
            [format!("{}/Case.py", fixture.cwd)]
        );
        let windows = translate(&distro, std::slice::from_ref(&fixture.cwd), false).unwrap();
        assert!(std::path::Path::new(&windows[0]).is_dir());
        assert_eq!(
            translate(&distro, &windows, true).unwrap(),
            std::slice::from_ref(&fixture.cwd)
        );
        assert!(
            translate(
                &distro,
                &[format!(
                    r"\\wsl.localhost\qterm-other-distro{}\Case.py",
                    fixture.cwd.replace('/', r"\")
                )],
                true
            )
            .unwrap_err()
            .contains("another WSL distribution")
        );
        assert!(translate(&distro, &["relative-file.py".into()], true).is_err());
        let unsupported = format!("{}/unsupported:folder", fixture.cwd);
        python(
            &distro,
            &format!("import os;os.mkdir({unsupported:?});print('null')"),
            None,
            None,
        );
        assert!(
            translate(&distro, &[unsupported], false)
                .unwrap_err()
                .contains("cannot be represented safely")
        );
        let native = std::env::var("SystemRoot").unwrap();
        let linux = translate(&distro, std::slice::from_ref(&native), true).unwrap();
        let roundtrip = translate(&distro, &linux, false).unwrap();
        assert_eq!(
            std::fs::canonicalize(&roundtrip[0]).unwrap(),
            std::fs::canonicalize(&native).unwrap()
        );
        let text = "literal $(touch must-not-run) ```\n🦀";
        let request = serde_json::to_vec(&json!({"method":"brief","text":text})).unwrap();
        let result = python(&distro, SCRIPT, Some(request), Some(&fixture.root));
        let path = result["result"]["path"].as_str().unwrap();
        assert!(path.starts_with(&fixture.root));
        assert_eq!(
            std::fs::read_to_string(unc(&distro, path).unwrap()).unwrap(),
            text
        );
    }
}
