//! Distribution-specific, bounded data operations. No arbitrary script IPC.
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    io::{Read, Write},
    os::windows::process::CommandExt,
    path::PathBuf,
    process::{Command, Stdio},
    sync::{Arc,Condvar,Mutex,OnceLock,mpsc},
    thread,
    time::{Duration, Instant},
};
const SCRIPT: &str = include_str!("wsl_bridge.py");
const REPOSITORY_SCRIPT:&str=include_str!("wsl_repository.py");
const VERIFICATION_SCRIPT:&str=include_str!("wsl_verification.py");
const WORKFLOWS_SCRIPT:&str=include_str!("wsl_workflows.py");
const TASK_SOURCES_SCRIPT:&str=include_str!("wsl_task_sources.py");
const BOOTSTRAP:&str=include_str!("wsl_bootstrap.py");
const OUTPUT: usize = 4 * 1024 * 1024;
#[derive(Default)]
struct Admission { active:usize, waiting:usize }
#[derive(Default)]
struct Gate {state:Mutex<Admission>,changed:Condvar}
static GATE:OnceLock<Arc<Gate>>=OnceLock::new();
struct Permit(Arc<Gate>);
impl Gate {
    fn acquire(self:&Arc<Self>,deadline:Instant)->Result<Permit,String>{
        let mut state=self.state.lock().unwrap();
        if state.waiting>=16{return Err("The WSL data queue is full; try again after pending operations finish".into());}
        state.waiting+=1;
        while state.active>=4{
            let remaining=deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero(){state.waiting-=1;return Err("Timed out waiting for a WSL data operation slot; no operation was started".into());}
            state=self.changed.wait_timeout(state,remaining).unwrap().0;
        }
        state.waiting-=1;state.active+=1;Ok(Permit(Arc::clone(self)))
    }
}
impl Drop for Permit {
    fn drop(&mut self) {
        let mut state=self.0.state.lock().unwrap();state.active-=1;
        self.0.changed.notify_one();
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
    command: Command,
    input: Option<Vec<u8>>,
    deadline: Duration,
) -> Result<Vec<u8>, String> {
    execute_checked(command,input,deadline,&||Ok(()))
}
fn execute_checked(mut command:Command,input:Option<Vec<u8>>,deadline:Duration,validate:&dyn Fn()->Result<(),String>)->Result<Vec<u8>,String>{
    // Admission happens before spawning a process. Never retry an executed
    // mutation; retain four active operations and at most sixteen bounded waiters.
    let permit=GATE.get_or_init(||Arc::new(Gate::default())).acquire(Instant::now()+Duration::from_secs(5))?;
    validate()?;
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
    call_checked(distro,request,&||Ok(()))
}
#[cfg(test)]
pub(crate) fn test_python(distribution:&str,source:&str,request:Value)->Result<Value,String>{
    let distribution=installed(distribution)?;
    let mut command=Command::new(program());command.args(["--distribution",&distribution,"--exec","/usr/bin/python3","-I","-S","-c",BOOTSTRAP]);
    let data=serde_json::to_vec(&json!({"source":source,"request":request})).map_err(|e|e.to_string())?;
    serde_json::from_slice(&execute(command,Some(data),Duration::from_secs(25))?).map_err(|e|e.to_string())
}
pub fn call_checked(distro:&str,request:Value,validate:&dyn Fn()->Result<(),String>)->Result<Value,String>{
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
        BOOTSTRAP,
    ]);
    let envelope=serde_json::to_vec(&json!({"source":format!("{REPOSITORY_SCRIPT}\n{VERIFICATION_SCRIPT}\n{WORKFLOWS_SCRIPT}\n{TASK_SOURCES_SCRIPT}\n{SCRIPT}"),"request":request})).map_err(|e|e.to_string())?;
    if envelope.len()>2_097_152{return Err("WSL helper envelope exceeds 2 MiB".into());}
    let output = execute_checked(command, Some(envelope), Duration::from_secs(25),validate)?;
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
    let mut info = crate::project::files_info_environment(std::path::Path::new(&root),true);
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
    fn bounded_admission_waits_for_a_released_slot_and_expires_without_starting(){
        let gate=Arc::new(Gate::default());
        let mut held:Vec<_>=(0..4).map(|_|gate.acquire(Instant::now()).unwrap()).collect();
        assert!(gate.acquire(Instant::now()).err().unwrap().contains("no operation was started"));
        assert_eq!(gate.state.lock().unwrap().waiting,0);
        let pending=Arc::clone(&gate);let(tx,rx)=mpsc::channel();
        let worker=thread::spawn(move||{let permit=pending.acquire(Instant::now()+Duration::from_secs(3)).unwrap();assert!(tx.send(permit).is_ok());});
        let end=Instant::now()+Duration::from_secs(2);
        while gate.state.lock().unwrap().waiting==0{assert!(Instant::now()<end,"waiter never entered admission");thread::yield_now();}
        assert!(rx.try_recv().is_err());drop(held.pop());
        let admitted=rx.recv_timeout(Duration::from_secs(2)).unwrap();worker.join().unwrap();
        assert_eq!(gate.state.lock().unwrap().active,4);drop(admitted);drop(held);
        assert_eq!(gate.state.lock().unwrap().active,0);
        gate.state.lock().unwrap().waiting=16;
        assert!(gate.acquire(Instant::now()).err().unwrap().contains("queue is full"));
    }
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
    fn real_task_sources_use_the_production_bundle_and_shared_parsers(){
        use base64::{Engine,engine::general_purpose::STANDARD};
        use std::collections::HashMap;
        let distro=installed("Ubuntu").unwrap();
        let created=test_python(&distro,r#"import os,json,tempfile,subprocess
root=tempfile.mkdtemp(prefix='qterm-wsl-test-');cwd=root+'/Case task';os.mkdir(cwd)
subprocess.run(['/usr/bin/git','-c','core.hooksPath=/dev/null','-c','init.templateDir=','init','--quiet',cwd],check=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
files={'package.json':'{"scripts":{"check":"forbidden project command"}}','Cargo.toml':'[package]\nname="fixture"\n','Makefile':'verify:\n\t@echo forbidden\n','justfile':'lint:\n    echo forbidden\n','composer.json':'{"scripts":{"test":"forbidden"}}','pyproject.toml':'[tool.poe.tasks]\nfmt="forbidden"\n'}
for name,text in files.items():open(cwd+'/'+name,'w').write(text)
open(cwd+'/pnpm-lock.yaml','w').write('presence only')
open(cwd+'/Cargo.toml','wb').write(b'\xff'*1048576)
print(json.dumps({'root':root,'cwd':cwd}))"#,Value::Null).unwrap();
        let fixture=Fixture{distro:distro.clone(),root:created["root"].as_str().unwrap().into(),cwd:created["cwd"].as_str().unwrap().into()};
        let context=call(&distro,json!({"method":"task_project","cwd":fixture.cwd})).unwrap();
        let snapshot=call(&distro,json!({"method":"task_directory","project":context["project"],"directory":context["directory"]})).unwrap();
        let mut sources:HashMap<String,Vec<u8>>=HashMap::new();
        for (name,fact) in snapshot["files"].as_object().unwrap(){
            if fact.is_null(){continue;}
            let value=call(&distro,json!({"method":"task_source","project":context["project"],"directory":snapshot["directory"],"name":name,"expected":fact})).unwrap();
            sources.insert(name.clone(),STANDARD.decode(value["base64"].as_str().unwrap()).unwrap());
        }
        let tasks=crate::project::tasks_from_sources(
            &|name|sources.get(name).and_then(|bytes|serde_json::from_slice(bytes).ok()),
            &|name|sources.get(name).and_then(|bytes|String::from_utf8(bytes.clone()).ok()),
            &|name|sources.contains_key(name)||snapshot["locks"].as_array().unwrap().iter().any(|lock|lock.as_str()==Some(name)),
            &|package|crate::project::package_manager_from_sources(package,&||crate::project::package_manager_lock(&|name|snapshot["locks"].as_array().unwrap().iter().any(|lock|lock.as_str()==Some(name))))
        );
        assert_eq!(sources["Cargo.toml"].len(),1_048_576);
        assert!(sources["Cargo.toml"].iter().all(|byte|*byte==255));
        assert_eq!(tasks.iter().map(|task|task.command.as_str()).collect::<Vec<_>>(),["pnpm run check","cargo build","cargo check","cargo test","cargo run","cargo clippy","make verify","just lint","composer run-script test","poe fmt"]);
        test_python(&distro,&format!("open({}+'/package.json','w').write('{{}}');print('null')",json!(fixture.cwd)),Value::Null).unwrap();
        assert!(call(&distro,json!({"method":"task_source","project":context["project"],"directory":snapshot["directory"],"name":"package.json","expected":snapshot["files"]["package.json"]})).unwrap_err().contains("manifest changed"));
    }

    #[test]
    #[ignore = "requires installed Ubuntu; run explicitly for WSL validation"]
    fn real_workflow_source_and_directories_use_the_production_bundle() {
        let distro = installed("Ubuntu").unwrap();
        let created = test_python(&distro, r#"import os,json,tempfile
root=tempfile.mkdtemp(prefix='qterm-wsl-test-'); cwd=root+'/Case workflow';os.mkdir(cwd);os.mkdir(cwd+'/child')
text='[workflows]\nversion=1\n[[workflows.recipes]]\nname="check"\n[[workflows.recipes.steps]]\nname="check"\ncommand="printf literal"\n'
open(cwd+'/.qterm.toml','w',encoding='utf8').write(text)
print(json.dumps({'root':root,'cwd':cwd,'text':text}))"#, Value::Null).unwrap();
        let fixture = Fixture {
            distro: distro.clone(),
            root: created["root"].as_str().unwrap().into(),
            cwd: created["cwd"].as_str().unwrap().into(),
        };
        let source=call(&distro,json!({"method":"workflow_source","cwd":format!("{}/child",fixture.cwd)})).unwrap();
        assert_eq!(source["project"],fixture.cwd);
        assert_eq!(source["text"],created["text"]);
        let definitions=crate::project::parse_settings(source["text"].as_str().unwrap()).unwrap().workflows.unwrap();
        assert_eq!(definitions.recipes[0].steps[0].command,"printf literal");
        let directories=call(&distro,json!({"method":"workflow_directories","source":source,"paths":[".","child"]})).unwrap();
        assert_eq!(directories[1]["directory"],format!("{}/child",fixture.cwd));
        assert_eq!(call(&distro,json!({"method":"workflow_validate","source":source,"directories":directories})).unwrap()["valid"],true);
        test_python(&distro,&format!("import os;root={};os.rename(root+'/child',root+'/old');os.mkdir(root+'/child');print('null')",json!(fixture.cwd)),Value::Null).unwrap();
        assert!(call(&distro,json!({"method":"workflow_validate","source":source,"directories":directories})).unwrap_err().contains("step folder changed"));
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
