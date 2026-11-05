//! Explicitly reviewed project workflows. Live permissions never survive exit.
use crate::{
    agent_pipe, agent_tasks, project,
    pty::{Profile, SessionManager},
    repo_state, run_records,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    fs,
    io::Read,
    path::{Component, Path},
    sync::Mutex,
    time::{Duration, Instant},
};

const MAX_FILE: u64 = 262_144;
const MAX_RUNS: usize = 32;
#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Definitions {
    pub version: u32,
    pub recipes: Vec<Definition>,
}
#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Definition {
    pub name: String,
    #[serde(default)]
    pub layout: Layout,
    pub steps: Vec<Step>,
}
#[derive(Clone, Copy, Debug, Default, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Layout {
    #[default]
    Tabs,
    Rows,
    Columns,
}
#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
#[serde(
    deny_unknown_fields,
    rename_all(deserialize = "snake_case", serialize = "camelCase")
)]
pub struct Step {
    pub name: String,
    pub command: String,
    #[serde(default = "dot")]
    pub cwd: String,
    #[serde(default)]
    pub depends_on: Vec<String>,
    #[serde(default)]
    pub ready_output: Option<String>,
    #[serde(default = "deadline")]
    pub timeout_seconds: u64,
}
fn dot() -> String {
    ".".into()
}
fn deadline() -> u64 {
    300
}
fn name(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 64
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"_-".contains(&b))
}
pub fn validate(defs: &Definitions) -> Result<(), String> {
    validate_environment(defs,false)
}
pub(crate) fn validate_environment(defs: &Definitions, linux:bool) -> Result<(), String> {
    if defs.version != 1 {
        return Err("workflows.version must be 1".into());
    }
    if defs.recipes.is_empty() || defs.recipes.len() > 16 {
        return Err("Define 1–16 workflow recipes".into());
    }
    let mut names = HashSet::new();
    for recipe in &defs.recipes {
        if !name(&recipe.name) || !names.insert(&recipe.name) {
            return Err(
                "Workflow names must be unique, 1–64 ASCII letters, digits, underscores or hyphens"
                    .into(),
            );
        }
        if recipe.steps.is_empty() || recipe.steps.len() > 16 {
            return Err(format!("{}: define 1–16 steps", recipe.name));
        }
        let mut steps = HashMap::new();
        for step in &recipe.steps {
            if !name(&step.name) || steps.insert(step.name.as_str(), step).is_some() {
                return Err(format!("{}: invalid or duplicate step name", recipe.name));
            }
            if step.command.trim().is_empty()
                || step.command.encode_utf16().count() > 15_000
                || step.command.chars().any(|c| c.is_control() && c != '\t')
            {
                return Err(format!(
                    "{}: command must be one complete nonempty line of at most 15000 UTF-16 units",
                    step.name
                ));
            }
            let path = Path::new(&step.cwd);
            if step.cwd.is_empty()
                || (if linux { step.cwd.starts_with('/') || step.cwd.split('/').any(|part|part=="..") } else { path.is_absolute()
                || path.components().any(|c| {
                    matches!(
                        c,
                        Component::ParentDir | Component::RootDir | Component::Prefix(_)
                    )
                }) })
            {
                return Err(format!(
                    "{}: cwd must be project-relative without parent traversal",
                    step.name
                ));
            }
            if step.ready_output.as_ref().is_some_and(|s| {
                s.is_empty() || s.chars().count() > 512 || s.chars().any(char::is_control)
            }) {
                return Err(format!(
                    "{}: ready_output must be a literal nonempty line of at most 512 characters",
                    step.name
                ));
            }
            if !(1..=3600).contains(&step.timeout_seconds) {
                return Err(format!("{}: timeout_seconds must be 1–3600", step.name));
            }
            if step.depends_on.len() > 16
                || step.depends_on.iter().collect::<HashSet<_>>().len() != step.depends_on.len()
            {
                return Err(format!("{}: repeated or excessive dependencies", step.name));
            }
        }
        fn visit<'a>(
            id: &'a str,
            steps: &HashMap<&'a str, &'a Step>,
            seen: &mut HashSet<&'a str>,
            active: &mut HashSet<&'a str>,
        ) -> Result<(), String> {
            if seen.contains(id) {
                return Ok(());
            }
            if !active.insert(id) {
                return Err(format!("Workflow dependency cycle at {id}"));
            }
            let step = steps
                .get(id)
                .ok_or_else(|| format!("Unknown dependency: {id}"))?;
            for dependency in &step.depends_on {
                visit(dependency, steps, seen, active)?;
            }
            active.remove(id);
            seen.insert(id);
            Ok(())
        }
        let mut seen = HashSet::new();
        for step in &recipe.steps {
            visit(&step.name, &steps, &mut seen, &mut HashSet::new())?;
        }
    }
    Ok(())
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewedStep {
    #[serde(flatten)]
    pub definition: Step,
    pub directory: String,
    #[serde(skip)]
    relative: String,
    #[serde(skip)]
    linux_directory: Option<crate::wsl_workflows::Directory>,
}
#[derive(Clone, Serialize)]
pub struct ReviewedRecipe {
    pub name: String,
    pub layout: Layout,
    pub steps: Vec<ReviewedStep>,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Review {
    pub id: String,
    pub source: String,
    pub project: String,
    pub digest: String,
    pub profile_id: String,
    pub profile_name: String,
    pub recipes: Vec<ReviewedRecipe>,
    #[serde(skip)]
    profile_key: String,
    #[serde(skip_serializing_if="Option::is_none")]
    pub launch_key: Option<String>,
    pub environment: String,
    #[serde(skip)]
    linux_source: Option<crate::wsl_workflows::Source>,
    #[serde(skip)]
    created: Option<Instant>,
}
fn bytes(path: &Path) -> Result<Vec<u8>, String> {
    let mut result = vec![];
    fs::File::open(path)
        .map_err(|e| e.to_string())?
        .take(MAX_FILE + 1)
        .read_to_end(&mut result)
        .map_err(|e| e.to_string())?;
    if result.len() as u64 > MAX_FILE {
        return Err("Workflow source exceeds 256 KiB".into());
    }
    Ok(result)
}
fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
impl Review {
    fn read(cwd: &str, profile: &Profile) -> Result<Self, String> {
        if let Some(distribution)=profile.distribution.as_deref(){return Self::read_linux(cwd,profile,distribution);}
        let folder = repo_state::native_folder(cwd)?;
        let file = folder
            .ancestors()
            .map(|p| p.join(".qterm.toml"))
            .find(|p| p.is_file())
            .ok_or("No .qterm.toml found")?;
        let root = fs::canonicalize(file.parent().ok_or("No workflow source folder")?)
            .map_err(|e| e.to_string())?;
        let canonical = fs::canonicalize(&file).map_err(|e| e.to_string())?;
        if canonical.parent() != Some(root.as_path()) {
            return Err("Workflow source escapes its project folder".into());
        }
        let source = bytes(&canonical)?;
        let text = std::str::from_utf8(&source).map_err(|e| e.to_string())?;
        let definitions = project::parse_settings(text)?
            .workflows
            .ok_or("No [workflows] section found")?;
        let profile_key = profile
            .automation_key()
            .ok_or("Choose a supported native shell")?;
        let mut recipes = vec![];
        for definition in definitions.recipes {
            let mut steps = vec![];
            for mut step in definition.steps {
                let dir = fs::canonicalize(root.join(&step.cwd))
                    .map_err(|e| format!("{}: {e}", step.name))?;
                if !dir.is_dir() || !dir.starts_with(&root) {
                    return Err(format!(
                        "{}: folder escapes the workflow project",
                        step.name
                    ));
                }
                let relative = step.cwd.clone();
                step.command = profile.task_command(&step.command);
                steps.push(ReviewedStep {
                    definition: step,
                    directory: repo_state::display(&dir),
                    relative,
                    linux_directory:None,
                });
            }
            recipes.push(ReviewedRecipe {
                name: definition.name,
                layout: definition.layout,
                steps,
            });
        }
        Ok(Self {
            id: agent_pipe::random()?,
            source: repo_state::display(&canonical),
            project: repo_state::display(&root),
            digest: digest(&source),
            profile_id: profile.id.clone(),
            profile_name: profile.name.clone(),
            profile_key,
            launch_key:None,
            environment:"native".into(),
            linux_source:None,
            recipes,
            created: Some(Instant::now()),
        })
    }
    fn validate(&self, profile: &Profile, step: &ReviewedStep) -> Result<(), String> {
        if self.linux_source.is_some(){return self.validate_many(profile,std::slice::from_ref(step));}
        if profile.id != self.profile_id
            || profile.automation_key().as_deref() != Some(&self.profile_key)
        {
            return Err("Workflow shell configuration changed; review again".into());
        }
        let root = repo_state::native_folder(&self.project)?;
        let file = fs::canonicalize(root.join(".qterm.toml")).map_err(|e| e.to_string())?;
        if repo_state::display(&file) != self.source || digest(&bytes(&file)?) != self.digest {
            return Err("Workflow source changed; review again".into());
        }
        let dir = fs::canonicalize(root.join(&step.relative)).map_err(|e| e.to_string())?;
        if !dir.starts_with(&root) || repo_state::display(&dir) != step.directory || !dir.is_dir() {
            return Err("Workflow step folder changed; review again".into());
        }
        Ok(())
    }
    fn read_linux(cwd:&str,profile:&Profile,distribution:&str)->Result<Self,String>{
        profile.check_kind(Some("wsl"))?;
        let source=crate::wsl_workflows::Source::read(distribution,cwd)?;
        let definitions=project::parse_settings_environment(&source.text,true)?.workflows.ok_or("No [workflows] section found")?;
        let paths:Vec<_>=definitions.recipes.iter().flat_map(|recipe|recipe.steps.iter().map(|step|step.cwd.clone())).collect();
        let mut directories=source.directories(distribution,&paths)?.into_iter();
        let mut recipes=vec![];
        for recipe in definitions.recipes{
            let mut steps=vec![];
            for definition in recipe.steps{
                let directory=directories.next().ok_or("Missing Linux workflow directory")?;
                steps.push(ReviewedStep{relative:definition.cwd.clone(),definition,directory:directory.directory.clone(),linux_directory:Some(directory)});
            }
            recipes.push(ReviewedRecipe{name:recipe.name,layout:recipe.layout,steps});
        }
        Ok(Self{id:agent_pipe::random()?,source:source.source.clone(),project:source.project.clone(),digest:source.digest.clone(),profile_id:profile.id.clone(),profile_name:profile.name.clone(),profile_key:profile.launch_key(),launch_key:Some(profile.launch_key()),environment:format!("wsl:{}",distribution.to_lowercase()),linux_source:Some(source),recipes,created:Some(Instant::now())})
    }
    fn validate_many(&self,profile:&Profile,steps:&[ReviewedStep])->Result<(),String>{
        if let Some(source)=&self.linux_source{
            profile.check_kind(Some("wsl"))?;profile.check_environment(Some(&self.environment))?;
            if profile.id!=self.profile_id||profile.launch_key()!=self.profile_key{return Err("Workflow shell configuration changed; review again".into());}
            let directories=steps.iter().map(|step|step.linux_directory.clone().ok_or("Missing Linux workflow directory identity")).collect::<Result<Vec<_>,_>>()?;
            return source.validate(self.environment.strip_prefix("wsl:").ok_or("Workflow environment is unavailable")?,&directories);
        }
        for step in steps{self.validate(profile,step)?;}Ok(())
    }
    fn binding(&self,sessions:&SessionManager,session:u32)->Option<(String,String)>{
        if self.linux_source.is_some(){sessions.launch_binding(session)}else{sessions.automation_binding(session)}
    }
    fn check_launch(&self,profile:&Profile,step:&ReviewedStep,pane:&str,session:u32,context:&Launch<'_>)->Result<(),String>{
        (context.revalidate)(profile)?;
        if !context.integrate||self.binding(context.sessions,session).as_ref()!=Some(&(pane.into(),self.profile_key.clone())){return Err("Actual workflow shell/pane does not match the reviewed profile".into());}
        if let Some(distribution)=self.environment.strip_prefix("wsl:"){
            let cwd=crate::wsl::call(distribution,serde_json::json!({"method":"folder","cwd":context.cwd}))?;
            if cwd.get("cwd").and_then(serde_json::Value::as_str)!=Some(step.directory.as_str()){return Err("Workflow shell started in another folder".into());}
        }else if repo_state::native_folder(context.cwd)?!=repo_state::native_folder(&step.directory)?{return Err("Workflow shell started in another folder".into());}
        self.validate(profile,step)?;
        (context.revalidate)(profile)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum State {
    Pending,
    Running,
    Ready,
    Succeeded,
    Failed,
    Blocked,
    Cancelled,
    Unknown,
    TimedOut,
    Stopping,
    Exited,
}
impl State {
    fn active(self) -> bool {
        matches!(
            self,
            Self::Running | Self::Ready | Self::Unknown | Self::TimedOut | Self::Stopping
        )
    }
    fn permits(self) -> bool {
        matches!(self, Self::Ready | Self::Succeeded)
    }
    fn blocks(self) -> bool {
        !matches!(
            self,
            Self::Pending | Self::Running | Self::Ready | Self::Succeeded
        )
    }
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StepRun {
    pub id: String,
    pub pane_id: String,
    #[serde(flatten)]
    pub step: ReviewedStep,
    pub state: State,
    pub runnable: bool,
    pub started_at: Option<u64>,
    pub finished_at: Option<u64>,
    pub exit_code: Option<i64>,
    pub error: Option<String>,
    pub evidence_warning: Option<String>,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Run {
    pub id: String,
    pub review_id: String,
    pub name: String,
    pub layout: Layout,
    pub project: String,
    pub profile_id: String,
    pub launch_key: Option<String>,
    pub environment: String,
    pub created_at: u64,
    pub steps: Vec<StepRun>,
}
impl Run {
    fn active(&self) -> bool {
        self.steps
            .iter()
            .any(|s| s.state == State::Pending || s.state.active())
    }
}
#[derive(Default)]
struct Runtime {
    session: Option<u32>,
    started: Option<Instant>,
    ticket: Option<String>,
    tail: String,
    sequence: u64,
}
struct LiveRun {
    view: Run,
    policy: Review,
    runtime: Vec<Runtime>,
}
impl LiveRun {
    fn refresh(&mut self) {
        for (step, runtime) in self.view.steps.iter_mut().zip(&self.runtime) {
            if step.state == State::Running
                && runtime.started.is_some_and(|t| {
                    t.elapsed() >= Duration::from_secs(step.step.definition.timeout_seconds)
                })
            {
                step.state = State::TimedOut;
                step.error=Some("Readiness deadline exceeded; the process may still be running. Stop it explicitly.".into());
            }
        }
        loop {
            let mut changed = false;
            let states: HashMap<_, _> = self
                .view
                .steps
                .iter()
                .map(|s| (s.step.definition.name.clone(), s.state))
                .collect();
            for step in self
                .view
                .steps
                .iter_mut()
                .filter(|s| s.state == State::Pending)
            {
                if let Some(dependency) = step
                    .step
                    .definition
                    .depends_on
                    .iter()
                    .find(|d| states.get(*d).is_some_and(|s| s.blocks()))
                {
                    step.state = State::Blocked;
                    step.error = Some(format!("Dependency {dependency} is no longer ready"));
                    changed = true;
                }
            }
            if !changed {
                break;
            }
        }
        let states: HashMap<_, _> = self
            .view
            .steps
            .iter()
            .map(|s| (s.step.definition.name.clone(), s.state))
            .collect();
        for step in &mut self.view.steps {
            step.runnable = step.state == State::Pending
                && step
                    .step
                    .definition
                    .depends_on
                    .iter()
                    .all(|d| states.get(d).is_some_and(|s| s.permits()));
        }
    }
    fn complete(&mut self, index: usize, exit: Option<i64>, at: u64) {
        let step = &mut self.view.steps[index];
        if step.started_at.is_none() || step.finished_at.is_some() {
            return;
        }
        let was_ready = step.state == State::Ready;
        step.finished_at = Some(at.max(step.started_at.unwrap_or(at)));
        step.exit_code = exit;
        if matches!(step.state, State::Stopping | State::Cancelled) {
            step.state = State::Cancelled;
        } else if step.state == State::TimedOut {
            step.state = State::Failed;
        } else if step.step.definition.ready_output.is_some() {
            step.state = if was_ready {
                State::Exited
            } else {
                State::Failed
            };
            step.error = Some(
                if was_ready {
                    "Service exited; its readiness is no longer valid"
                } else {
                    "Service exited before its readiness marker"
                }
                .into(),
            );
        } else if exit == Some(0) {
            step.state = State::Succeeded;
        } else {
            step.state = State::Failed;
            step.error = Some(
                exit.map(|e| format!("Command exited with status {e}"))
                    .unwrap_or_else(|| "No exit status was reported; success is unknown".into()),
            );
        }
        self.runtime[index].ticket = None;
        self.refresh();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::repo_state::tests::Repo;
    use std::sync::atomic::{AtomicUsize, Ordering};
    const SOURCE: &str = r#"
name = "Recipe project"
[workflows]
version = 1
[[workflows.recipes]]
name = "dev"
layout = "rows"
[[workflows.recipes.steps]]
name = "build"
command = "Write-Output (6*7)"
[[workflows.recipes.steps]]
name = "service"
command = "node service.cjs"
depends_on = ["build"]
ready_output = "service-ready-42"
timeout_seconds = 30
[[workflows.recipes.steps]]
name = "client"
command = "node client.cjs"
depends_on = ["service"]
"#;
    fn profile(secret: &str) -> Profile {
        Profile::custom(&serde_json::from_value(serde_json::json!({"name":"recipe-test","command":"powershell.exe -NoLogo -NoProfile","env":{"RECIPE_SECRET":secret}})).unwrap())
    }
    fn setup() -> (Repo, Store, Review, Profile) {
        let repo = Repo::new();
        fs::write(repo.dir.join(".qterm.toml"), SOURCE).unwrap();
        let store = Store::default();
        let profile = profile("private-launch-setting");
        let review = store
            .review(&repo_state::display(&repo.dir), &profile)
            .unwrap();
        (repo, store, review, profile)
    }
    fn start(store: &Store, review: &Review, profile: &Profile) -> Run {
        let bindings = review.recipes[0]
            .steps
            .iter()
            .map(|s| {
                (
                    s.definition.name.clone(),
                    format!("{}-{}", review.id, s.definition.name),
                )
            })
            .collect();
        store
            .start(
                &review.id,
                "dev",
                bindings,
                std::slice::from_ref(profile),
                true,
            )
            .unwrap()
    }
    fn launch(store: &Store, step: &StepRun, session: u32) -> Run {
        store
            .write_once(&step.id, &step.pane_id, session, None, None, |_| Ok(()))
            .unwrap()
    }
    #[test]
    fn linux_relative_folders_are_not_windows_parent_or_drive_paths(){
        let mut definitions=project::parse_settings(SOURCE).unwrap().workflows.unwrap();
        for literal in [r"..\literal", "C:literal"]{
            definitions.recipes[0].steps[0].cwd=literal.into();
            assert!(validate(&definitions).is_err());
            validate_environment(&definitions,true).unwrap();
        }
        for escape in ["../outside","/outside","child/../other"]{
            definitions.recipes[0].steps[0].cwd=escape.into();
            assert!(validate_environment(&definitions,true).is_err());
        }
    }
    #[test]
    fn cancellation_remains_responsive_during_workflow_source_validation(){
        use std::sync::mpsc;
        let (_repo,store,review,profile)=setup();
        let bindings=review.recipes[0].steps.iter().map(|step|(step.definition.name.clone(),format!("pending-{}",step.definition.name))).collect();
        let (entered_tx,entered_rx)=mpsc::channel();let (release_tx,release_rx)=mpsc::channel();let (cancel_tx,cancel_rx)=mpsc::channel();
        let (responsive,result)=std::thread::scope(|scope|{
            let worker=scope.spawn(||store.start_validated(&review.id,"dev",bindings,std::slice::from_ref(&profile),true,move|policy,profile,steps|{
                entered_tx.send(()).unwrap();release_rx.recv_timeout(Duration::from_secs(5)).unwrap();policy.validate_many(profile,steps)
            }));
            entered_rx.recv_timeout(Duration::from_secs(2)).unwrap();
            let cancel=scope.spawn(||{store.cancel_review(&review.id);cancel_tx.send(()).unwrap();});
            let responsive=cancel_rx.recv_timeout(Duration::from_secs(1)).is_ok();
            release_tx.send(()).unwrap();let result=worker.join().unwrap();cancel.join().unwrap();(responsive,result)
        });
        assert!(responsive,"workflow cancellation blocked on source I/O");
        assert!(matches!(result,Err(error) if error.contains("cancelled or expired")));
        assert!(store.snapshot().is_empty());
    }
    #[test]
    fn versioned_schema_rejects_cycles_unknown_dependencies_duplicate_names_and_unsafe_commands() {
        let original = project::parse_settings(SOURCE).unwrap().workflows.unwrap();
        validate(&original).unwrap();
        let cases = [
            SOURCE.replace("version = 1", "version = 2"),
            SOURCE.replace("[\"build\"]", "[\"missing\"]"),
            SOURCE.replace("name = \"client\"", "name = \"build\""),
            SOURCE.replace(
                "name = \"build\"\ncommand",
                "name = \"build\"\ndepends_on = [\"client\"]\ncommand",
            ),
            SOURCE.replace(
                "command = \"node client.cjs\"",
                "command = \"node\\nclient.cjs\"",
            ),
            SOURCE.replace("layout = \"rows\"", "layout = \"surprise\""),
            SOURCE.replace("timeout_seconds = 30", "timeout_seconds = 0"),
            SOURCE.replace(
                "command = \"node client.cjs\"",
                "command = \"node client.cjs\"\ncwd = \"../outside\"",
            ),
            SOURCE.replace("version = 1", "version = 1\nauto_start = true"),
        ];
        for source in cases {
            assert!(
                project::parse_settings(&source).is_err(),
                "accepted invalid workflow: {source}"
            );
        }
        assert!(
            project::parse_settings("name = 'Existing project'\n")
                .unwrap()
                .workflows
                .is_none()
        );
    }
    #[test]
    fn reviews_bind_source_folders_and_private_shell_configuration_before_any_launch() {
        let (repo, store, review, profile) = setup();
        let step = &review.recipes[0].steps[0];
        review.validate(&profile, step).unwrap();
        let serialized = serde_json::to_string(&review).unwrap();
        assert!(!serialized.contains("private-launch-setting"));
        assert!(!serialized.contains("profileKey"));
        assert!(
            review
                .validate(&self::profile("another-secret"), step)
                .is_err()
        );
        fs::write(repo.dir.join(".qterm.toml"), SOURCE.replace("6*7", "3*9")).unwrap();
        assert!(
            review
                .validate(&profile, step)
                .unwrap_err()
                .contains("source changed")
        );
        fs::write(repo.dir.join(".qterm.toml"), SOURCE).unwrap();
        let bindings = HashMap::from([
            ("build".into(), "same".into()),
            ("service".into(), "same".into()),
            ("client".into(), "other".into()),
        ]);
        assert!(
            store
                .start(
                    &review.id,
                    "dev",
                    bindings,
                    std::slice::from_ref(&profile),
                    true
                )
                .is_err()
        );
        assert!(store.snapshot().is_empty());
    }

    #[test]
    fn a_retargeted_real_junction_cannot_move_a_reviewed_step_outside_the_project() {
        use std::os::windows::process::CommandExt;
        let (repo, store, _review, profile) = setup();
        let outside = Repo::new();
        let inside = repo.dir.join("inside");
        fs::create_dir(&inside).unwrap();
        let link = repo.dir.join("linked");
        let make_link = |target: &Path| {
            assert!(
                std::process::Command::new("cmd.exe")
                    .args(["/d", "/c", "mklink", "/J"])
                    .arg(&link)
                    .arg(target)
                    .creation_flags(0x08000000)
                    .output()
                    .unwrap()
                    .status
                    .success()
            );
        };
        make_link(&inside);
        fs::write(
            repo.dir.join(".qterm.toml"),
            SOURCE.replace(
                "command = \"Write-Output (6*7)\"",
                "command = \"Write-Output (6*7)\"\ncwd = \"linked\"",
            ),
        )
        .unwrap();
        let review = store
            .review(&repo_state::display(&repo.dir), &profile)
            .unwrap();
        let step = &review.recipes[0].steps[0];
        review.validate(&profile, step).unwrap();
        fs::remove_dir(&link).unwrap();
        make_link(&outside.dir);
        assert!(review.validate(&profile, step).is_err());
        assert!(
            store
                .review(&repo_state::display(&repo.dir), &profile)
                .is_err()
        );
        fs::remove_dir(&link).unwrap();
    }
    #[test]
    fn dependency_success_is_required_and_launch_claims_and_review_submission_are_idempotent() {
        let (_repo, store, review, profile) = setup();
        let run = start(&store, &review, &profile);
        assert!(run.steps[0].runnable);
        assert!(!run.steps[1].runnable);
        assert!(
            store
                .write_once(
                    &run.steps[1].id,
                    &run.steps[1].pane_id,
                    2,
                    None,
                    None,
                    |_| panic!("dependency was not ready")
                )
                .is_err()
        );
        let count = AtomicUsize::new(0);
        let write = |command: &str| {
            assert_eq!(command, "Write-Output (6*7)");
            count.fetch_add(1, Ordering::Relaxed);
            Ok(())
        };
        store
            .write_once(
                &run.steps[0].id,
                &run.steps[0].pane_id,
                1,
                None,
                None,
                write,
            )
            .unwrap();
        assert!(
            store
                .write_once(
                    &run.steps[0].id,
                    &run.steps[0].pane_id,
                    1,
                    None,
                    None,
                    write
                )
                .is_err()
        );
        assert_eq!(count.load(Ordering::Relaxed), 1);
        let bindings = run
            .steps
            .iter()
            .map(|s| (s.step.definition.name.clone(), s.pane_id.clone()))
            .collect();
        assert_eq!(
            store
                .start(
                    &review.id,
                    "dev",
                    bindings,
                    std::slice::from_ref(&profile),
                    true
                )
                .unwrap()
                .id,
            run.id
        );
        store.completed(&run.steps[0].id, Some(0), repo_state::now());
        assert!(store.snapshot()[0].steps[1].runnable);
        // Retried completion cannot change the successful command's outcome.
        store.completed(&run.steps[0].id, Some(1), repo_state::now());
        assert_eq!(store.snapshot()[0].steps[0].state, State::Succeeded);
    }
    #[test]
    fn failed_or_unknown_exit_blocks_the_graph_and_cancel_leaves_running_steps_owned() {
        for exit in [None, Some(7)] {
            let (_repo, store, review, profile) = setup();
            let run = start(&store, &review, &profile);
            launch(&store, &run.steps[0], 1);
            store.completed(&run.steps[0].id, exit, repo_state::now());
            let after = store.snapshot();
            assert_eq!(after[0].steps[0].state, State::Failed);
            assert_eq!(after[0].steps[1].state, State::Blocked);
            assert_eq!(after[0].steps[2].state, State::Blocked);
        }
        let (_repo, store, review, profile) = setup();
        let run = start(&store, &review, &profile);
        launch(&store, &run.steps[0], 1);
        store.cancel_pending(&run.id).unwrap();
        let after = store.snapshot();
        assert_eq!(after[0].steps[0].state, State::Running);
        assert_eq!(after[0].steps[1].state, State::Cancelled);
        store.completed(&run.steps[0].id, Some(0), repo_state::now());
        assert!(!store.snapshot()[0].steps[1].runnable);
    }
    #[test]
    fn service_readiness_uses_ordered_current_output_and_expires_when_the_service_exits() {
        let (_repo, store, review, profile) = setup();
        let run = start(&store, &review, &profile);
        launch(&store, &run.steps[0], 1);
        store.completed(&run.steps[0].id, Some(0), repo_state::now());
        launch(&store, &run.steps[1], 2);
        let mut inner = store.inner.lock().unwrap();
        let live = &mut inner.runs[0];
        let pane = &run.steps[1].pane_id;
        assert!(
            live.observe(1, "foreign", 2, 1, "service-ready-42")
                .is_err()
        );
        assert!(live.observe(1, pane, 99, 1, "service-ready-42").is_err());
        live.observe(1, pane, 2, 1, "service-").unwrap();
        assert_eq!(live.view.steps[1].state, State::Running);
        live.observe(1, pane, 2, 1, "ready-42").unwrap();
        assert_eq!(
            live.view.steps[1].state,
            State::Running,
            "duplicate sequence is ignored"
        );
        live.observe(1, pane, 2, 2, "ready-42").unwrap();
        assert_eq!(live.view.steps[1].state, State::Ready);
        assert!(live.view.steps[2].runnable);
        live.complete(1, Some(0), repo_state::now());
        assert_eq!(live.view.steps[1].state, State::Exited);
        assert_eq!(live.view.steps[2].state, State::Blocked);
    }
    #[test]
    fn readiness_deadline_and_uncertain_writes_never_unlock_dependencies_or_retry() {
        let (_repo, store, review, profile) = setup();
        let run = start(&store, &review, &profile);
        launch(&store, &run.steps[0], 1);
        store.completed(&run.steps[0].id, Some(0), repo_state::now());
        launch(&store, &run.steps[1], 2);
        {
            let mut inner = store.inner.lock().unwrap();
            let live = &mut inner.runs[0];
            live.runtime[1].started = Instant::now().checked_sub(Duration::from_secs(31));
            live.observe(1, &run.steps[1].pane_id, 2, 1, "service-ready-42")
                .unwrap();
            assert_eq!(live.view.steps[1].state, State::TimedOut);
            assert_eq!(live.view.steps[2].state, State::Blocked);
            assert!(
                live.view.active(),
                "timed-out process still needs an explicit stop"
            );
        }
        let (_repo, store, review, profile) = setup();
        let run = start(&store, &review, &profile);
        store
            .write_once(
                &run.steps[0].id,
                &run.steps[0].pane_id,
                1,
                None,
                None,
                |_| Err("partial write".into()),
            )
            .unwrap();
        assert_eq!(store.snapshot()[0].steps[0].state, State::Unknown);
        assert!(
            store
                .write_once(
                    &run.steps[0].id,
                    &run.steps[0].pane_id,
                    1,
                    None,
                    None,
                    |_| panic!("never repeat an uncertain write")
                )
                .is_err()
        );
        assert_eq!(store.snapshot()[0].steps[1].state, State::Blocked);
    }
    #[test]
    fn native_recipe_identity_is_attested_and_retained_with_command_history() {
        let (repo, store, review, profile) = setup();
        let run = start(&store, &review, &profile);
        launch(&store, &run.steps[0], 1);
        let step = &run.steps[0];
        let mut record = run_records::Run {
            id: step.id.clone(),
            pane_id: step.pane_id.clone(),
            profile_id: Some(profile.id.clone()),
            shell_kind: Some("powershell".into()),
            app_run_id: None,
            environment: None,
            cwd: Some("forged folder".into()),
            command: step.step.definition.command.clone(),
            command_truncated: false,
            exit_code: Some(0),
            started_at: 0,
            finished_at: repo_state::now(),
            output: "42".into(),
            output_truncated: false,
            verification: None,
            requester: None,
        };
        store.attest(&mut record).unwrap();
        assert_eq!(record.cwd.as_deref(), Some(review.project.as_str()));
        assert!(record.started_at > 0);
        assert_eq!(record.requester.as_ref().unwrap().client, "Workflow dev");
        let history_path = repo.dir.join("target/recipe-results.json");
        let history = run_records::Store::load(history_path.clone());
        history.append(record.clone(), None).unwrap();
        let restored = run_records::Store::load(history_path).snapshot();
        assert_eq!(
            restored.runs[0].requester.as_ref().unwrap().task_name,
            "build"
        );
        record.pane_id = "foreign".into();
        assert!(store.attest(&mut record).is_err());
        assert!(
            Store::default().snapshot().is_empty(),
            "new app has no live recipe permissions or pending commands"
        );
    }
}
#[derive(Default)]
struct Inner {
    reviews: HashMap<String, Review>,
    runs: Vec<LiveRun>,
}
#[derive(Default)]
pub struct Store {
    inner: Mutex<Inner>,
}
pub struct Launch<'a> {
    pub revalidate: &'a dyn Fn(&Profile)->Result<(),String>,
    pub cwd: &'a str,
    pub sessions: &'a SessionManager,
    pub profiles: &'a [Profile],
    pub integrate: bool,
    pub records: &'a run_records::Store,
}
impl Store {
    pub fn review(&self, cwd: &str, profile: &Profile) -> Result<Review, String> {
        let review = Review::read(cwd, profile)?;
        let mut inner = self.inner.lock().unwrap();
        inner.reviews.retain(|_, r| {
            r.created
                .is_some_and(|t| t.elapsed() < Duration::from_secs(600))
        });
        if inner.reviews.len() >= 16 {
            return Err("Too many pending workflow reviews; close an older review".into());
        }
        inner.reviews.insert(review.id.clone(), review.clone());
        Ok(review)
    }
    pub fn cancel_review(&self, id: &str) {
        self.inner.lock().unwrap().reviews.remove(id);
    }
    pub fn start(
        &self,
        review_id: &str,
        recipe: &str,
        bindings: HashMap<String, String>,
        profiles: &[Profile],
        integrate: bool,
    ) -> Result<Run, String> {
        self.start_validated(review_id,recipe,bindings,profiles,integrate,|policy,profile,steps|policy.validate_many(profile,steps))
    }
    fn start_validated(&self,review_id:&str,recipe:&str,bindings:HashMap<String,String>,profiles:&[Profile],integrate:bool,validate:impl FnOnce(&Review,&Profile,&[ReviewedStep])->Result<(),String>)->Result<Run,String>{
        let existing=|inner:&Inner|->Result<Option<Run>,String>{
        if let Some(run) = inner.runs.iter().find(|r| r.view.review_id == review_id) {
            if run.view.name != recipe
                || run
                    .view
                    .steps
                    .iter()
                    .any(|s| bindings.get(&s.step.definition.name) != Some(&s.pane_id))
                || bindings.len() != run.view.steps.len()
            {
                return Err("Review already launched with different pane bindings".into());
            }
            return Ok(Some(run.view.clone()));
        }
        Ok(None)};
        let policy = {let inner=self.inner.lock().unwrap();
        if let Some(run)=existing(&inner)?{return Ok(run);}
        if !integrate{return Err("Enable shell integration before launching a workflow".into());}
        inner
            .reviews
            .get(review_id)
            .ok_or("Workflow review expired; review again")?
            .clone()};
        if policy
            .created
            .is_none_or(|t| t.elapsed() >= Duration::from_secs(600))
        {
            return Err("Workflow review expired; review again".into());
        }
        let definition = policy
            .recipes
            .iter()
            .find(|r| r.name == recipe)
            .ok_or("Workflow not found in review")?;
        let profile = profiles
            .iter()
            .find(|p| p.id == policy.profile_id)
            .ok_or("Reviewed shell is unavailable")?;
        let panes: HashSet<_> = bindings.values().collect();
        if bindings.len() != definition.steps.len()
            || panes.len() != bindings.len()
            || bindings.values().any(|s| s.is_empty() || s.len() > 128)
        {
            return Err("Bind one unique new pane to every workflow step".into());
        }
        validate(&policy,profile,&definition.steps)?;
        let mut inner=self.inner.lock().unwrap();
        if let Some(run)=existing(&inner)?{return Ok(run);}
        if !inner.reviews.contains_key(review_id)||policy.created.is_none_or(|time|time.elapsed()>=Duration::from_secs(600)){return Err("Workflow review cancelled or expired during validation".into());}
        if inner.runs.iter().filter(|r| r.view.active()).count() >= 4 {
            return Err("Four workflows are already active".into());
        }
        let mut steps = vec![];
        for step in &definition.steps {
            let pane = bindings
                .get(&step.definition.name)
                .ok_or("Missing step pane")?;
            if inner
                .runs
                .iter()
                .any(|r| r.view.active() && r.view.steps.iter().any(|s| s.pane_id == *pane))
            {
                return Err("Pane already belongs to another active workflow".into());
            }
            steps.push(StepRun {
                id: format!("recipe-{}", agent_pipe::random()?),
                pane_id: pane.clone(),
                step: step.clone(),
                state: State::Pending,
                runnable: false,
                started_at: None,
                finished_at: None,
                exit_code: None,
                error: None,
                evidence_warning: None,
            });
        }
        let view = Run {
            id: agent_pipe::random()?,
            review_id: review_id.into(),
            name: recipe.into(),
            layout: definition.layout,
            project: policy.project.clone(),
            profile_id: policy.profile_id.clone(),
            launch_key:policy.launch_key.clone(),
            environment:policy.environment.clone(),
            created_at: repo_state::now(),
            steps,
        };
        let runtime = (0..view.steps.len()).map(|_| Runtime::default()).collect();
        let mut run = LiveRun {
            view,
            policy,
            runtime,
        };
        run.refresh();
        inner.reviews.remove(review_id);
        while inner.runs.len() >= MAX_RUNS {
            let at = inner
                .runs
                .iter()
                .position(|r| !r.view.active())
                .ok_or("Workflow history is full")?;
            inner.runs.remove(at);
        }
        let view = run.view.clone();
        inner.runs.push(run);
        Ok(view)
    }
    pub fn snapshot(&self) -> Vec<Run> {
        let mut inner = self.inner.lock().unwrap();
        for run in &mut inner.runs {
            run.refresh();
        }
        inner.runs.iter().map(|r| r.view.clone()).collect()
    }
    pub fn launch(
        &self,
        id: &str,
        pane: &str,
        session: u32,
        context: Launch<'_>,
    ) -> Result<Run, String> {
        let (policy, step) = {
            let mut inner = self.inner.lock().unwrap();
            let run = inner
                .runs
                .iter_mut()
                .find(|r| r.view.steps.iter().any(|s| s.id == id))
                .ok_or("Workflow step not found")?;
            run.refresh();
            let step = run
                .view
                .steps
                .iter()
                .find(|s| s.id == id)
                .ok_or("Workflow step not found")?;
            if !step.runnable || step.pane_id != pane {
                return Err("Workflow step is not eligible for launch in this pane".into());
            }
            (run.policy.clone(), step.clone())
        };
        let profile = context
            .profiles
            .iter()
            .find(|p| p.id == policy.profile_id)
            .ok_or("Reviewed shell is unavailable")?;
        policy.check_launch(profile,&step.step,pane,session,&context)?;
        let prepared=if let Some(distribution)=policy.environment.strip_prefix("wsl:"){
            context.records.prepare_wsl(distribution,&step.step.directory,&step.step.definition.command,profile)
        }else{context.records.prepare(&step.step.directory,&step.step.definition.command)};
        let (mut ticket, mut warning) = match prepared {
            Ok(p) => (Some(p.id), None),
            Err(e) => (None, Some(e)),
        };
        let result = (|| {
            policy.check_launch(profile,&step.step,pane,session,&context)?;
            if policy.linux_source.is_some()&&let Some(id)=ticket.clone(){
                // Coverage failures are evidence warnings; launch policy still
                // requires its own fresh source, session and directory checks.
                if let Err(error)=context.records.authorize_wsl(&id,pane,&|launch|{
                    if launch.profile_id!=policy.profile_id||launch.profile_key!=policy.profile_key||launch.environment!=policy.environment||launch.cwd!=step.step.directory{return Err("Workflow evidence belongs to another launch context".into());}
                    policy.check_launch(profile,&step.step,pane,session,&context)
                }){
                    context.records.cancel(&id);ticket=None;warning=Some(error);
                }
            }
            let programs = context.sessions.programs(&[session])?;
            if !programs.is_empty() {
                return Err(format!(
                    "Workflow shell is busy ({}); no command typed",
                    programs.join(", ")
                ));
            }
            policy.check_launch(profile,&step.step,pane,session,&context)?;
            self.write_once(id, pane, session, ticket.clone(), warning, |command| {
                (context.revalidate)(profile)?;
                if policy.binding(context.sessions,session).as_ref()!=Some(&(pane.into(),policy.profile_key.clone())){return Err("Workflow session changed before submission".into());}
                context.sessions.write(session, &format!("{command}\r"))
            })
        })();
        if result.is_err()
            && let Some(ticket) = ticket
        {
            context.records.cancel(&ticket);
        }
        result
    }
    fn write_once(
        &self,
        id: &str,
        pane: &str,
        session: u32,
        ticket: Option<String>,
        warning: Option<String>,
        write: impl FnOnce(&str) -> Result<(), String>,
    ) -> Result<Run, String> {
        let mut inner = self.inner.lock().unwrap();
        if inner
            .runs
            .iter()
            .flat_map(|r| &r.view.steps)
            .filter(|s| s.state.active())
            .count()
            >= 16
        {
            return Err("Sixteen workflow steps are already running".into());
        }
        let run = inner
            .runs
            .iter_mut()
            .find(|r| r.view.steps.iter().any(|s| s.id == id))
            .ok_or("Workflow step not found")?;
        run.refresh();
        let at = run
            .view
            .steps
            .iter()
            .position(|s| s.id == id)
            .ok_or("Workflow step not found")?;
        let step = &mut run.view.steps[at];
        if !step.runnable || step.pane_id != pane {
            return Err("Workflow was cancelled, started, or lost dependency readiness".into());
        }
        step.state = State::Running;
        step.started_at = Some(repo_state::now());
        step.runnable = false;
        step.evidence_warning = warning;
        run.runtime[at] = Runtime {
            session: Some(session),
            started: Some(Instant::now()),
            ticket,
            ..Runtime::default()
        };
        if let Err(e) = write(&step.step.definition.command) {
            step.state = State::Unknown;
            step.error = Some(format!(
                "PTY write outcome is unknown; never retry automatically: {e}"
            ));
        }
        run.refresh();
        Ok(run.view.clone())
    }
    pub fn output(
        &self,
        id: &str,
        pane: &str,
        session: u32,
        sequence: u64,
        text: &str,
        sessions: &SessionManager,
    ) -> Result<(), String> {
        if text.len() > 65_536 {
            return Err("Workflow output frame exceeds 64 KiB".into());
        }
        let mut inner = self.inner.lock().unwrap();
        let run = inner
            .runs
            .iter_mut()
            .find(|r| r.view.steps.iter().any(|s| s.id == id))
            .ok_or("Workflow step not found")?;
        let at = run
            .view
            .steps
            .iter()
            .position(|s| s.id == id)
            .ok_or("Workflow step not found")?;
        if run.policy.binding(sessions,session).as_ref()
            != Some(&(pane.into(), run.policy.profile_key.clone()))
        {
            return Err("Workflow observation came from another shell".into());
        }
        run.observe(at, pane, session, sequence, text)
    }
    pub fn fail(&self, id: &str, message: &str, records: &run_records::Store) {
        let mut inner = self.inner.lock().unwrap();
        if let Some(run) = inner
            .runs
            .iter_mut()
            .find(|r| r.view.steps.iter().any(|s| s.id == id))
            && let Some(at) = run.view.steps.iter().position(|s| s.id == id)
        {
            let step = &mut run.view.steps[at];
            if step.state == State::Pending {
                step.state = State::Failed;
                step.error = Some(message.chars().take(2000).collect());
                if let Some(ticket) = run.runtime[at].ticket.take() {
                    records.cancel(&ticket);
                }
            } else if step.state.active() {
                step.state = State::Unknown;
                step.error = Some(message.chars().take(2000).collect());
                if let Some(ticket)=run.runtime[at].ticket.take(){records.cancel(&ticket);}
            }
            run.refresh();
        }
    }
    pub fn cancel_pending(&self, id: &str) -> Result<(), String> {
        let mut inner = self.inner.lock().unwrap();
        let run = inner
            .runs
            .iter_mut()
            .find(|r| r.view.id == id)
            .ok_or("Workflow run not found")?;
        for step in &mut run.view.steps {
            if step.state == State::Pending {
                step.state = State::Cancelled;
                step.error = Some("Cancelled before launch".into());
            }
        }
        run.refresh();
        Ok(())
    }
    pub fn stop(&self, id: &str, sessions: &SessionManager) -> Result<(), String> {
        let (policy,requests,mut errors)={
        let mut inner = self.inner.lock().unwrap();
        let run = inner
            .runs
            .iter_mut()
            .find(|r| r.view.id == id)
            .ok_or("Workflow run not found")?;
        let mut requests=vec![];
        let mut errors=vec![];
        for (step, runtime) in run.view.steps.iter_mut().zip(&run.runtime) {
            if step.state == State::Pending {
                step.state = State::Cancelled;
                step.error = Some("Stopped before launch".into());
            } else if step.state.active() {
                step.state = State::Stopping;
                if let Some(session) = runtime.session {
                    requests.push((step.id.clone(),step.pane_id.clone(),session));
                }else{
                    step.state=State::Unknown;step.error=Some("Original workflow session is unavailable".into());
                    errors.push(step.step.definition.name.clone());
                }
            }
        }
        run.refresh();
        (run.policy.clone(),requests,errors)};
        for (step_id,pane,session) in requests{
            let result=(||{
                {
                    let inner=self.inner.lock().unwrap();
                    let Some(run)=inner.runs.iter().find(|run|run.view.id==id) else{return Ok(());};
                    let Some(at)=run.view.steps.iter().position(|step|step.id==step_id) else{return Ok(());};
                    if run.view.steps[at].state!=State::Stopping||run.runtime[at].session!=Some(session){return Ok(());}
                    if policy.binding(sessions,session).as_ref()!=Some(&(pane,policy.profile_key.clone())){return Err("Original workflow shell is unavailable".into());}
                    sessions.write(session,"\u{3}")?;
                }
                // Linux inspection/Stop can wait on a separate distribution.
                // Keep store reads, completion events and cancellation responsive.
                sessions.stop_programs(session).map(|_|())
            })();
            if let Err(error)=result{
                let mut inner=self.inner.lock().unwrap();
                if let Some(run)=inner.runs.iter_mut().find(|run|run.view.id==id)&&let Some(step)=run.view.steps.iter_mut().find(|step|step.id==step_id)&&step.state==State::Stopping{
                    step.state=State::Unknown;step.error=Some(error);errors.push(step.step.definition.name.clone());run.refresh();
                }
            }
        }
        if errors.is_empty() {
            Ok(())
        } else {
            Err(format!(
                "Could not stop workflow steps: {}",
                errors.join(", ")
            ))
        }
    }
    pub fn attest(&self, record: &mut run_records::Run) -> Result<Option<String>, String> {
        let inner = self.inner.lock().unwrap();
        let Some(run) = inner
            .runs
            .iter()
            .find(|r| r.view.steps.iter().any(|s| s.id == record.id))
        else {
            return Ok(None);
        };
        let at = run
            .view
            .steps
            .iter()
            .position(|s| s.id == record.id)
            .ok_or("Workflow step not found")?;
        let step = &run.view.steps[at];
        if step.pane_id != record.pane_id
            || record.profile_id.as_ref() != Some(&run.view.profile_id)
            || step.step.definition.command.trim() != record.command.trim()
        {
            return Err("Command result does not match the reviewed workflow step".into());
        }
        if run.policy.linux_source.is_some()&&(record.environment.as_deref()!=Some(&run.view.environment)||record.shell_kind.as_deref()!=Some("wsl")||record.cwd.as_deref()!=Some(&step.step.directory)){return Err("Command result came from another workflow environment or folder".into());}
        record.started_at = step.started_at.ok_or("Workflow step never launched")?;
        record.finished_at = record.finished_at.max(record.started_at);
        record.cwd = Some(step.step.directory.clone());
        record.requester = Some(agent_tasks::Requester {
            client: format!("Workflow {}", run.view.name),
            grant_id: format!("recipe:{}", run.view.id),
            task_id: step.id.clone(),
            task_name: step.step.definition.name.clone(),
            request_id: run.view.id.clone(),
        });
        record.environment=Some(run.view.environment.clone());
        Ok(run.runtime[at].ticket.clone())
    }
    pub fn completed(&self, id: &str, exit: Option<i64>, at: u64) {
        let mut inner = self.inner.lock().unwrap();
        if let Some(run) = inner
            .runs
            .iter_mut()
            .find(|r| r.view.steps.iter().any(|s| s.id == id))
            && let Some(index) = run.view.steps.iter().position(|s| s.id == id)
        {
            run.complete(index, exit, at);
        }
    }
}
impl LiveRun {
    fn observe(
        &mut self,
        at: usize,
        pane: &str,
        session: u32,
        sequence: u64,
        text: &str,
    ) -> Result<(), String> {
        self.refresh();
        let step = &mut self.view.steps[at];
        let runtime = &mut self.runtime[at];
        if step.pane_id != pane || runtime.session != Some(session) {
            return Err("Workflow output belongs to another pane/session".into());
        }
        if sequence <= runtime.sequence {
            return Ok(());
        }
        runtime.sequence = sequence;
        if step.state == State::Running
            && let Some(marker) = &step.step.definition.ready_output
        {
            runtime.tail.push_str(text);
            if runtime.tail.contains(marker) {
                step.state = State::Ready;
            }
            let keep = marker.chars().count().saturating_sub(1);
            runtime.tail = runtime
                .tail
                .chars()
                .rev()
                .take(keep)
                .collect::<String>()
                .chars()
                .rev()
                .collect();
        }
        self.refresh();
        Ok(())
    }
}
