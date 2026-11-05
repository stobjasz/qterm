//! Linux project and task definitions. This supplies policy facts, not authority.
use crate::{project, wsl};
use base64::{Engine, engine::general_purpose::STANDARD};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    time::{Duration, Instant},
};

#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
pub(crate) struct Directory {
    pub path: String,
    identity: [u64; 2],
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        agent_access::{Access, Pane},
        agent_scope::Scope,
        agent_tasks::Policy,
        pty::Profile,
        repo_state::tests::Repo,
        run_records,
    };
    use std::sync::Arc;
    struct Fixture {
        root: String,
        identity: serde_json::Value,
        uid: u64,
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let result = wsl::test_python(
                "Ubuntu",
                r#"import os,json,shutil
r=QTERM_REQUEST['root'];s=os.stat(r,follow_symlinks=False)
assert r.startswith('/tmp/qterm-wsl-test-') and os.path.realpath(r)==r
assert [s.st_dev,s.st_ino]==QTERM_REQUEST['identity'] and s.st_uid==QTERM_REQUEST['uid']==os.getuid()
shutil.rmtree(r);print('null')"#,
                json!({"root":self.root,"identity":self.identity,"uid":self.uid}),
            );
            assert!(
                result.is_ok(),
                "Could not clean pinned Linux task fixture: {result:?}"
            );
        }
    }
    #[test]
    #[ignore = "requires installed Ubuntu; run explicitly for WSL validation"]
    fn real_linux_policy_and_pipe_reads_keep_project_environment_and_definitions() {
        let created=wsl::test_python("Ubuntu",r#"import os,json,tempfile,subprocess
r=tempfile.mkdtemp(prefix='qterm-wsl-test-');p=r+'/repo';os.mkdir(p);os.mkdir(p+'/nested');os.mkdir(r+'/repo-other')
subprocess.run(['/usr/bin/git','-c','core.hooksPath=/dev/null','-c','init.templateDir=','init','--quiet',p],check=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
open(p+'/nested/package.json','w').write('{"scripts":{"check":"must never execute"}}')
open(p+'/pnpm-lock.yaml','w').write('first dependency state')
open(r+'/outside.json','w').write('{}');os.symlink(r+'/outside.json',p+'/package.json');os.symlink(r+'/repo-other',p+'/escape')
s=os.stat(r);print(json.dumps({'root':r,'identity':[s.st_dev,s.st_ino],'uid':os.getuid()}))"#,serde_json::Value::Null).unwrap();
        let fixture = Fixture {
            root: created["root"].as_str().unwrap().into(),
            identity: created["identity"].clone(),
            uid: created["uid"].as_u64().unwrap(),
        };
        let path = format!("{}/repo", fixture.root);
        let cwd = format!("{path}/nested");
        let scope = Scope::capture(&cwd, "wsl:Ubuntu").unwrap();
        assert_eq!(scope.project(), path);
        assert_eq!(scope.environment(), "wsl:ubuntu");
        assert!(scope.accepts(Some("wsl:ubuntu"), "wsl"));
        for (environment, kind) in [
            (None, "wsl"),
            (Some("native"), "wsl"),
            (Some("wsl:another"), "wsl"),
            (Some("wsl:ubuntu"), "bash"),
        ] {
            assert!(!scope.accepts(environment, kind),"foreign or unbound environment was accepted");
        }
        let paths = vec![
            cwd.clone(),
            format!("{}/repo-other", fixture.root),
            format!("{path}/escape"),
            format!("{path}/Nested"),
        ];
        let allowed = scope.paths(&paths).unwrap();
        assert_eq!(allowed.len(), 1);
        assert!(allowed.contains(&cwd));
        let profile=Profile::custom(&serde_json::from_value(json!({"name":"Linux task fixture","command":"wsl.exe -d Ubuntu --exec /bin/bash","env":{"TASK_SECRET":"private"}})).unwrap());
        let policy = Policy::review_scope(&scope, &cwd, &profile).unwrap();
        assert_eq!(policy.tasks.len(), 1);
        assert_eq!(policy.tasks[0].command, "pnpm run check");
        assert!(
            !serde_json::to_string(&policy)
                .unwrap()
                .contains("TASK_SECRET")
        );
        let change = |script: &str| {
            wsl::test_python("Ubuntu", script, json!({"path":path,"cwd":cwd})).unwrap()
        };
        change(
            "import json;open(QTERM_REQUEST['path']+'/pnpm-lock.yaml','w').write('updated dependencies');print('null')",
        );
        policy
            .validate_scope(&scope, &policy.tasks[0], &profile)
            .unwrap();
        change(
            "import json;open(QTERM_REQUEST['cwd']+'/yarn.lock','w').write('nearer manager');print('null')",
        );
        assert!(
            policy
                .validate_scope(&scope, &policy.tasks[0], &profile)
                .unwrap_err()
                .contains("command")
        );
        change("import os;os.unlink(QTERM_REQUEST['cwd']+'/yarn.lock');print('null')");
        policy
            .validate_scope(&scope, &policy.tasks[0], &profile)
            .unwrap();
        change(
            "import os;p=QTERM_REQUEST['cwd']+'/package.json';os.rename(p,p+'.old');open(p,'w').write(open(p+'.old').read());print('null')",
        );
        assert!(
            policy
                .validate_scope(&scope, &policy.tasks[0], &profile)
                .unwrap_err()
                .contains("manifest")
        );

        let native = Repo::new();
        let access = Arc::new(Access::new(native.dir.join(".git/connections")));
        let records = Arc::new(run_records::Store::load(native.dir.join(".git/runs.json")));
        let panes: Vec<_> = [
            ("allowed", Some("wsl:ubuntu"), "wsl", cwd.clone()),
            ("foreign", Some("wsl:another"), "wsl", cwd.clone()),
            ("native", None, "bash", cwd.clone()),
            (
                "escape",
                Some("wsl:ubuntu"),
                "wsl",
                format!("{path}/escape"),
            ),
        ]
        .into_iter()
        .map(|(id, env, kind, cwd)| Pane {
            id: id.into(),
            cwd: Some(cwd),
            label: id.into(),
            profile_id: profile.id.clone(),
            kind: kind.into(),
            environment: env.map(String::from),
        })
        .collect();
        for pane in &panes {
            records
                .append(
                    run_records::Run {
                        id: pane.id.clone(),
                        pane_id: pane.id.clone(),
                        profile_id: Some(profile.id.clone()),
                        shell_kind: Some(pane.kind.clone()),
                        environment: pane.environment.clone(),
                        app_run_id: None,
                        cwd: pane.cwd.clone(),
                        command: "fixture command".into(),
                        command_truncated: false,
                        exit_code: Some(0),
                        started_at: 1,
                        finished_at: 2,
                        output: format!("private output for {}", pane.id),
                        output_truncated: false,
                        verification: None,
                        requester: None,
                    },
                    None,
                )
                .unwrap();
        }
        access.publish(panes).unwrap();
        let review = access.review_environment(&cwd, "wsl:ubuntu", None).unwrap();
        let weak = Arc::downgrade(&access);
        let saved = records.clone();
        let snapshot = access
            .grant(
                &review.id,
                "Linux fixture",
                Arc::new(move |value| weak.upgrade().unwrap().request(value, &saved)),
            )
            .unwrap();
        let grant = &snapshot.grants[0];
        assert_eq!(grant.environment, "wsl:ubuntu");
        let response =
            crate::agent_access::client(&[grant.connection_file.clone(), "panes.list".into()])
                .unwrap();
        assert_eq!(response["result"]["panes"].as_array().unwrap().len(), 1);
        assert_eq!(response["result"]["panes"][0]["id"], "allowed");
        let list =
            crate::agent_access::client(&[grant.connection_file.clone(), "commands.list".into()])
                .unwrap();
        assert_eq!(list["result"]["commands"].as_array().unwrap().len(), 1);
        assert_eq!(list["result"]["commands"][0]["id"], "allowed");
        for id in ["allowed", "foreign", "native", "escape"] {
            let result = crate::agent_access::client(&[
                grant.connection_file.clone(),
                "commands.result".into(),
                json!({"commandId":id}).to_string(),
            ])
            .unwrap();
            if id == "allowed" {
                assert_eq!(result["result"]["output"], "private output for allowed");
            } else {
                assert_eq!(result["error"]["code"], "not_available");
            }
        }
        assert!(
            access
                .grant(&review.id, "reused review", Arc::new(|_| json!({})))
                .is_err()
        );
        access.revoke(&grant.id).unwrap();
        assert!(!std::path::Path::new(&grant.connection_file).exists());
    }
}
#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
pub(crate) struct Project {
    pub path: String,
    identity: [u64; 2],
    uid: u64,
    metadata: Vec<Directory>,
    #[serde(skip)]
    pub distribution: String,
}
#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
pub(crate) struct FileFact {
    pub name: String,
    pub path: String,
    identity: [u64; 2],
    pub regular: bool,
    pub size: u64,
    pub digest: Option<String>,
}
#[derive(Deserialize)]
struct Context {
    project: Project,
    directory: Directory,
}
#[derive(Deserialize)]
struct Snapshot {
    directory: Directory,
    files: HashMap<String, Option<FileFact>>,
    locks: Vec<String>,
    parent: Option<Directory>,
}
pub(crate) struct Discovery {
    pub directory: Directory,
    pub tasks: Vec<project::Task>,
    pub files: HashMap<String, FileFact>,
    pub bytes: HashMap<String, Vec<u8>>,
}
impl Project {
    pub fn capture(distribution: &str, cwd: &str) -> Result<(Self, Directory), String> {
        let mut context: Context = serde_json::from_value(wsl::call(
            distribution,
            json!({"method":"task_project","cwd":cwd}),
        )?)
        .map_err(|e| e.to_string())?;
        context.project.distribution = distribution.to_lowercase();
        Ok((context.project, context.directory))
    }
    pub fn environment(&self) -> String {
        format!("wsl:{}", self.distribution)
    }
    pub fn validate(&self) -> Result<(), String> {
        let value = wsl::call(
            &self.distribution,
            json!({"method":"task_validate_project","project":self}),
        )?;
        if value["valid"] != true {
            return Err("Linux project validation returned no confirmation".into());
        }
        Ok(())
    }
    pub fn scoped_paths(&self, paths: &[String]) -> Result<Vec<bool>, String> {
        let result: Vec<bool> = serde_json::from_value(wsl::call(
            &self.distribution,
            json!({"method":"task_scope_paths","project":self,"paths":paths}),
        )?)
        .map_err(|e| e.to_string())?;
        if result.len() != paths.len() {
            return Err("Linux folder scope response changed its input paths".into());
        }
        Ok(result)
    }
    pub fn source(&self, directory: &Directory, fact: &FileFact) -> Result<Vec<u8>, String> {
        #[derive(Deserialize)]
        struct Source {
            file: FileFact,
            base64: String,
        }
        let result:Source=serde_json::from_value(wsl::call(&self.distribution,json!({"method":"task_source","project":self,"directory":directory,"name":fact.name,"expected":fact}))?).map_err(|e|e.to_string())?;
        if result.file != *fact {
            return Err("Linux task source returned different reviewed facts".into());
        }
        let bytes = STANDARD.decode(result.base64).map_err(|e| e.to_string())?;
        if bytes.len() > 1_048_576 {
            return Err("Linux task manifest exceeds 1 MiB".into());
        }
        if bytes.len() as u64 != fact.size
            || fact.digest.as_deref() != Some(format!("{:x}", Sha256::digest(&bytes)).as_str())
        {
            return Err("Linux task bytes do not match the reviewed manifest".into());
        }
        Ok(bytes)
    }
    fn snapshot(&self, directory: serde_json::Value) -> Result<Snapshot, String> {
        serde_json::from_value(wsl::call(
            &self.distribution,
            json!({"method":"task_directory","project":self,"directory":directory}),
        )?)
        .map_err(|e| e.to_string())
    }
    pub fn discover(&self, cwd: &str) -> Result<Discovery, String> {
        let deadline = Instant::now() + Duration::from_secs(30);
        let mut directory = json!(cwd);
        for _ in 0..256 {
            if Instant::now() >= deadline {
                return Err("Linux task discovery exceeded its deadline".into());
            }
            let snapshot = self.snapshot(directory)?;
            let files: HashMap<_, _> = snapshot
                .files
                .iter()
                .filter_map(|(name, file)| file.as_ref().map(|file| (name.clone(), file.clone())))
                .collect();
            let mut bytes = HashMap::new();
            for (name, file) in &files {
                if file.regular && file.digest.is_some() {
                    if Instant::now() >= deadline {
                        return Err("Linux task discovery exceeded its deadline".into());
                    }
                    bytes.insert(name.clone(), self.source(&snapshot.directory, file)?);
                }
            }
            let mut locks = vec![snapshot.locks.clone()];
            let package: Option<serde_json::Value> = bytes
                .get("package.json")
                .and_then(|bytes| serde_json::from_slice(bytes).ok());
            let needs_locks = std::cell::Cell::new(false);
            if let Some(package) = &package {
                project::package_manager_from_sources(package, &|| {
                    needs_locks.set(true);
                    None
                });
            }
            if needs_locks.get() {
                let mut parent = snapshot.parent.clone();
                for _ in 0..256 {
                    if locks.iter().any(|names| {
                        project::package_manager_lock(&|name| names.iter().any(|item| item == name))
                            .is_some()
                    }) {
                        break;
                    }
                    let Some(next) = parent else {
                        break;
                    };
                    if Instant::now() >= deadline {
                        return Err("Linux package-manager lookup exceeded its deadline".into());
                    }
                    let above:Snapshot=serde_json::from_value(wsl::call(&self.distribution,json!({"method":"task_directory","project":self,"directory":next,"locksOnly":true}))?).map_err(|e|e.to_string())?;
                    locks.push(above.locks);
                    parent = above.parent;
                }
            }
            let tasks = project::tasks_from_sources(
                &|name| {
                    bytes
                        .get(name)
                        .and_then(|bytes| serde_json::from_slice(bytes).ok())
                },
                &|name| {
                    bytes
                        .get(name)
                        .and_then(|bytes| String::from_utf8(bytes.clone()).ok())
                },
                &|name| {
                    files.get(name).is_some_and(|file| file.regular)
                        || snapshot.locks.iter().any(|item| item == name)
                },
                &|package| {
                    project::package_manager_from_sources(package, &|| {
                        locks.iter().find_map(|names| {
                            project::package_manager_lock(&|name| {
                                names.iter().any(|item| item == name)
                            })
                        })
                    })
                },
            );
            if !tasks.is_empty() || snapshot.parent.is_none() {
                let fresh = self.snapshot(json!(snapshot.directory))?;
                if fresh.files != snapshot.files || fresh.locks != snapshot.locks {
                    return Err("Linux task definitions changed during discovery".into());
                }
                return Ok(Discovery {
                    directory: snapshot.directory,
                    tasks: tasks.into_iter().take(200).collect(),
                    files,
                    bytes,
                });
            }
            let Some(parent) = snapshot.parent else {
                return Err("No named project tasks found in this folder".into());
            };
            directory = json!(parent);
        }
        Err("Linux task ancestor lookup exceeded its bound".into())
    }
}
