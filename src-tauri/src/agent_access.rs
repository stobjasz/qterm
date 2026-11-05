//! Session-only project grants. Same-user capabilities make automation explicit;
//! they do not sandbox other processes running as the developer.
use crate::{
    agent_pipe,
    agent_scope::Scope,
    agent_tasks::{self, Invocation, Policy},
    pty::{Profile, SessionManager},
    repo_state, run_records,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    fs::{self, File},
    io::Read,
    path::PathBuf,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Review {
    pub id: String,
    pub project: String,
    pub environment: String,
    pub execution: Option<Policy>,
}
#[derive(Clone)]
struct Pending {
    review: Review,
    scope: Scope,
    at: Instant,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GrantView {
    pub id: String,
    pub client: String,
    pub project: String,
    pub environment: String,
    pub connection_file: String,
    pub created_at: u64,
    pub tasks: Vec<agent_tasks::Task>,
    pub profile_id: Option<String>,
}
struct Grant {
    view: GrantView,
    scope: Scope,
    token: String,
    _credentials: File,
    execution: Option<Policy>,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Pane {
    pub id: String,
    pub cwd: Option<String>,
    pub label: String,
    pub profile_id: String,
    pub kind: String,
    #[serde(default)]
    pub environment: Option<String>,
}
struct Inner {
    grants: Vec<Grant>,
    reviews: HashMap<String, Pending>,
    listener: Option<agent_pipe::Listener>,
    panes: Vec<Pane>,
    observed: u64,
    revision: u64,
}
pub struct Access {
    directory: PathBuf,
    inner: Mutex<Inner>,
    pub queue: agent_tasks::Queue,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub grants: Vec<GrantView>,
    pub listening: bool,
    pub revision: u64,
    pub executable: String,
    pub invocations: Vec<Invocation>,
}
pub struct ExecutionContext<'a> {
    pub profiles: &'a [Profile],
    pub integrate: bool,
    pub emit: &'a dyn Fn(&Invocation) -> Result<(), String>,
}
pub struct LaunchContext<'a> {
    pub revalidate: &'a dyn Fn(&Profile)->Result<(),String>,
    pub cwd: &'a str,
    pub sessions: &'a SessionManager,
    pub profiles: &'a [Profile],
    pub integrate: bool,
    pub records: &'a run_records::Store,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RunRequest {
    task_id: String,
    request_id: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StatusRequest {
    run_id: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Request {
    version: u32,
    #[serde(default)]
    id: Option<String>,
    token: String,
    method: String,
    #[serde(default = "empty")]
    params: Value,
}
fn empty() -> Value {
    json!({})
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Empty {}
#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct List {
    pane_id: Option<String>,
    after: Option<String>,
    limit: Option<usize>,
}
#[derive(Default, Deserialize)]
#[serde(deny_unknown_fields)]
struct Page {
    after: Option<String>,
    limit: Option<usize>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ResultRequest {
    command_id: String,
    #[serde(default)]
    offset: usize,
    limit: Option<usize>,
}
fn constant_equal(left: &str, right: &str) -> bool {
    left.len() == right.len()
        && left
            .bytes()
            .zip(right.bytes())
            .fold(0u8, |acc, (l, r)| acc | (l ^ r))
            == 0
}
#[cfg(test)]
fn inside(root: &std::path::Path, cwd: &str) -> bool {
    repo_state::native_folder(cwd).is_ok_and(|path| path.starts_with(root))
}
fn error(id: Option<&str>, code: &str, message: &str) -> Value {
    json!({ "version": 1, "id": id, "error": { "code": code, "message": message } })
}
fn parse<T: serde::de::DeserializeOwned>(params: Value) -> Result<T, (&'static str, String)> {
    serde_json::from_value(params).map_err(|_| {
        (
            "invalid_params",
            "Invalid parameters for this method".into(),
        )
    })
}
impl Access {
    pub fn new(directory: PathBuf) -> Self {
        Self {
            directory,
            queue: agent_tasks::Queue::default(),
            inner: Mutex::new(Inner {
                grants: vec![],
                reviews: HashMap::new(),
                listener: None,
                panes: vec![],
                observed: 0,
                revision: 0,
            }),
        }
    }
    pub fn snapshot(&self) -> Snapshot {
        let inner = self.inner.lock().unwrap();
        Snapshot {
            grants: inner.grants.iter().map(|g| g.view.clone()).collect(),
            listening: inner.listener.as_ref().is_some_and(|l| l.is_running()),
            revision: inner.revision,
            executable: std::env::current_exe()
                .map(|p| repo_state::display(&p))
                .unwrap_or_default(),
            invocations: self.queue.snapshot(),
        }
    }
    pub fn review(&self, cwd: &str) -> Result<Review, String> {
        self.review_execution(cwd, None)
    }
    pub fn review_execution(&self, cwd: &str, profile: Option<&Profile>) -> Result<Review, String> {
        self.review_environment(cwd, "native", profile)
    }
    pub fn review_environment(&self, cwd: &str, environment: &str, profile: Option<&Profile>) -> Result<Review, String> {
        let scope = Scope::capture(cwd, environment)?;
        let review = Review {
            id: agent_pipe::random()?,
            project: scope.project(),
            environment: scope.environment(),
            execution: match profile {
                Some(p) => Some(Policy::review_scope(&scope, cwd, p)?),
                None => None,
            },
        };
        let mut inner = self.inner.lock().unwrap();
        inner
            .reviews
            .retain(|_, p| p.at.elapsed() < Duration::from_secs(600));
        if inner.reviews.len() >= 16 {
            return Err("Too many open project reviews; close old reviews first".into());
        }
        inner.reviews.insert(
            review.id.clone(),
            Pending {
                review: review.clone(),
                scope,
                at: Instant::now(),
            },
        );
        Ok(review)
    }
    pub fn cancel_review(&self, id: &str) {
        self.inner.lock().unwrap().reviews.remove(id);
    }
    pub fn grant(
        &self,
        review: &str,
        client: &str,
        handler: Arc<dyn Fn(Value) -> Value + Send + Sync>,
    ) -> Result<Snapshot, String> {
        self.grant_selected(review, client, &[], None, handler)
    }
    pub fn review_profile(&self, id: &str) -> Option<String> {
        self.inner
            .lock()
            .unwrap()
            .reviews
            .get(id)?
            .review
            .execution
            .as_ref()
            .map(|p| p.profile_id.clone())
    }
    pub fn grant_selected(
        &self,
        review: &str,
        client: &str,
        selected: &[String],
        profile: Option<&Profile>,
        handler: Arc<dyn Fn(Value) -> Value + Send + Sync>,
    ) -> Result<Snapshot, String> {
        if client.trim().is_empty()
            || client.encode_utf16().count() > 128
            || client.chars().any(char::is_control)
        {
            return Err("Enter a client label of 1–128 characters".into());
        }
        let pending = self
            .inner
            .lock()
            .unwrap()
            .reviews
            .get(review)
            .cloned()
            .ok_or("Project review expired; review the folder again")?;
        if pending.at.elapsed() > Duration::from_secs(600) {
            return Err("Project folder changed; review it again".into());
        }
        pending.scope.validate()?;
        let execution = if selected.is_empty() {
            None
        } else {
            let policy = pending
                .review
                .execution
                .as_ref()
                .ok_or("This review did not include execution")?
                .select(selected)?;
            let profile = profile.ok_or("Reviewed shell is no longer available")?;
            policy.validate_tasks_scope(&pending.scope, &policy.tasks, profile)?;
            Some(policy)
        };
        self.commit_grant(review, pending, execution, client, handler)
    }
    fn commit_grant(
        &self,
        review: &str,
        pending: Pending,
        execution: Option<Policy>,
        client: &str,
        handler: Arc<dyn Fn(Value) -> Value + Send + Sync>,
    ) -> Result<Snapshot, String> {
        let mut inner = self.inner.lock().unwrap();
        if !inner.reviews.get(review).is_some_and(|current| current.at == pending.at)
            || pending.at.elapsed() > Duration::from_secs(600) {
            return Err("Project review was cancelled or expired; review it again".into());
        }
        if inner.grants.len() >= 16 {
            return Err("At most 16 agent grants can be active".into());
        }
        if inner.listener.as_ref().is_some_and(|l| !l.is_running()) {
            return Err(
                "The agent listener stopped. Revoke its grants, then create a new one".into(),
            );
        }
        fs::create_dir_all(&self.directory)
            .map_err(|e| format!("Could not create agent connection folder: {e}"))?;
        let id = agent_pipe::random()?;
        let token = agent_pipe::random()?;
        if inner.listener.is_none() {
            inner.listener = Some(agent_pipe::Listener::start(handler)?);
        }
        let path = self.directory.join(format!("connection-{id}.json"));
        let credentials =
            json!({ "version": 1, "pipe": inner.listener.as_ref().unwrap().name, "token": token });
        let file = match agent_pipe::credentials(
            &path,
            &serde_json::to_vec(&credentials).map_err(|e| e.to_string())?,
        ) {
            Ok(file) => file,
            Err(e) => {
                if inner.grants.is_empty() {
                    inner.listener = None;
                }
                return Err(e);
            }
        };
        let view = GrantView {
            id,
            client: client.trim().into(),
            project: pending.review.project,
            environment: pending.review.environment,
            connection_file: repo_state::display(&path),
            created_at: repo_state::now(),
            tasks: execution
                .as_ref()
                .map(|p| p.tasks.clone())
                .unwrap_or_default(),
            profile_id: execution.as_ref().map(|p| p.profile_id.clone()),
        };
        inner.grants.push(Grant {
            view,
            scope: pending.scope,
            token,
            _credentials: file,
            execution,
        });
        inner.reviews.remove(review);
        inner.revision += 1;
        drop(inner);
        Ok(self.snapshot())
    }
    pub fn revoke(&self, id: &str) -> Result<Snapshot, String> {
        let mut inner = self.inner.lock().unwrap();
        let index = inner
            .grants
            .iter()
            .position(|g| g.view.id == id)
            .ok_or("Grant is no longer active")?;
        inner.grants.remove(index);
        self.queue.revoke(id);
        if inner.grants.is_empty() {
            inner.listener = None;
        }
        inner.revision += 1;
        drop(inner);
        Ok(self.snapshot())
    }
    pub fn publish(&self, panes: Vec<Pane>) -> Result<(), String> {
        if panes.len() > 256
            || panes.iter().any(|p| {
                p.id.len() > 128
                    || p.label.len() > 2048
                    || p.profile_id.len() > 512
                    || p.environment.as_ref().is_some_and(|e| e.len() > 512)
                    || p.cwd.as_ref().is_some_and(|c| c.len() > 16384)
            })
        {
            return Err("Invalid pane observations".into());
        }
        let mut inner = self.inner.lock().unwrap();
        inner.panes = panes;
        inner.observed = repo_state::now();
        Ok(())
    }
    fn authorized(&self, token: &str) -> Option<Scope> {
        let scope = {
            let inner = self.inner.lock().unwrap();
            let grant = inner
                .grants
                .iter()
                .find(|g| constant_equal(&g.token, token))?;
            grant.scope.clone()
        };
        scope.validate().ok()?;
        Some(scope)
    }
    #[cfg(test)]
    pub fn request(&self, value: Value, records: &run_records::Store) -> Value {
        self.request_execution(value, records, None)
    }
    pub fn request_execution(
        &self,
        value: Value,
        records: &run_records::Store,
        context: Option<ExecutionContext<'_>>,
    ) -> Value {
        let request: Request = match serde_json::from_value(value) {
            Ok(r) => r,
            Err(_) => {
                return error(
                    None,
                    "invalid_request",
                    "Expected a version-1 method, token and parameters",
                );
            }
        };
        let id = request
            .id
            .as_deref()
            .filter(|id| id.len() <= 128 && !id.chars().any(char::is_control));
        if request.version != 1 {
            return error(
                id,
                "unsupported_version",
                "Only protocol version 1 is supported",
            );
        }
        let Some(root) = self.authorized(&request.token) else {
            return error(
                id,
                "access_denied",
                "The session project grant is not active",
            );
        };
        let result = match request.method.as_str() {
            "tasks.list" => {
                let execution = {
                    let inner = self.inner.lock().unwrap();
                    inner
                        .grants
                        .iter()
                        .find(|g| constant_equal(&g.token, &request.token))
                        .and_then(|g| g.execution.clone())
                };
                if let Some(policy) = execution {
                    self.selected_tasks(policy, request.params)
                } else {
                    self.read(&root, &request.method, request.params, records)
                }
            }
            "tasks.run" => self.run_task(&request.token, &root, request.params, context),
            "tasks.status" => {
                let params: Result<StatusRequest, _> = parse(request.params);
                params
                    .and_then(|p| self.queue.get(&p.run_id).map_err(|e| ("not_available", e)))
                    .and_then(|job| {
                        if root.same_project(&job.environment, &job.project) {
                            Ok(serde_json::to_value(job).unwrap())
                        } else {
                            Err(("not_available", "Task run is outside this project".into()))
                        }
                    })
            }
            _ => self.read(&root, &request.method, request.params, records),
        };
        if self.authorized(&request.token).is_none() {
            return error(
                id,
                "access_denied",
                "The session project grant is no longer active",
            );
        }
        match result {
            Ok(value) => json!({ "version": 1, "id": id, "result": value }),
            Err((code, message)) => error(id, code, &message),
        }
    }
    fn policy(&self, grant_id: &str) -> Result<(Scope, Policy), String> {
        let inner = self.inner.lock().unwrap();
        let grant = inner
            .grants
            .iter()
            .find(|g| g.view.id == grant_id)
            .ok_or("Execution grant is no longer active")?;
        Ok((
            grant.scope.clone(),
            grant
                .execution
                .clone()
                .ok_or("This grant has no task execution capability")?,
        ))
    }
    fn selected_tasks(
        &self,
        policy: Policy,
        params: Value,
    ) -> Result<Value, (&'static str, String)> {
        let params: Page = parse(params)?;
        let start = match params.after {
            None => 0,
            Some(id) => policy
                .tasks
                .iter()
                .position(|t| t.id == id)
                .map(|i| i + 1)
                .ok_or(("cursor_expired", "Task is not in this grant".into()))?,
        };
        let page:Vec<_>=policy.tasks.iter().skip(start).take(params.limit.unwrap_or(25).clamp(1,25)).map(|task| {
            let name:String=task.name.chars().take(512).collect(); let command:String=task.command.chars().take(1024).collect();
            json!({"id":task.id,"name":name,"command":command,"source":task.source,"directory":task.directory,"manifestDigest":task.manifest_digest,"truncated":name.len()<task.name.len() || command.len()<task.command.len(),"executionAllowed":true})
        }).collect();
        let next = if start + page.len() < policy.tasks.len() {
            policy
                .tasks
                .get(start + page.len() - 1)
                .map(|t| t.id.as_str())
        } else {
            None
        };
        Ok(
            json!({"tasks":page,"next":next,"executionAllowed":true,"definitionCheckedForThisRequest":false,"profileId":policy.profile_id}),
        )
    }
    fn run_task(
        &self,
        token: &str,
        root: &Scope,
        params: Value,
        context: Option<ExecutionContext<'_>>,
    ) -> Result<Value, (&'static str, String)> {
        let (view, policy) = {
            let inner = self.inner.lock().unwrap();
            let grant = inner
                .grants
                .iter()
                .find(|g| constant_equal(&g.token, token))
                .ok_or(("access_denied", "Execution grant is not active".into()))?;
            (
                grant.view.clone(),
                grant.execution.clone().ok_or((
                    "access_denied",
                    "This grant has no task execution capability".into(),
                ))?,
            )
        };
        let request: RunRequest = parse(params)?;
        if request.request_id.is_empty()
            || request.request_id.len() > 128
            || request.request_id.chars().any(char::is_control)
        {
            return Err((
                "invalid_params",
                "Supply a stable requestId of 1–128 characters".into(),
            ));
        }
        if let Some(job) = self
            .queue
            .replay(&view.id, &request.request_id, &request.task_id)
            .map_err(|e| ("request_conflict", e))?
        {
            return Ok(serde_json::to_value(job).unwrap());
        }
        let context =
            context.ok_or(("unavailable", "Task launch handler is unavailable".into()))?;
        if !context.integrate {
            return Err((
                "definition_changed",
                "Shell integration was disabled; task execution is unavailable".into(),
            ));
        }
        let task = policy
            .tasks
            .iter()
            .find(|t| t.id == request.task_id)
            .ok_or((
                "access_denied",
                "Task was not selected in this grant".into(),
            ))?;
        let profile = context
            .profiles
            .iter()
            .find(|p| p.id == policy.profile_id)
            .ok_or((
                "definition_changed",
                "Reviewed shell is no longer available".into(),
            ))?;
        policy
            .validate_scope(root, task, profile)
            .map_err(|e| ("definition_changed", e))?;
        let (job, new) = {
            let mut inner = self.inner.lock().unwrap();
            if !inner
                .grants
                .iter()
                .any(|g| g.view.id == view.id && constant_equal(&g.token, token))
            {
                return Err(("access_denied", "Grant was revoked".into()));
            }
            if let Some(job) = self
                .queue
                .replay(&view.id, &request.request_id, &request.task_id)
                .map_err(|e| ("request_conflict", e))?
            {
                (job, false)
            } else {
                let requester = agent_tasks::Requester {
                    client: view.client,
                    grant_id: view.id,
                    task_id: task.id.clone(),
                    task_name: task.name.clone(),
                    request_id: request.request_id,
                };
                let job = self
                    .queue
                    .enqueue(
                        &root.project(),
                        requester,
                        task.clone(),
                        &policy,
                    )
                    .map_err(|e| ("task_limit", e))?;
                inner.revision += 1;
                (job, true)
            }
        };
        if new && let Err(e) = (context.emit)(&job) {
            self.queue
                .fail(&job.id, &format!("Could not notify the UI: {e}"));
        }
        Ok(serde_json::to_value(self.queue.get(&job.id).map_err(|e| ("unavailable", e))?).unwrap())
    }
    pub fn claim(
        &self,
        id: &str,
        pane: &str,
        profiles: &[Profile],
        integrate: bool,
    ) -> Result<Invocation, String> {
        let job = self.queue.get(id)?;
        let (root, policy) = self.policy(&job.requester.grant_id)?;
        let profile = profiles
            .iter()
            .find(|p| p.id == policy.profile_id)
            .ok_or("Reviewed shell is unavailable")?;
        if !integrate {
            return Err("Enable shell integration before launching granted tasks".into());
        }
        policy.validate_scope(&root, &job.task, profile)?;
        let mut inner = self.inner.lock().unwrap();
        if !inner
            .grants
            .iter()
            .any(|g| g.view.id == job.requester.grant_id)
        {
            return Err("Grant was revoked".into());
        }
        let result = self.queue.claim(id, pane)?;
        inner.revision += 1;
        Ok(result)
    }
    pub fn launch(
        &self,
        id: &str,
        pane: &str,
        session: u32,
        context: LaunchContext<'_>,
    ) -> Result<Invocation, String> {
        let LaunchContext {
            revalidate,
            cwd,
            sessions,
            profiles,
            integrate,
            records,
        } = context;
        let job = self.queue.get(id)?;
        let (root, policy) = self.policy(&job.requester.grant_id)?;
        let profile = profiles
            .iter()
            .find(|p| p.id == policy.profile_id)
            .ok_or("Reviewed shell is unavailable")?;
        let check_launch=||{
            revalidate(profile)?;
            if !integrate||job.pane_id.as_deref()!=Some(pane)||job.binding(sessions,session).is_none(){return Err("The actual shell/pane does not match the reviewed profile".into());}
            match &root {
                Scope::Native(_)=>if repo_state::native_folder(cwd)?!=repo_state::native_folder(&job.task.directory)?{return Err("The shell is not in the reviewed task directory".into());},
                Scope::Linux(project)=>{
                    let folder=crate::wsl::call(&project.distribution,json!({"method":"folder","cwd":cwd}))?;
                    if folder["cwd"].as_str()!=Some(&job.task.directory){return Err("The shell is not in the reviewed Linux task directory".into());}
                }
            }
            policy.validate_scope(&root,&job.task,profile)?;
            revalidate(profile)
        };
        check_launch()?;
        let prepared=match &root {
            Scope::Native(_)=>records.prepare(&job.task.directory,&job.task.command),
            Scope::Linux(project)=>records.prepare_wsl(&project.distribution,&job.task.directory,&job.task.command,profile),
        };
        let (mut ticket, mut warning) = match prepared {
            Ok(prepared) => (Some(prepared.id), None),
            Err(e) => (None, Some(e)),
        };
        let result = (|| {
            check_launch()?;
            if matches!(root,Scope::Linux(_))&&let Some(id)=ticket.clone()
                &&let Err(error)=records.authorize_wsl(&id,pane,&|launch|{
                    if launch.profile_id!=policy.profile_id||launch.profile_key!=policy.profile_key||launch.environment!=job.environment||launch.cwd!=job.task.directory{return Err("Task evidence belongs to another launch context".into());}
                    check_launch()
                }){records.cancel(&id);ticket=None;warning=Some(error);}
            let programs = sessions.programs(&[session])?;
            if !programs.is_empty() {
                return Err(format!(
                    "The new task shell is busy ({}); no command was typed",
                    programs.join(", ")
                ));
            }
            check_launch()?;
            let mut inner = self.inner.lock().unwrap();
            if !inner
                .grants
                .iter()
                .any(|g| g.view.id == job.requester.grant_id)
            {
                return Err("Grant was revoked before launch".into());
            }
            let launched =
                self.queue
                    .launch(id, pane, session, ticket.clone(), warning, |command| {
                        revalidate(profile)?;
                        if job.binding(sessions,session).is_none(){return Err("Task session changed before submission".into());}
                        sessions.write(session, &format!("{command}\r"))
                    })?;
            inner.revision += 1;
            Ok(launched)
        })();
        if result.is_err()
            && let Some(ticket) = ticket
        {
            records.cancel(&ticket);
        }
        result
    }
    pub fn fail(&self, id: &str, message: &str, records: &run_records::Store) {
        if let Some(ticket) = self.queue.fail(id, message) {
            records.cancel(&ticket);
        }
        self.inner.lock().unwrap().revision += 1;
    }
    pub fn completed(&self, id: &str, exit: Option<i64>, at: u64) {
        if self.queue.get(id).is_ok() {
            self.queue.complete(id, exit, at);
            self.inner.lock().unwrap().revision += 1;
        }
    }
    pub fn stop(
        &self,
        id: &str,
        sessions: &SessionManager,
        records: &run_records::Store,
    ) -> Result<(), String> {
        let job = self.queue.get(id)?;
        if matches!(job.state.as_str(), "queued" | "launching") {
            self.fail(id, "Cancelled by the developer before launch", records);
            return Ok(());
        }
        let job = self.queue.stopping(id)?;
        if let Some(session) = job.session {
            if job.binding(sessions,session).is_none() {
                self.fail(id, "The task shell is no longer available", records);
                return Ok(());
            }
            sessions.write(session, "\u{3}")?;
            sessions.stop_programs(session)?;
        }
        self.inner.lock().unwrap().revision += 1;
        Ok(())
    }
    fn read(
        &self,
        root: &Scope,
        method: &str,
        params: Value,
        records: &run_records::Store,
    ) -> Result<Value, (&'static str, String)> {
        match method {
            "panes.list" => {
                let _: Empty = parse(params)?;
                let (panes, observed) = { let inner = self.inner.lock().unwrap(); (inner.panes.clone(), inner.observed) };
                if repo_state::now().saturating_sub(observed) > 15000 { return Err(("unavailable", "Pane observations are unavailable or stale".into())); }
                let candidates: Vec<_> = panes.into_iter().filter(|p| p.kind != "other" && root.accepts(p.environment.as_deref(), &p.kind)).collect();
                let paths:Vec<_> = candidates.iter().filter_map(|p|p.cwd.clone()).collect();
                let allowed=root.paths(&paths).map_err(|e|("unavailable",e))?;
                let panes:Vec<_>=candidates.into_iter().filter(|p|p.cwd.as_ref().is_some_and(|cwd|allowed.contains(cwd))).collect();
                Ok(json!({ "panes": panes, "observedAt": observed, "project": root.project(), "environment":root.environment() }))
            }
            "commands.list" => {
                let params: List = parse(params)?;
                let snapshot = records.snapshot();
                if snapshot.recovery_required { return Err(("unavailable", "Saved command history needs recovery in qterm".into())); }
                let candidates:Vec<_>=snapshot.runs.iter().filter(|r|root.accepts(r.environment.as_deref(),r.shell_kind.as_deref().unwrap_or(""))&&params.pane_id.as_ref().is_none_or(|p|*p==r.pane_id)).collect();
                let paths:Vec<_>=candidates.iter().filter_map(|r|r.cwd.clone()).collect();
                let allowed=root.paths(&paths).map_err(|e|("unavailable",e))?;
                let scoped:Vec<_>=candidates.into_iter().filter(|r|r.cwd.as_ref().is_some_and(|cwd|allowed.contains(cwd))).collect();
                if params.pane_id.is_some() && scoped.is_empty() {
                    let panes = self.inner.lock().unwrap().panes.clone();
                    let pane=panes.iter().find(|p|Some(&p.id)==params.pane_id.as_ref()&&p.kind!="other"&&root.accepts(p.environment.as_deref(),&p.kind));
                    let paths:Vec<_>=pane.and_then(|p|p.cwd.clone()).into_iter().collect();
                    if paths.is_empty()||root.paths(&paths).map_err(|e|("unavailable",e))?.is_empty(){return Err(("not_available", "Pane is unknown or outside this grant".into()));}
                }
                let start = match params.after { None => 0, Some(id) => scoped.iter().position(|r| r.id == id).map(|i| i+1).ok_or(("cursor_expired", "The previous command is no longer retained in this project".into()))? };
                let limit = params.limit.unwrap_or(25).clamp(1,25);
                let page: Vec<_> = scoped.iter().skip(start).take(limit).map(|r| metadata(r)).collect();
                let next = if start+page.len() < scoped.len() { scoped.get(start+page.len()-1).map(|r| r.id.as_str()) } else { None };
                Ok(json!({ "commands": page, "next": next, "saveError": snapshot.error }))
            }
            "commands.result" => {
                let params: ResultRequest = parse(params)?;
                let snapshot = records.snapshot();
                if snapshot.recovery_required {return Err(("unavailable","Saved command history needs recovery in qterm".into()));}
                let run=snapshot.runs.iter().find(|r|r.id==params.command_id&&root.accepts(r.environment.as_deref(),r.shell_kind.as_deref().unwrap_or(""))).ok_or(("not_available","Command is unknown, outside this grant, or no longer retained".into()))?;
                let paths:Vec<_>=run.cwd.clone().into_iter().collect();
                if paths.is_empty()||root.paths(&paths).map_err(|e|("unavailable",e))?.is_empty(){return Err(("not_available","Command is unknown, outside this grant, or no longer retained".into()));}
                if params.offset > run.output.len() || !run.output.is_char_boundary(params.offset) { return Err(("invalid_params", "Output offset must be a UTF-8 boundary within the capture".into())); }
                let mut end = params.offset.saturating_add(params.limit.unwrap_or(65536).clamp(4,65536)).min(run.output.len());
                while !run.output.is_char_boundary(end) { end-=1; }
                Ok(json!({ "command": metadata(run), "fullCommand": run.command, "output": &run.output[params.offset..end], "offset": params.offset, "next": if end < run.output.len() { Some(end) } else { None }, "captureIncomplete": run.output_truncated, "lastRepositoryComparison": run.verification, "repositoryComparedForThisRequest": false, "saveError": snapshot.error }))
            }
            "tasks.list" => {
                use sha2::{Digest, Sha256};
                let params: Page = parse(params)?;
                let tasks = match root {
                    Scope::Native(path)=>crate::project::tasks(path),
                    Scope::Linux(project)=>{
                        let found=project.discover(&project.path).map_err(|e|("unavailable",e))?;
                        Some(crate::project::Tasks{dir:found.directory.path,tasks:found.tasks})
                    }
                };
                let values: Vec<_> = tasks.as_ref().map(|found| found.tasks.iter().map(|task| {
                    let id = format!("{:x}", Sha256::digest(format!("{}\0{}", task.source, task.name)));
                    let name: String = task.name.chars().take(512).collect(); let command: String = task.command.chars().take(1024).collect();
                    json!({ "id": id, "name": name, "source": task.source, "command": command, "truncated": command.len() < task.command.len() || name.len() < task.name.len() })
                }).collect()).unwrap_or_default();
                let start = match params.after { None => 0, Some(id) => values.iter().position(|v| v["id"].as_str() == Some(&id)).map(|i|i+1).ok_or(("cursor_expired", "The previous task is no longer discovered".into()))? };
                let page: Vec<_> = values.iter().skip(start).take(params.limit.unwrap_or(25).clamp(1,25)).collect();
                let next = if start + page.len() < values.len() { values.get(start+page.len()-1).map(|v| &v["id"]) } else { None };
                Ok(json!({ "project": root.project(), "environment":root.environment(), "directory": tasks.map(|t| t.dir), "tasks": page, "next": next, "executionAllowed": false }))
            }
            _ => Err(("method_unavailable", "This session grant permits panes.list, commands.list, commands.result and tasks.list".into())),
        }
    }
}
fn metadata(run: &run_records::Run) -> Value {
    let command: String = run.command.chars().take(512).collect();
    json!({ "id": run.id, "paneId": run.pane_id, "appRunId": run.app_run_id, "profileId": run.profile_id, "shellKind": run.shell_kind, "environment":run.environment, "cwd": run.cwd, "commandPreviewTruncated": command.len() < run.command.len(), "command": command, "commandTruncated": run.command_truncated, "exitCode": run.exit_code, "startedAt": run.started_at, "finishedAt": run.finished_at, "captureIncomplete": run.output_truncated, "requester":run.requester })
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Connection {
    version: u32,
    pipe: String,
    token: String,
}
pub fn client(args: &[String]) -> Result<Value, String> {
    if args.len() < 2 || args.len() > 3 {
        return Err(
            "Usage: qterm --agent-client <connection-file> <method> [JSON-parameters]".into(),
        );
    }
    let mut bytes = vec![];
    File::open(&args[0])
        .map_err(|_| "Connection file unavailable; create a new session grant in qterm")?
        .take(16385)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() > 16384 {
        return Err("Invalid connection file".into());
    }
    let connection: Connection =
        serde_json::from_slice(&bytes).map_err(|_| "Invalid connection file")?;
    if connection.version != 1
        || connection.token.len() != 64
        || !connection.token.bytes().all(|b| b.is_ascii_hexdigit())
    {
        return Err("Unsupported connection file".into());
    }
    let params: Value = match args.get(2) {
        Some(text) => serde_json::from_str(text).map_err(|_| "Parameters must be JSON")?,
        None => empty(),
    };
    agent_pipe::call(
        &connection.pipe,
        &json!({ "version": 1, "id": agent_pipe::random()?, "token": connection.token, "method": args[1], "params": params }),
    )
}
pub fn run_client(args: &[String]) {
    let result = match client(args) {
        Ok(value) => value,
        Err(message) => error(None, "connection_error", &message),
    };
    println!("{result}");
    if result.get("error").is_some() {
        std::process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;
    use crate::repo_state::tests::{Repo, until};
    struct Case {
        access: Arc<Access>,
        records: Arc<run_records::Store>,
        repo: Repo,
    }
    impl Case {
        fn new() -> Self {
            let repo = Repo::new();
            let access = Arc::new(Access::new(repo.dir.join(".git/connections")));
            let records = Arc::new(run_records::Store::load(repo.dir.join(".git/runs.json")));
            Self {
                access,
                records,
                repo,
            }
        }
        fn grant(&self) -> GrantView {
            let review = self
                .access
                .review(&repo_state::display(&self.repo.dir))
                .unwrap();
            let weak = Arc::downgrade(&self.access);
            let records = self.records.clone();
            let handler = Arc::new(move |value| weak.upgrade().unwrap().request(value, &records));
            self.access
                .grant(&review.id, "test client", handler)
                .unwrap()
                .grants[0]
                .clone()
        }
        fn run(&self, id: &str, cwd: &Path, pane: &str, output: String) {
            self.records
                .append(
                    run_records::Run {
                        id: id.into(),
                        pane_id: pane.into(),
                        profile_id: Some("pwsh".into()),
                        shell_kind: Some("powershell".into()),
                        app_run_id: None,
                        environment: None,
                        cwd: Some(repo_state::display(cwd)),
                        command: "check".into(),
                        command_truncated: false,
                        exit_code: Some(0),
                        started_at: 1,
                        finished_at: 2,
                        output,
                        output_truncated: false,
                        verification: None,
                        requester: None,
                    },
                    None,
                )
                .unwrap();
        }
        fn call(&self, grant: &GrantView, method: &str, params: Value) -> Value {
            client(&[
                grant.connection_file.clone(),
                method.into(),
                params.to_string(),
            ])
            .unwrap()
        }
    }
    #[test]
    fn grant_commit_rechecks_cancellation_expiry_and_single_use_after_validation() {
        let c=Case::new();
        for action in ["cancel","expire","used"] {
            let review=c.access.review(&repo_state::display(&c.repo.dir)).unwrap();
            let pending=c.access.inner.lock().unwrap().reviews.get(&review.id).unwrap().clone();
            pending.scope.validate().unwrap();
            match action {
                "cancel"=>c.access.cancel_review(&review.id),
                "expire"=>{c.access.inner.lock().unwrap().reviews.get_mut(&review.id).unwrap().at=Instant::now()-Duration::from_secs(601);},
                _=>{c.access.grant(&review.id,"first grant",Arc::new(|_|json!({}))).unwrap();},
            }
            let failure=c.access.commit_grant(&review.id,pending,None,"stale grant",Arc::new(|_|json!({}))).err().expect("cancelled or expired review committed a session grant");
            assert!(failure.contains("cancelled or expired"));
        }
        assert_eq!(c.access.snapshot().grants.len(),1);
    }
    #[test]
    fn access_starts_off_and_reviews_are_read_only_expire_and_cancel() {
        let c = Case::new();
        assert!(!c.access.snapshot().listening);
        assert!(!c.access.directory.exists());
        let review = c.access.review(&repo_state::display(&c.repo.dir)).unwrap();
        assert!(!c.access.directory.exists());
        c.access.cancel_review(&review.id);
        assert!(
            c.access
                .grant(&review.id, "test", Arc::new(|_| json!({})))
                .is_err()
        );
        let review = c.access.review(&repo_state::display(&c.repo.dir)).unwrap();
        c.access
            .inner
            .lock()
            .unwrap()
            .reviews
            .get_mut(&review.id)
            .unwrap()
            .at = Instant::now() - Duration::from_secs(601);
        assert!(
            c.access
                .grant(&review.id, "test", Arc::new(|_| json!({})))
                .is_err()
        );
        assert!(!c.access.snapshot().listening);
    }

    #[test]
    fn native_grants_exclude_foreign_environments_even_with_native_looking_shell_and_cwd(){
        let c=Case::new();c.run("native",&c.repo.dir,"pane",String::from("native output"));
        for environment in ["wsl:ubuntu","unknown"]{let mut run=c.records.snapshot().runs[0].clone();run.id=format!("foreign-{environment}");run.environment=Some(environment.into());c.records.append(run,None).unwrap();}
        let grant=c.grant();let list=c.call(&grant,"commands.list",json!({}));
        assert_eq!(list["result"]["commands"].as_array().unwrap().len(),1);
        assert_eq!(list["result"]["commands"][0]["id"],"native");
        for environment in ["wsl:ubuntu","unknown"]{assert_eq!(c.call(&grant,"commands.result",json!({"commandId":format!("foreign-{environment}")}))["error"]["code"],"not_available");}
    }
    #[test]
    fn real_pipe_scopes_panes_commands_and_utf8_pages_and_revokes_credentials() {
        let c = Case::new();
        let other = Repo::new();
        let output = "🦀你".repeat(20000);
        c.run("inside", &c.repo.dir, "pane-a", output.clone());
        c.run("outside", &other.dir, "pane-b", "secret outside".into());
        c.access
            .publish(vec![
                Pane {
                    id: "pane-a".into(),
                    cwd: Some(repo_state::display(&c.repo.dir)),
                    label: "project a".into(),
                    profile_id: "pwsh".into(),
                    kind: "powershell".into(),
                    environment: Some("native".into()),
                },
                Pane {
                    id: "pane-b".into(),
                    cwd: Some(repo_state::display(&other.dir)),
                    label: "project b".into(),
                    profile_id: "pwsh".into(),
                    kind: "powershell".into(),
                    environment: Some("native".into()),
                },
            ])
            .unwrap();
        let grant = c.grant();
        let connection: Connection =
            serde_json::from_slice(&fs::read(&grant.connection_file).unwrap()).unwrap();
        assert_eq!(
            c.call(&grant, "panes.list", json!({}))["result"]["panes"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
        let list = c.call(&grant, "commands.list", json!({}));
        assert_eq!(list["result"]["commands"].as_array().unwrap().len(), 1);
        assert_eq!(list["result"]["commands"][0]["id"], "inside");
        assert_eq!(
            c.call(&grant, "commands.result", json!({"commandId":"outside"}))["error"]["code"],
            "not_available"
        );
        assert_eq!(
            c.call(&grant, "commands.list", json!({"paneId":"pane-b"}))["error"]["code"],
            "not_available"
        );
        let mut joined = String::new();
        let mut offset = 0;
        loop {
            let response = c.call(
                &grant,
                "commands.result",
                json!({"commandId":"inside","offset":offset,"limit":65536}),
            );
            let result = &response["result"];
            let part = result["output"].as_str().unwrap();
            assert!(part.len() <= 65536);
            joined.push_str(part);
            match result["next"].as_u64() {
                Some(next) => offset = next,
                None => break,
            }
        }
        assert_eq!(joined, output);
        assert_eq!(
            c.call(
                &grant,
                "commands.result",
                json!({"commandId":"inside","offset":1})
            )["error"]["code"],
            "invalid_params"
        );
        assert_eq!(
            c.call(&grant, "tasks.run", json!({"command":"echo forbidden"}))["error"]["code"],
            "access_denied"
        );
        let denied = agent_pipe::call(
            &connection.pipe,
            &json!({"version":1,"token":"0".repeat(64),"method":"commands.list"}),
        )
        .unwrap();
        assert_eq!(denied["error"]["code"], "access_denied");
        c.access.revoke(&grant.id).unwrap();
        assert!(!Path::new(&grant.connection_file).exists());
        assert_eq!(
            c.access.request(
                json!({"version":1,"token":connection.token,"method":"commands.list"}),
                &c.records
            )["error"]["code"],
            "access_denied"
        );
        until(|| agent_pipe::call(&connection.pipe, &json!({})).is_err());
        assert!(!c.access.snapshot().listening);
    }
    #[test]
    fn actual_pipe_handles_concurrent_clients_and_never_exposes_tokens_in_views() {
        let c = Case::new();
        c.run("one", &c.repo.dir, "p", "captured".into());
        let grant = c.grant();
        let view = serde_json::to_string(&c.access.snapshot()).unwrap();
        let credentials = fs::read_to_string(&grant.connection_file).unwrap();
        let token = serde_json::from_str::<Connection>(&credentials)
            .unwrap()
            .token;
        assert!(!view.contains(&token));
        let workers: Vec<_> = (0..6)
            .map(|_| {
                let file = grant.connection_file.clone();
                std::thread::spawn(move || client(&[file, "commands.list".into()]).unwrap())
            })
            .collect();
        for worker in workers {
            assert_eq!(worker.join().unwrap()["result"]["commands"][0]["id"], "one");
        }
        c.access.revoke(&grant.id).unwrap();
    }
    #[test]
    fn junctions_cannot_expand_the_project_scope_and_unknown_fields_are_rejected() {
        use std::os::windows::process::CommandExt;
        let c = Case::new();
        let other = Repo::new();
        let alias = c.repo.dir.join("escape");
        let made = std::process::Command::new("cmd")
            .args(["/c", "mklink", "/J"])
            .arg(&alias)
            .arg(&other.dir)
            .creation_flags(0x08000000)
            .output()
            .unwrap();
        assert!(made.status.success());
        assert!(!inside(
            &fs::canonicalize(&c.repo.dir).unwrap(),
            &repo_state::display(&alias)
        ));
        c.run("escaped", &alias, "p", "outside contents".into());
        let grant = c.grant();
        assert!(
            c.call(&grant, "commands.list", json!({}))["result"]["commands"]
                .as_array()
                .unwrap()
                .is_empty()
        );
        assert_eq!(
            c.call(&grant, "commands.list", json!({"cwd":other.dir}))["error"]["code"],
            "invalid_params"
        );
        fs::remove_dir(alias).unwrap();
        c.access.revoke(&grant.id).unwrap();
    }
    #[test]
    fn named_task_inspection_is_paginated_and_never_runs_a_task() {
        let c = Case::new();
        fs::write(
            c.repo.dir.join("package.json"),
            r#"{"scripts":{"check":"echo do-not-run","build":"exit 1"}}"#,
        )
        .unwrap();
        let grant = c.grant();
        let page = c.call(&grant, "tasks.list", json!({"limit":1}));
        let result = &page["result"];
        assert_eq!(result["tasks"].as_array().unwrap().len(), 1);
        assert_eq!(result["executionAllowed"], false);
        let next = c.call(
            &grant,
            "tasks.list",
            json!({"after":result["next"],"limit":1}),
        );
        assert_eq!(next["result"]["tasks"].as_array().unwrap().len(), 1);
        assert_ne!(next["result"]["tasks"][0]["id"], result["tasks"][0]["id"]);
        c.access.revoke(&grant.id).unwrap();
    }
}
