# Developer and coding-agent implementation plan

Based on the v0.2.8 source review, 29 October 2026. This is the working backlog
for unattended implementation; update it after each verified slice.

## Working rules

- Deliver small, independently useful changes. Inspect the diff and run the
  relevant checks before moving to the next slice.
- Preserve interactive terminal use and existing provider approval controls.
- Prefer shared domain models with provider-specific adapters. Represent missing
  telemetry as unknown, not zero usage or proof that an agent is idle.
- Keep project commands explicit: opening a repository must not execute its config.
- Ask about major product/security decisions when they become concrete. Continue
  unrelated authorized work while waiting. Do not infer consent from silence.
- No publishing, releases, or changes to the user's live agent configuration are
  required to implement and test this plan.

## Phase 1: trust and quick wins

1. **Recoverable persistence** (implemented and regression-verified): serialize writes; acknowledge only
   successful snapshots; retry unchanged failed saves; persistently report errors
   with a Retry action; prevent output-save/clear races. Cover failed-write
   recovery, concurrent snapshots and output generated while saving.
2. **Agent integration health** (implemented and regression-verified): last event/time, resolved home, pane association,
   scan counts and actionable failures; distinguish installed hooks from delivery.
   Add a local test without changing provider trust or contacting a model.
3. **Accurate status** (implemented and regression-verified): distinguish working, waiting, completed and unknown;
   preserve provenance and freshness; stop treating a quiet process as idle.
4. **Send output to an agent** (new/idle-shell handoff implemented; running-session follow-ups remain open): preview command, cwd, exit status and bounded
   selected output; choose Claude or Codex and new or compatible existing pane.
   Treat text as prompt data, never shell source. Do not auto-submit from a preview.
5. **Efficient Codex indexing**: batch usage reads, surface scan diagnostics and
   measure before introducing a more complex index.

## Phase 2: daily developer workflow

6. **Unified attention inbox** (implemented and regression-verified): provider-neutral events with project/pane/session
   identity; separate viewed from resolved, keep failures and permission requests
   distinct, and support keyboard navigation. Retain current jump shortcuts.
7. **Problems panel** (implemented and regression-verified): begin with tsc and Rust diagnostics; scope entries to command
   runs, retain file/line links, clear obsolete results and show unsupported output.
   Extend to other toolchains using sanitized fixtures.
   Supported formats and validation boundaries are in [diagnostic-formats.md](diagnostic-formats.md).
8. **Verification records** (implemented and regression-verified): command, cwd, exit code, times and repository state;
   mark results stale when the checked state changes. No claimed validation of
   edits made after a check started.
   Scope, retention and recovery are in [verification-records.md](verification-records.md).

## Phase 3: task-oriented agent workflows

9. **Worktree tasks** (implemented and regression-verified): explicit branch/base/directory preview, separate agent pane,
   task metadata, associated checks and change summary. Never silently discard
   dirty worktrees. Start without automatic dependency installation or merging.
   See [worktree-tasks.md](worktree-tasks.md) for the implemented workflow and scope.
10. **Scoped local CLI** (implemented and regression-verified): list panes, retrieve bounded command results, list/run
    named project tasks, query status; structured responses and stable run IDs.
    Authenticate local requests, scope access and avoid arbitrary terminal typing.
    The implemented protocol is in [local-agent-interface.md](local-agent-interface.md).
11. **Optional MCP adapter** over the same service after its authorization model
    is agreed and the local interface is verified.

## Phase 4: expansion

12. **Workflow recipes** (implemented and regression-verified): versioned `.qterm.toml` tasks, dependencies, readiness,
    cwd and layout; validate cycles and failures, keep launch explicit.
    See [format and boundaries](workflow-recipes.md).
13. **Session library and handoffs** (implemented and regression-verified): provider/project/branch/environment filters,
    pinning and search; preview/export a bounded handoff with goals, findings,
    files, checks and next steps. Respect transcript-retention preferences.
    See [behavior and boundaries](session-library.md).
14. **WSL parity** (in progress; [implemented project/file slice](wsl-support.md), [remaining plan](wsl-parity-proposal.md)): explicit distro identity, opt-in session indexing, distro-side
    project discovery and path-aware file links. Keep native and WSL identities
    separate even when textual paths match.
15. **Optional Codex App Server spike**: isolate behind a capability adapter and
    test against a specific CLI version before deciding whether to ship it.

## Decisions to bring to the user

- Local automation **decided**: the user approved explicit, session-only project
  grants for named-task execution. All access stays off until granted; see
  [the interface proposal](local-agent-interface-proposal.md). Ask again before
  adding persistent grants or arbitrary execution authority.
- Native agent UI: whether qterm should own conversations/approvals through an
  App Server integration. Until decided, keep the normal CLI as the primary UI.
- Cross-provider handoffs: explicit exports initially; ask before enabling ongoing
  automatic sharing of transcript/context between providers.
- Worktree completion: ask before adding automated merge, dependency bootstrap,
  or destructive cleanup behavior.
- Process ownership **decided**: the user chose to end all descendant processes
  when qterm exits, including detached tools launched from shells. Use a Windows
  job; allow only an explicit verified update's replacement/installer to survive
  the old instance. This supersedes the earlier preserve-GUI-tools design.

## Validation and progress

- Initial checkout clean. No AGENTS.md files found in the repository.
- Provisioned Node 26.13.0 and pnpm 10 inside ignored `.tools.local`; installed
  dependencies from the unchanged lockfile.
- Persistence: all 293 frontend tests, TypeScript checks and production bundling
  passed. Regression tests exercise failed-write recovery, ordered overlapping saves,
  store independence, output clearing and output generated during a write.
- Added a persistent save-error banner, automatic/manual retries, and protection
  against quitting/updating after a failed final save.
- The user authorized full Windows build-tool installation. Official Microsoft
  Build Tools and stable Rust installation started; native validation follows.
- Status: quiet process-only observations now report unknown, not idle. Mixed tabs
  preserve unknown state. Codex lifecycle-reported idle remains supported. Full
  waiting/completion lifecycle state and event provenance remain to be implemented.
- Codex scan diagnostics and manual refresh implemented, including resolved home,
  missing folders, unrecognized files and bounded read errors. Batched usage and
  explicit scans run on blocking workers; pending native/desktop validation.
- Added desktop risks R38–R40 for unknown activity, save recovery and scan refresh.
- After a failed final save, quitting offers an explicit **Quit without saving**
  escape hatch; an update still requires a successful save.
- Installed stable Rust 1.99.1 (Cargo, Clippy, Rustfmt) and Microsoft Visual Studio
  C++ Build Tools 2022 with its recommended workload/SDK, as authorized. Rust's
  installer did not modify the user's PATH. Portable PowerShell stays in
  `.tools.local`; ConPTY was fetched through the repository's hash/signature checks.
- With bundled ConPTY: the complete Rust suite passed (130 passed, 1 ignored).
  Clippy with warnings denied passed. Frontend: 296 tests passed; app and E2E
  TypeScript checks and production bundling passed.
- Deliberate-regression checks: acknowledging a failed snapshot, inferring idle
  from silence, and disabling Refresh each made its desktop test fail. The restored
  targeted suite passed. The persistence test waits for the exact failed snapshot,
  preventing a pending startup save from masking the failure.
- Output saving now uses a monotonic per-pane revision, so chunks arriving in the
  same millisecond cannot be mistaken for already-saved output.
- The first broad desktop run found an outdated idle expectation and a host NVM
  trust error in project-task execution. Updated the expectation. Isolated that
  test's shell and PATH to the runner's toolchain, checking npm's actual path before
  execution; the blocked NVM installation and its trust settings were not changed.
  Both corrected scenarios passed individually. The final complete desktop suite
  passed: **40/40 scenarios**. No deliberate mutations remain in the source.
- First implementation checkpoint verified. The unattended goal remains active;
  proceed with the next cycle below. No pending user decision blocks this work.

## Next implementation cycle

1. Add a provider-neutral attention inbox with explicit viewed/resolved state.
2. Continue problems and verification records, then worktree tasks and the scoped
   local interface. Preserve automatic follow-ups to running agent sessions as an
   open requirement; do not substitute terminal typing into a TUI for transport.

## Second implementation cycle

- Provider health records only the last event's kind, time, pane and session, plus
  the last local-probe result. Probes launch qterm's own hook executable and are
  acknowledged by the real watcher without generating provider attention/session
  events. Settings labels the difference from provider configuration/trust.
- Shared lifecycle observations distinguish waiting, completed, failed, working,
  interrupted idle and unknown. Submitted input invalidates older observations;
  old busy events degrade to unknown. Status shows its source/time. A process-scan
  error preserves associations while displaying uncertainty rather than an exit.
- Reviewed handoffs: selection or command output, original command cwd/exit code,
  editable request, provider and compatible shell. New tab by default; reuse of
  idle source shells checks current folder, process state and broadcast mode.
  Literal request/output goes into a bounded local brief, not shell source or
  command-line arguments. Only the generated file reference is passed to the CLI.
- Brief cleanup is opportunistic after seven days, scoped to generated plain
  files in the local cache. No provider approvals/configuration are changed.
- Existing running agent sessions currently support explicit Copy brief/manual
  follow-up; automatic structured delivery is still open.
- Sources for initial-prompt CLI behavior: [Codex CLI reference](https://learn.chatgpt.com/docs/developer-commands),
  [Claude CLI reference](https://code.claude.com/docs/en/cli-reference). The handoff
  uses those positional prompts to refer to the reviewed data file.
- New handoff tabs wait for an empty shell prompt and verify the actual cwd before
  launching. Reuse rejects unfinished input, running programs and broadcast mode.
  WSL automatic handoffs remain open with WSL parity; Copy brief is available.
- Hook delivery is ordered by file write time, not hook process IDs. A regression
  test constructs conflicting PID/time order. Claude Stop with no reply still
  reports completion; switching sessions clears old reply/usage/cache data.
- Unicode truncation does not split surrogate pairs. Modal focus stays inside the
  preview, Escape cancels, and editing is disabled while preparing a handoff.
- Final checks: **303 frontend tests, 134 Rust tests (1 helper ignored), and all
  46 desktop scenarios passed**; both TypeScript checks, production bundling and
  Clippy with warnings denied passed. The handoff preview was inspected visually.
- Deliberately dropping probe acknowledgements, retaining completed state after
  input, omitting output, removing busy-pane checks, and ignoring startup readiness
  each made its desktop test fail; restored agent scenarios passed. Removing modal
  focus containment separately made its test fail, and restoration returned it to
  green. No deliberate mutations remain.
- One existing native process-crash cleanup test failed while desktop tests ran
  concurrently. It passed alone and in the final complete native run without that
  overlap; the underlying cause was not established. No process-cleanup code was
  changed to suppress the failure.
- Second implementation checkpoint verified. The full unattended goal remains
  active; the inbox, problems/verification, worktree tasks, scoped local interface,
  recipes, session library/handoffs and WSL parity are still required work.

### Third implementation checkpoint: durable attention and process ownership

- Added a native provider-neutral inbox for permissions, input requests, failures
  and completed turns. It captures hooks independently of whether the pane is
  foreground, includes the hook's project folder, and persists after closing a
  pane or restarting. Prior-run events are labelled; they cannot target new panes.
- Viewing is independent of resolving. Provider continuation/completion settles
  only prior requests with the same provider/pane/session. Replies and failures
  require explicit resolution. Repeated pending requests are counted, not flooded.
- Inbox filters cover provider, type, open/read/resolved status and text/project
  search. Rows support keyboard navigation, scoped modal focus, pane jumps,
  resolution/reopening and clearing resolved history. Added the unbound
  `agent_inbox` palette action, tab-bar counts, durable waiting jumps and tray count.
- Keep all unresolved events and the newest 200 resolved events; messages are
  bounded to 4000 characters. Writes are atomic and serialized natively. Failed
  writes retain memory state, feed the persistent Save problem warning, retry
  automatically and prevent quit/update from silently skipping a failed save.
  Unreadable history is preserved until retry or explicit backup-and-recover.
- Strict Windows process-handle checks confirmed the old crash-cleanup failure:
  the shell exited but its program remained active. The user chose to terminate
  every descendant, including detached tools. Added a non-inheritable Windows job
  before any app children start; the sole handle remains until process termination.
- A verified update temporarily permits new children to survive the old job;
  existing children remain owned, and failure restores normal ownership. Actual
  detached-process tests cover crash, normal exit, failed launch and replacement
  survival. The signed installer itself was not installed during validation.
- The final full checks passed: **304 frontend tests, 141 Rust tests (2 subprocess
  helpers intentionally ignored), all 48 desktop scenarios**, both TypeScript
  checks, production bundling, Clippy with warnings denied and diff whitespace.
  Inspected the inbox screenshot at the actual desktop window size.
- Deliberately resolving on view made R47 fail; hiding the inbox Save problem
  warning made R48 fail. Both restored scenarios passed. The complete desktop run
  also caught and verified fixes for a failure labelled waiting and an unread marker
  hiding live Codex status. No deliberate mutations remain.
- The unattended goal stays active. Next: problems and verification records, then
  worktree tasks, the approved session-granted local interface, recipes, session
  library/handoffs and WSL parity. Running-session automatic follow-ups remain open.

### Fourth implementation checkpoint: command-scoped problems

- Added the Problems and command runs panel, a tab-bar entry and the unbound
  `problems` palette action. It captures the last 100 completed commands in this
  app session, with stable run IDs, original folder/profile, times, exit code and
  bounded output. Shell integration supplies the command boundaries.
- TypeScript and Rust adapters support normal compiler output, short Rust output,
  Rust/Cargo diagnostic JSON, source positions and global errors. Added ESLint
  stylish/JSON/metadata, Go source diagnostics, pytest traceback/short summary and
  .NET code-message adapters with sanitized fixtures. See the linked format guide
  for supported forms and authoritative references.
- Source links check file existence and open through the configured editor in the
  command's original folder. A real editor-launch capture verified the exact file,
  line and column after the source pane changed to another folder. WSL file opening
  stays open with the parity phase.
- Latest results replace only the exact command/folder/shell group. Superseded runs
  stay available. Unknown output, unknown exit status, missing source positions and
  truncated/lost captures are explicit, rather than proof of a clean check.
  Capture is bounded to 128000 UTF-16 units and 500 diagnostics; Unicode is preserved.
- Validation passed: **317 frontend tests, all 49 desktop scenarios**, both
  TypeScript checks, production bundling and diff whitespace. Real TypeScript and
  Rust failures, fixing/rerunning TypeScript and opening its diagnostic through the
  native editor command passed. The other adapters were fixture-tested; no claim of
  installed Go/.NET/pytest/ESLint end-to-end runs. Inspected the panel screenshot.
- Deliberately losing command output, resolving editor paths from the current
  folder, and retaining superseded problems each made R49 fail. Restored R49 and
  the complete desktop suite passed; no deliberate mutations remain.
- This is diagnostic/run capture, not completed repository-state verification.
  Next add durable records, before-run repository provenance and freshness tracking;
  never infer that an earlier success validates edits made after its start.
  Worktree tasks, scoped local interface, recipes, session library/handoffs and WSL
  parity remain in the full active goal.

### User-reported correction: false Codex answer notifications

- The user reported excessive qterm Windows notifications claiming Codex needed
  answers without presenting questions. Found two sources: `PermissionRequest`
  was treated as confirmed human input although approval can resolve without a
  prompt, and E2E runs could send synthetic Windows toasts under the production
  notification app ID.
- Codex approval routing now has an explicit unconfirmed approval state and an
  informational inbox type. Tool/reason/command details are preserved when provided.
  It creates no answer-required toast, waiting-menu entry, waiting jump or tray
  count. Provider continuation clears its marker, and stale approval state becomes
  unknown. qterm does not make or bypass any approval decision.
- Migrated version-1 Codex false permission entries to informational history in
  version 2, without claiming they were approved. Informational entries cannot be
  reopened as questions. Genuine Claude permission notifications remain actionable.
- Nonempty completion alerts say turn completed, empty replies do not toast, and
  equivalent alerts for the same pane/session are deduplicated for 30 seconds.
- E2E builds record notification attempts in their isolated local data directory
  and return before Windows delivery or app-ID registration. Production app-ID
  registration now derives the ID from the actual app configuration. The test
  guard stays enabled during negative tests; synthetic prompts never reach Windows.
- Added R50: actual hooks from a pane while the real window is hidden; three
  approval checks create informational history and zero notification attempts,
  while two identical completed replies create one suppressed native attempt.
  Deliberately restoring false-question delivery and duplicate toasts each failed
  R50. The restored scenario and full desktop suite passed.
- Validation: **320 frontend tests, 143 native tests (2 subprocess helpers ignored),
  all 50 desktop scenarios**, both TypeScript checks, production bundling, strict
  Clippy and diff whitespace passed. Changes are workspace source/build changes;
  no installed user app or live provider hook configuration was replaced.
- The user resumed the full unattended goal. After this correction, continue with
  durable verification records and the remaining planned phases.

### Fifth implementation checkpoint: durable verification records

- Command records now persist across restarts, with stable IDs, original folder,
  shell, timing, bounded output and exit status. History retains up to 100 records
  within 32 MiB. Failed writes retry unchanged records; unreadable history requires
  explicit backup recovery. Old records cannot navigate to unrelated restored panes.
- Reviewed checks capture actual source bytes, Git identity and staged state before
  launch. Native watchers cover source and linked-worktree metadata through
  completion. Editing and restoring source during a check permanently invalidates
  its evidence. Later comparisons detect changed contents even with restored mtimes.
- Ordinary commands have no retrospective proof. Unknown, unsupported or exceeded
  coverage stays explicit. Ignored files, external dependencies and environment
  are excluded. The panel shows the last comparison time and scope; see
  [verification records](verification-records.md).
- New native-shell reruns require review and start in a new tab at the recorded
  folder after its empty prompt appears. Truncated commands and unsupported
  shells cannot be rerun. Startup-run capture and final output without a newline
  are retained, without including the following prompt. Invalid exit codes stay
  unknown instead of preventing record persistence.
- Validation: **323 frontend tests, 153 native tests (2 subprocess helpers ignored),
  all 54 desktop scenarios**, both TypeScript checks, production bundling, strict
  Clippy and diff whitespace passed. Inspected the evidence panel screenshot.
- Deliberately accepting a later source edit, ignoring a reverted edit during a
  run, disabling failed-save retry, and losing the final output character each
  failed its protected desktop assertion. Restored all source; rebuilt the native
  app, passed the four scenarios, then passed the full desktop suite. No deliberate
  mutations remain. Test notification suppression remained enabled throughout.
- Full goal remains active. Next: explicit worktree tasks, then the approved
  session-granted local interface, recipes, session library/handoffs and WSL parity.
  Running-session automatic follow-ups and optional App Server investigation remain
  open. No installed app or live provider configuration was replaced.

### Sixth implementation checkpoint: worktree tasks

- Added Worktrees in the tab bar and an unbound `worktrees` palette action.
  Previews resolve the exact base commit, new branch and canonical destination;
  previewing creates nothing. A moved base, existing destination, invalid branch
  or changed parent requires correction before creation.
- Native creation saves metadata before touching Git, reserves a new directory,
  creates a new branch and checks out the reviewed commit. Dirty source files stay
  untouched. Hooks, clean/smudge/process filters, fsmonitor and recursive submodule
  checkout are disabled. The source branch badge now also disables clean/process
  filters: real tests found that even status can otherwise run them.
- Created tasks retain title, request, source/common Git identity, branch/base,
  directory, provider, shell, time and lifecycle label across restarts. Partial
  failures retain branch/directory and an inspectable error. Failed writes retry;
  unreadable history needs explicit backup recovery. Limits are 200 tasks/8 MiB.
- Task agents or shells open explicitly in separate named tabs. Agent requests
  remain file data; launch waits for the new pane's empty prompt. An unavailable
  checkout or switched branch cannot silently start an agent in another project.
  Completing/reopening changes metadata only; no merge, deletion or install occurs.
- Task details show branch/HEAD, change counts, commits since base and bounded
  diff summary, with truncation labelled. Folder-associated retained command runs
  link directly to their original output/diagnostics. Aliases and WSL remain
  conservative/unassociated; see [worktree tasks](worktree-tasks.md).
- Validation: **325 frontend tests, 157 native tests (2 subprocess helpers ignored),
  all 56 desktop scenarios**, both TypeScript checks, production bundling, strict
  Clippy and diff whitespace passed. Inspected the task screenshot after restart.
- Deliberately opening the task agent in the source checkout failed R55's actual
  terminal-folder assertion. Bypassing the initial metadata-save guard failed
  R56. Restored all source, rebuilt and passed both, then rebuilt final native
  changes and passed the complete desktop suite. No deliberate mutations remain.
- Full goal stays active. Next is the approved session-granted local agent
  interface; its proposal now contains the implementation sequence and Windows
  transport requirements. Recipes, session library/handoffs, WSL parity,
  running-session automatic follow-ups and optional App Server work remain open.
  No installed app, provider configuration, release or live repository worktree
  was changed by validation; Git mutations used owned temporary test repositories.

### Seventh implementation checkpoint: authenticated local agent reads

- Added Access in the tab bar and the unbound `agent_access` palette action.
  The user reviews a canonical native Git root and explicitly checks consent before
  creating a labelled session read grant. Reviewing alone creates no listener or
  credential file. Grants are never persisted or restored.
- Implemented `qterm --agent-client <connection-file> <method> [JSON-parameters]`
  before GUI startup. It reads credentials privately and returns structured JSON
  with nonzero exit codes for protocol/connection errors. Commands themselves
  retain their separate recorded exit code.
- Native Windows pipe transport uses OS-generated random names/tokens, explicit
  protected current-user-only DACLs, remote-client rejection, cancellable overlapped
  I/O, 64 KiB request/512 KiB response framing and eight concurrent workers. A
  timed-out request retains its worker permit until its domain operation ends.
  Filesystem scope checks do not hold the grant mutex and delay revocation.
- Credentials live in private files held open with delete-on-close; normal exit,
  revocation and process termination remove them. Tokens do not enter UI snapshots,
  CLI arguments or diagnostic logs. The last revocation stops the listener.
- Added scoped `panes.list`, `commands.list`, `commands.result` and `tasks.list`.
  Canonical path checks reject junction escapes and outside/unknown IDs. Command
  metadata and UTF-8 output pages are bounded; retained IDs and cursors remain
  explicit. Historical repository comparisons are labelled as historical, not a
  fresh source check. Stale pane observations become unavailable.
- Real native tests cover current-user DACLs on both pipe and file, crash cleanup,
  concurrent clients, token denial, junction boundaries, read-only task discovery,
  invalid frames and oversized responses. R57 drives actual desktop consent and
  qterm CLI subprocesses against two temporary repositories, then revoke/restart.
- Validation: **326 frontend tests, 165 native tests (3 subprocess helpers ignored),
  all 57 desktop scenarios**, both TypeScript checks, production bundling, strict
  Clippy and diff whitespace passed. Inspected the grant-panel screenshot. The
  final lock/worker refinements were rebuilt and R57 passed again; final native
  checks also passed. An existing backpressure test exposed a fixed two-second
  throughput assumption; it now waits for real paused state and delivered bytes.
- Deliberately removing scope returned the foreign pane and failed R57; removing
  token checks failed its wrong-token assertion; retaining credential handles
  failed its revoke cleanup assertion. All source restored and rebuilt; restored
  R57 passed, followed by the full desktop suite. Test notification suppression
  stayed enabled, and no installed app/live provider configuration changed.
- **At this checkpoint, phase 10 remained open:** next add separately reviewed named-task capabilities,
  bound to manifest/command/directory/shell fingerprints, stable requester/run IDs,
  a visible new-tab prompt gate, status/results and explicit stop controls. The
  current read grant cannot execute tasks or type into terminals. The user has
  already approved implementing that session-only execution policy; no new policy
  approval is needed. Recipes, session library/handoffs, WSL parity, running-session
  follow-ups and optional MCP/App Server work remain in the active full goal.

### Eighth implementation checkpoint: session-granted named tasks

- Extended Access with a separate execution review and consent. Individual named
  tasks bind the complete manifest digest, derived command, canonical directory
  and configured shell/environment fingerprint. Changed definitions require a
  new grant. Read-only grants retain no execution capability.
- Added authenticated `tasks.run` and `tasks.status`. Stable client request IDs
  are idempotent, including concurrent requests. A native atomic claim permits
  one command write into a newly created, visibly named task tab. Prompt, folder,
  actual session/profile binding and current grant are checked before launch.
  Reserved startup input prevents user or broadcast typing before that decision.
- Running tasks expose requester, state, pane, result and explicit Stop controls.
  Revocation cancels pending launches but preserves accepted running tasks;
  explicit stop targets only that pane's descendants. Uncertain writes are
  labelled unknown and never automatically retried. Four concurrent tasks and
  1024 invocation IDs bound session state.
- Completed records retain native requester/task/request identity, original
  directory, timing, exit/output and repository evidence across restart. Evidence
  failures remain explicit without preventing a permitted task in unsupported or
  large repositories. Live invocation permissions/state expire at exit.
- Real PowerShell, Cmd and Git Bash scenarios verify launch, result provenance,
  stopping and the interactive shell remaining usable. Cmd tasks use a reviewed
  child-interpreter wrapper to avoid batch cancellation prompts. Git Bash emits
  native folder identities for mount aliases; its verified launcher/interpreter
  pair is preserved during targeted stop.
- Validation: **326 frontend tests, 170 native tests (3 subprocess helpers ignored),
  all 62 desktop scenarios**, both TypeScript checks, production bundling, strict
  Clippy and whitespace checks passed. Inspected the Access screenshot, corrected
  consent-checkbox layout, then passed R58 and production bundling again.
- Deliberately removed request deduplication, manifest checks, profile checks,
  pending revocation and running-task preservation in separate mutations. R58–60
  caught each protected assertion. Regressing Bash's native folder reporting
  failed R61. All source restored, rebuilt and passed before the full suite.
  Test notification suppression stayed enabled throughout.
- The user-reported false Codex question notifications remain covered by R50:
  approval-routing events are informational, not proof of a user question, and
  equivalent completion notifications are deduplicated. The full desktop run
  passed these checks. The installed application has not been replaced.
- Full goal remains active. Next implement [workflow recipes](workflow-recipes-proposal.md),
  then session library/handoffs and WSL parity. Running-session follow-ups and
  optional MCP/App Server work remain open. No new user decision blocks this
  checkpoint; existing session-only grant and process-ownership decisions apply.

### Ninth implementation checkpoint: explicit workflow recipes

- Added Recipes in the tab bar and an unbound `recipes` palette action. The user
  selects a native shell, reviews all commands, canonical folders, dependency
  graph, readiness/deadlines, source digest and layout, then explicitly launches.
  Project discovery, refresh and workspace restoration never execute a recipe.
- Version 1 `[workflows]` supports named recipes with up to sixteen steps, each
  with a single-line command, project-relative cwd, dependencies, optional literal
  output readiness and a bounded deadline. Rejects cycles, unknown/duplicate
  dependencies/names, unsupported fields/versions, folder escapes and control
  characters. Real junction retargets invalidate reviewed folder identity.
- Native, session-only launch authority binds source bytes and configured shell
  fingerprint. Each step rechecks its actual new pane/session, prompt folder,
  dependencies and definition before its one command write. Repeated review
  submission is idempotent; uncertain launch outcomes are never retried blindly.
- Steps open in separate tabs or a single tab's rows/columns. Pending startup
  input is reserved. Dependencies require reported exit zero or current command
  output containing the literal marker; echoed input and restored output are
  excluded. Unknown Cmd exit status cannot establish success. A service exiting
  invalidates readiness; failures/timeouts block pending dependents transitively.
- Cancel affects pending steps; explicit Stop targets this workflow's programs.
  Timed-out programs remain visible for Stop. Independent running branches are
  preserved. Live permissions/actions expire at exit and restored panes do not
  replay commands. Completed records retain native workflow/step attribution,
  original cwd, output, exit and available repository evidence.
- Limits: 256 KiB source, sixteen recipes/steps, four active workflows, sixteen
  running steps, 32 recent session runs and ten-minute pending reviews. Agent
  read/task grants gain no recipe execution or arbitrary-command authority.
- Validation: **327 frontend tests, 178 native tests (3 helpers ignored), all 68
  desktop scenarios**, both TypeScript checks, strict Clippy, production bundling
  and whitespace checks passed. Eight new
  native tests cover schema/graph errors, binding, real junctions, readiness,
  cancellation, unknown writes/exits, idempotence and durable attribution. All
  six new real desktop scenarios passed after restoration, followed by a final
  rebuilt full desktop run. The full run includes the false-question notification
  and all earlier task/verification/worktree regressions.
- Deliberately permitted incomplete dependencies: R62 and R63 failed. Removing
  source digest checks failed R64. Removing deadlines and pending cancellation
  separately failed their R63 cases. All source restored and rebuilt; all six
  restored recipe scenarios passed. Test notification suppression stayed enabled.
- Inspected the real recipe result screenshot: original directory, exit status,
  workflow/step requester and repository comparison are visible in retained runs.
  Roadmap/archive now agree with implemented handoffs, worktrees and problems.
- Full goal remains active. Proceed with the
  session library and reviewed handoffs, then WSL parity. Running-session
  automatic follow-ups and optional MCP/App Server work remain open. No installed
  app, live provider settings or release was changed.

### Tenth implementation checkpoint: session library and reviewed handoffs

- Added Sessions in the tab bar and an unbound `session_library` action. Combines
  remembered Claude/Codex sessions with text, provider, project/folder, reported
  branch, environment and pin filters. Transcript discovery is explicit, shows
  source paths/errors/freshness and does not replace historical branch metadata
  with the checkout's current branch. Results are paged in the UI.
- Session identity includes provider, environment and UUID. Native Windows,
  unknown POSIX origins and each named WSL distribution stay separate. Remembered
  WSL sightings with identical UUIDs no longer overwrite another distribution or
  read a matching native transcript. Distro-side discovery remains phase 14.
- Pins persist only identities and pin time, with a 500-reference/1 MiB bound.
  Failed writes remain visible, retry without another edit and participate in
  final quit/update saves. Unreadable saved pins require Retry or explicit
  preserved-backup recovery. Missing sources remain unavailable, not recreated
  from pin data. Provider history settings discard cached library source context
  and prevent library discovery/resume/sharing for disabled providers.
- Resume revalidates source availability and folder, uses a new compatible pane
  and waits for its actual empty prompt. Reviewed session handoffs provide goals,
  findings, files, selected historical checks and next steps. Source prompt
  excerpts default off. Check excerpts retain original cwd, exit, capture limits
  and historical repository evidence; exporting performs no new verification.
- Copy/export uses the exact bounded preview. Opening a destination agent needs
  explicit consent, rechecks the source/folder, writes literal brief-file data and
  submits only the generated reference at a new prompt. Both provider destinations
  were tested with hostile shell syntax and noncolliding Markdown fences.
- Fixed a real Claude summary gap: latest typed user prompts now work without an
  optional `lastPrompt` metadata record, including JSON whitespace and text-block
  content while ignoring metadata/tool results. Added actionable source scan
  failures and removal of stale Claude index cache entries.
- Validation: **333 frontend tests, 184 native tests (3 subprocess helpers ignored),
  all 74 desktop scenarios**, both TypeScript checks, production bundling, strict
  Clippy and whitespace checks passed. Inspected final library and handoff
  screenshots; filter contrast and dialog sizing were corrected before the full
  desktop run. Isolated provider homes and shell stand-ins contacted no model.
- Deliberately merging environment identity failed R65; disabling unchanged pin
  retry and unreadable-history recovery separately failed R66; replacing literal
  brief-file transport with shell text failed R67; retaining disabled-provider
  cache state failed R68. All source restored/rebuilt, all six targeted scenarios
  passed, then the final complete desktop run passed. Notification suppression
  remained enabled for every test and deliberate mutation.
- Test setup now waits for the folder prompt before recording an attached check,
  and resets the new pin store/backups between independent desktop scenarios.
  The full run revalidated prior notification, recipe, task, verification and
  worktree behavior. No installed app or live provider configuration changed.
- Full goal remains active. Next implement [WSL parity](wsl-parity-proposal.md).
  Read-only probes confirmed existing Ubuntu/WSL2, Python 3 and Git, so no new
  installation decision blocks that work. Running-session automatic follow-ups
  and optional MCP/App Server work remain open.

### Eleventh implementation checkpoint: WSL project and diagnostic foundation

- Added explicit distribution metadata for detected and unambiguous custom WSL
  profiles. WSL Bash reports real POSIX cwd, command boundaries and exit status
  without editing startup files. WSLENV preserves user entries and passes qterm
  association/prompt variables deliberately across the boundary.
- Added a fixed JSON/Python bridge with request/result limits, timeouts and four
  worker permits retained until actual I/O completes. Distro lookup never falls
  back to the default. Project discovery uses Linux Git with hooks, fsmonitor and
  clean/process filters disabled; settings/manifests are read without executing
  project commands. Files resolve in Linux before Windows editor transport.
- Captured command environment is retained in history and displayed in Problems.
  Diagnostics use that environment after cwd changes or profile retargeting.
  Direct file links and project refresh use the pane's captured environment too.
  Native project grants continue excluding WSL pane observations after profile
  edits. Literal UTF-8 distro brief writing is prepared, but not enabled in the
  handoff UI yet.
- Validation: **333 frontend tests, 189 native tests (4 helpers ignored), all 75
  desktop scenarios**, both TypeScript checks, production bundling, strict Clippy
  and whitespace checks passed. Separately ran the ignored real-Ubuntu helper;
  it verified Linux Git index preservation, absent configured hook/filter side
  effects, case-distinct files and literal Unicode brief bytes in isolated cache.
- Registered R69 before its real ConPTY/Ubuntu desktop scenario. It verifies
  Linux cwd/project/task discovery, actual command output and original-distro
  diagnostic opening after the custom profile points elsewhere. Deliberately
  removing captured distribution routing failed the editor-file assertion;
  restored source passed, followed by the entire 75-scenario suite. Inspected the
  final screenshot. Corrected two test setup issues before the final run: the
  palette field uses its actual combobox role and snippets need explicit run=true.
- The full suite also revalidated the user's notification report: repeated Codex
  approval checks emit no question toast and duplicate completions produce one
  alert. Synthetic OS notification delivery remained suppressed throughout.
  The installed qterm app and live provider configuration remain unchanged.
- Full goal stays active. [WSL parity](wsl-parity-proposal.md) remains open for
  persisted workspace distribution identity, opt-in session sources/caches,
  distro-aware resume/handoffs, lifecycle/descendant cleanup and mount translation.
  Running-session automatic follow-ups and optional MCP/App Server work remain
  open. [Current WSL behavior and limits](wsl-support.md) distinguish this
  implemented slice from those remaining requirements.

### Twelfth implementation checkpoint: workspace environment recovery

- New panes capture native/WSL environment at creation. Automatic and named
  workspace serialization retains it with the profile and folder; restore keeps
  that identity even if the profile was removed or retargeted. Native ConPTY
  launch checks the expected environment before starting a process. Rejected
  panes retain their restored output and expose a useful launch error; switching
  the pane's profile explicitly remains available for recovery.
- Legacy built-in `wsl:<distro>` identities can be recovered from their IDs.
  Legacy custom profiles lack evidence of their original distribution and must
  adopt the current definition once; this limitation is documented. Malformed
  explicit saved environments reject restoration rather than dropping the scope.
- Split/switch folder transfer understands custom distribution metadata and uses
  the original pane's captured identity after profile edits. Linux `/c/Case`
  stays a Linux path rather than acquiring Git Bash's drive interpretation.
  Nonstandard Windows/WSL mount translation remains the next separate task.
- Native grants additionally filter command records by captured environment and
  expose that environment in metadata. A real named-pipe test proves WSL/unknown
  records stay outside a native grant despite native-looking shell and cwd.
  Pane observations use persisted identity even before a registry entry exists.
- Validation: **335 frontend tests, 191 native tests (4 helpers ignored)**, strict
  Clippy, both TypeScript checks, production bundling and whitespace checks
  passed. The full desktop run passed 75/76; the remaining case failed before
  test actions at WebView2 CDP attachment (`ETIMEDOUT`). With source unchanged,
  its five-scenario handoff file passed on focused rerun. The expanded WSL restore
  test also passed, so all **76 desktop scenarios** passed across those runs.
- R70 was registered before its spec. Real Ubuntu/ConPTY tests preserve actual
  computed output through restarts, reject an edited profile before a real Node
  sentinel can start, reject a removed profile without default substitution, and
  recover by an explicit PowerShell switch. Inspected the rejection screenshot.
  Deliberately disabling native environment validation and separately omitting
  persisted environment each failed its protected assertion. Restored source
  rebuilt/passed before the final suite. Corrected an initial test-only use of a
  PowerShell prompt helper for Bash. Notification suppression stayed enabled.
- The full goal remains active: finish mount translation, then opt-in WSL source
  discovery/caches, distro-aware resume/handoffs and Linux lifecycle/ownership.
  Running-session automatic follow-ups and optional MCP/App Server work remain
  open. No installed app or live provider configuration was changed.

### Thirteenth implementation checkpoint: mount-aware path transport

- Added a bounded fixed-bridge path translation operation using the selected
  distribution's `/usr/bin/wslpath`. Folder transfers no longer infer a drive
  from `/mnt/<drive>` text. They resolve Linux aliases before conversion and
  transfer shared Windows folders between distros through their real Windows
  path; distro-only folders remain scoped and Cmd still rejects UNC cwd.
- Split/switch now await conversion and reject obsolete source context. Switching
  also rechecks the shell session and submission revision before replacing it.
  Translation errors preserve the original pane instead of launching elsewhere.
  Project tasks in a new split wait for its empty prompt and actual requested
  folder; without shell integration they fail visibly before opening a task pane.
- The shared file/image paste pipeline translates against the captured destination
  distribution before quoting and cancels if the destination/session or submitted
  command changes during the operation. Foreign-distro UNC files are rejected.
  The WSL quote helper refuses raw Windows paths instead of guessing mount roots.
  Pane startup now captures shell kind for file quoting and finished-run metadata,
  preventing later profile edits from changing those interpretations.
- Validation: **336 frontend tests, 191 native tests (4 helpers ignored), all 77
  desktop scenarios** passed, plus both TypeScript checks, strict Clippy,
  production bundling and whitespace checks. The separate real Ubuntu helper
  verified case-sensitive same-distro paths, a foreign-distro UNC pointing at an
  actually existing local file, native Windows directory round trips and rejection
  of relative paths. No live provider data was scanned.
- Registered R71 before its spec. Real Windows clipboard PNG bytes were read by
  Linux Python in the split shell. A symlink alias outside `/mnt` transferred back
  to the original Windows folder with Unicode, quote and dollar characters, where
  Cmd computed its expected output. This tests a real alias without modifying
  distribution mount configuration; pure transfer tests also cover arbitrary
  converter-returned roots. Inspected the final screenshot.
- Deliberately removing folder conversion failed the mapped-cwd assertion;
  removing image conversion failed the pasted-file assertion. Source was restored
  and the path test passed before the complete final suite. Initial test setup
  assumed synchronous pane changes and omitted qterm's existing WSL switch-shell
  confirmation; corrected both using state waits and its actual confirmation
  button. Test builds kept native notification delivery suppressed throughout.
- Full goal remains active. Finish per-target mixed-shell broadcast file delivery
  and Windows representability validation, then opt-in WSL source discovery and
  scoped caches, distro-aware resume/handoffs and Linux lifecycle/ownership.
  Running-session automatic follow-ups and optional MCP/App Server work remain
  open. No installed app or live provider configuration changed.

### Fourteenth implementation checkpoint: broadcast file and protocol routing

- File/image delivery now captures every broadcast destination's session, input
  revision, environment and shell kind. It prepares each translated/quoted path
  before typing, caches conversion within a distribution, rejects unknown or
  startup-reserved destinations, and revalidates the entire group after the async
  work. A changed group/target or preparation failure cancels before delivery.
  Per-target xterm paste preserves bracketed-paste handling without rebroadcasting
  the already prepared path to the other interpreters.
- Real mixed-shell testing found a separate input corruption bug: PowerShell's
  cursor/status reply was broadcast to Bash as literal input. Device, focus,
  OSC/DCS and status replies now stay with their originating PTY. Keyboard events
  still broadcast, including modified F3 encodings that resemble cursor reports;
  the public onKey event distinguishes those cases. Reserved task panes continue
  accepting protocol replies without accepting user input.
- Linux-to-Windows path conversion rejects unrepresentable Linux names before
  transport and checks the returned Windows path is absolute and accessible.
  Conversion failure preserves the original pane instead of replacing it with a
  shell that silently falls back to its home folder.
- Validation: **340 frontend tests, 191 native tests (4 helpers ignored), all 79
  desktop scenarios** passed, alongside strict Clippy, both TypeScript checks,
  production bundling and whitespace checks. The separately run real Ubuntu
  helper verified actual colon-bearing Linux folder rejection in addition to its
  existing Git, path and literal-brief checks.
- Registered R72/R73 before their specs. Windows PowerShell and Linux Python each
  read the same actual clipboard PNG and computed its 17×3 dimensions; Linux also
  required exactly one file argument. A real unrepresentable Linux directory
  blocked switching, and the same Bash process computed output afterward.
  Inspected both final screenshots. Unit tests additionally cover heterogeneous
  quoting, per-distro translation reuse, unknown/failed sources, and zero delivery
  after target/session/input/environment/group changes.
- Deliberately rebroadcasting prepared paths failed the Windows result assertion;
  rebroadcasting protocol replies failed the Linux result assertion; swallowing
  conversion errors failed the source-preservation assertion. All source restored,
  targeted tests passed, then the final 79-scenario run passed in one run. Fixed an
  initial test-only PowerShell method-argument syntax issue. Native notification
  delivery stayed suppressed in every test and mutation.
- Full goal remains active. Next implement named-distribution opt-in session
  sources with explicit home overrides, independent provider/environment caches,
  retention gates and case-aware prompt checks. Distro-aware resume/handoffs,
  Linux lifecycle/descendant ownership and running-session automatic follow-ups
  remain open. Optional MCP/App Server work remains separate. No installed app or
  live provider configuration was changed.

### Fifteenth implementation checkpoint: explicit WSL transcript discovery

- Added persistent `wsl_sources` settings and a Settings editor for exact distro
  names, explicit enablement and absolute Linux Claude/Codex home overrides.
  Sources default disabled; provider history is an additional gate. Listing
  installed distributions is separate from reading transcripts. Empty homes
  resolve only during explicit discovery; no shell startup files are sourced.
- The library now combines native and opted-in WSL source summaries with separate
  provider/environment identity and status. Scanner instances additionally scope
  by resolved home and source signature. Native indices are never reused for WSL.
  Source changes/removal/history gates purge discovery caches and reject stale
  in-flight results. The UI rejects stale source revisions before exposing cached
  WSL context. Native grouping skips direct WSL UNC paths in passive catalogs.
- Source rows support browsing, filtering and identity-only pins. Missing distros
  report errors without default substitution; fixture hashes verify discovery
  writes no transcript data. WSL resume/handoff actions remain disabled until the
  next launch slice validates its environment and prompt guards. Native launch
  behavior and its source validation remain intact.
- New session sightings retain captured environment independently of editable
  custom profile IDs. Claude/Codex stores avoid matching native transcript lookup
  for a WSL sighting and preserve same-UUID sightings in different environments.
  Old saved sessions still deserialize without the added optional field.
- Validation: **341 frontend tests, 196 native tests (4 helpers ignored), all 80
  desktop scenarios**, strict Clippy, both TypeScript checks, production bundling
  and whitespace checks passed. R74 was registered before its real Windows/Ubuntu
  fixture. It covers disabled sources, UI opt-in without passive discovery,
  colliding provider UUIDs, home retargeting, provider retention gates, source
  disabling and unavailable distros. All provider homes were isolated fixtures.
- Deliberately bypassing source and provider gates separately failed the native
  no-scan assertion. Merging environment identity failed the desktop collision
  assertion; retaining a previous home's cache failed the home-invalidation
  assertion. Source restored, targeted checks passed, then the full 80-scenario
  run passed. Fixed a test setup race by waiting for the actual config watcher
  before requesting discovery of its new source configuration.
- Inspected the library and Settings screenshots, aligned the source fields with
  existing Settings styling, then reran the source and settings-layout scenarios
  successfully. Notification suppression stayed enabled throughout. No installed
  app or live provider configuration changed, and no model was contacted.
- Full goal stays active. Next add distribution-aware resume/handoffs with exact
  source/folder revalidation and Linux case-aware prompt comparison. Audit
  native-only telemetry against captured environment. Linux descendant ownership,
  running-session automatic follow-ups and optional MCP/App Server work remain
  open. [Current WSL behavior](wsl-support.md) distinguishes discovery from the
  remaining automatic launch work.

### Sixteenth implementation checkpoint: WSL session resume and reviewed handoffs

- Verified library sources can launch in a matching distribution profile. Native
  source resolution now binds a source revision, configuration and resolved home;
  folder validation uses the source environment and returns its canonical launch
  folder. Source settings/history are checked again after filesystem operations.
  Missing distributions/profiles never substitute another environment.
- Resume commands preserve the discovered provider home, including literal quotes,
  spaces and Unicode, even if startup files set a different home. Same-provider
  session handoffs preserve it too; cross-provider handoffs use the selected
  profile's destination configuration. Reviewed WSL briefs are literal UTF-8 files
  in the selected distribution cache. Copy/export also revalidate source access.
- Deferred source launches wait for actual prompt telemetry and compare Linux
  paths case-sensitively, without treating `/c/...` as a Windows alias. They
  revalidate source/folder at the prompt and cancel when history/source access
  changes. Cancelling leaves the shell usable. Startup captures shell kind and
  native spawn checks it alongside environment before launching.
- Native process and usage lookups exclude WSL and unclassified custom shells.
  Explicit hook/session observations keep their captured environment; matching
  native UUIDs cannot supply WSL usage through the native indexes.
- R75–R77 were registered before their real Ubuntu fixtures. Six new desktop
  scenarios cover both provider resumes, exact reviewed brief bytes for both
  destinations, busy source isolation, wrong-case folders and revocation during
  a real startup read barrier. All pass. Deliberately removing home binding,
  corrupting the brief and case-folding Linux folders each failed its protected
  assertion; source was restored and all six passed again. No models contacted.
- Strict Clippy, 196 native tests (4 helpers ignored), both TypeScript checks,
  production bundling and 345 frontend tests passed. The notification regression
  passed again: approval checks produce no false unanswered question/toast and
  duplicate completions produce one recorded notification. Windows notification
  delivery remained suppressed. All **86 desktop scenarios** passed in one final
  run. Inspected the WSL handoff screenshot and checked whitespace; both passed.
- Fixed a PowerShell provider-home assignment quoting regression found by the
  existing native handoff test. Corrected fixture-only assumptions about Ubuntu's
  prompt and the notice's dismiss button; no production behavior was weakened.
- The overall goal remains active. Next extend WSL output-to-agent handoffs,
  validate Linux lifecycle/descendant ownership and audit older provider menus.
  Running-session automatic follow-ups and optional MCP/App Server work remain
  separate open items. Installed qterm and live provider configuration unchanged.

### Seventeenth implementation checkpoint: WSL reviewed output handoffs

- Command/selection handoffs retain the pane's captured environment and shell
  kind independently of editable profile definitions. The preview and brief
  include environment provenance. Only compatible native or same-distribution
  shells are offered; unknown environments require a manual copied brief.
- WSL handoffs validate the original Linux command folder through the fixed,
  bounded bridge and write literal UTF-8 briefs in that distribution's cache.
  New tabs keep the command's original folder after the source moves. Either
  provider can also reuse the source shell at a confirmed empty prompt.
- Reuse rejects busy programs, unknown/unfinished prompts, wrong-case folders
  and broadcast input. It captures session, environment, kind, folder, prompt
  identity and every non-protocol input revision, then compares again after
  asynchronous preparation. Delivery stays in the selected pane. Windows
  process scans are not used as Linux-idleness evidence.
- R78/R79 were registered before seven real Ubuntu desktop scenarios covering
  both providers in new/current panes, exact literal bytes with hostile shell
  text, original folders and busy/folder/broadcast rejection. Deliberately
  corrupting a brief and bypassing the original-folder check each failed its
  protected assertion. All 12 native/WSL output scenarios passed after restore.
- Final validation: **345 frontend tests, 196 native tests (4 helpers ignored),
  all 93 desktop scenarios**, strict Clippy, both TypeScript checks, production
  bundling and whitespace checks passed. Inspected the WSL output preview
  screenshot. Windows notification delivery remained
  suppressed in all tests, including deliberate breaks. No models contacted;
  installed qterm and live provider configuration unchanged.
- Linux ownership investigation is separate from the validated runtime. A
  fixture subreaper adopted and reaped a detached double-forked child after
  graceful stdin EOF. Forced termination of its Windows WSL client did not
  deliver cleanup, so stdin EOF alone is insufficient. A Windows delete-on-close
  lifetime file was readable from Linux while owned and disappeared after its
  exact fixture owner was killed. A subsequent combined test passed after killing
  both Windows owners: the detached child was killed and reaped, even with another
  Linux process holding the lifetime file open. Production integration and real
  interactive PTY/resize/control tests remain open. Removed fixture-only orphaned
  processes using pinned process handles and exact owned command-line checks.
  No distro was terminated. Design references: Microsoft's
  [WSL process/interop lifetime](https://github.com/microsoft/WSL/blob/master/doc/docs/technical-documentation/boot-process.md),
  [Linux subreapers](https://linuxman7.org/linux/man-pages/man2/PR_SET_CHILD_SUBREAPER.2const.html)
  and [PID-file-descriptor signals](https://www.man7.org/linux/man-pages/man2/pidfd_send_signal.2.html).
- Full goal remains active. Continue Linux lifecycle/descendant ownership, older
  provider-menu scoping and running-session follow-ups. Optional MCP/App Server
  work remains separate; this checkpoint does not claim full WSL parity.

### Eighteenth implementation checkpoint: Linux ownership and fixed control isolation

- Recognized WSL panes now retain a separate private Windows lifetime file with
  an immutable, non-inheritable delete-on-close handle. WSLENV translates its
  resolved Windows path using the selected distribution's mount configuration.
  The lifetime drops before PTY handles, avoiding shutdown waits on live Linux
  output handles. Other panes retain independent lifetimes.
- A fixed embedded Python subreaper monitors lifetime and child exit without
  reading/relaying terminal stdin or creating another PTY. Bash retains its
  original terminal and process-group control. Cleanup repeatedly signals pinned
  kernel-reported direct children and reaps adopted orphans, including double
  forks/setsid, without scanning or terminating unrelated processes or a distro.
  Missing Python/PID-fd/subreaper/proc traversal support fails before user exec.
- Control Python now uses `-I -S` for supervisor and data operations. Real hostile
  `sitecustomize.py`/PYTHONPATH fixtures prove pane/project startup and source
  discovery do not execute project Python startup code through these helpers.
  Shell/tool environments remain available to the normal user process.
- R80–R82 were registered before four real Ubuntu scenarios. They cover per-pane
  cleanup, graceful qterm exit, forced Windows app termination, unrelated-process
  survival, literal stdin, Ctrl-C, stopped/foreground jobs, terminal resize,
  command exit telemetry and control isolation. Deliberately omitting cleanup,
  disconnecting stdin and disabling each helper isolation boundary failed the
  protected assertions; source restored and all four focused scenarios passed.
- A later real pipeline probe found Python's ignored SIGPIPE leaking through
  exec. The new desktop assertion reproduced `PIPE_CODES_1_0` instead of normal
  `PIPE_CODES_141_0`. The child now restores Python's ignored signal dispositions,
  including SIGPIPE and file-size signals, before exec. All **97 desktop scenarios**
  passed in the final run with the pipeline assertion. Strengthened foreground-job
  testing to wait for a real SIGCONT acknowledgment before interrupting it; that
  scenario passed again after the full run.
- Current checks: 345 frontend tests, 197 native tests (4 helpers ignored), strict
  Clippy, both TypeScript checks, production bundling and whitespace checks pass.
  An initial full run passed before the additional pipeline assertion; the final
  full run also passed after the signal fix. Native notification suppression stayed
  enabled in every run and deliberate break. No model or live provider config was
  touched, and installed qterm is unchanged.
- This is **same-user Linux cleanup**, not yet the complete requested privilege
  boundary. An unprivileged supervisor cannot signal sudo/root descendants.
  Prepared the [fixed root-supervisor proposal](wsl-ownership-proposal.md) and
  asked the user whether to allow it while keeping shell/tools unprivileged.
  That decision is pending; no root supervisor was implemented or started.
- The [provider-menu audit](provider-menu-scope-audit.md) records remaining UUID-only
  joins/removal, dropped environment fields, backend history gates and parallel
  unsafe resume paths. Continue those independent changes while a root decision
  is pending. Linux live-process probes, Windows interop ownership, running-session
  follow-ups and optional MCP/App Server work also remain open. Goal stays active.

### Nineteenth implementation checkpoint: scoped provider menus (pause point)

- Remembered rows, folder groups and palette entries retain environment identity.
  Native transcript joins match only native references. Native browsing is labelled
  **Native Windows**; Claude also has explicit refresh/error feedback. Literal
  Linux backslashes/case are preserved in grouping and filtering.
- Both stores accept validated environment/UUID removal references; legacy UUID
  callers affect only native references. Failed removal saves preserve memory.
  Native scan commands gate history before/after reading and run off the async
  worker. Relative native homes resolve to absolute paths before source binding.
- Claude/Codex legacy resume now shares library source/folder/home validation and
  matching-environment new-tab launch. Reuse captures and rechecks actual prompt,
  input and focus through awaits, uses captured shell kind, and quotes folder/home
  as literal data. Busy/incompatible initial targets use a verified new tab.
  Fresh group actions also retain environment and wait for an actual prompt.
- R83–R86 registered before 12 real Windows/Ubuntu scenarios. All pass, including
  collisions, per-row/group removal, source disabling/unavailable distro, new/current
  resume through a startup read barrier, relative native homes and fresh sessions.
  Five deliberate breaks were caught: UUID-only removal, environment-less grouping,
  missing home binding, bypassed source validation and incompatible fresh fallback.
  Restored source, native scope test and all 12 scenarios passed afterward.
- Validation: **347 frontend tests, 199 native tests (4 helpers ignored)**, strict
  Clippy and focused desktop tests passed. Both TypeScript checks, production
  build and whitespace checks passed at pause. Full **109 desktop scenarios have not yet been run**
  on checkpoint 19; last full baseline was checkpoint 18's 97 scenarios.
- Corrected the scope fixture to expect a native session to be remembered again
  after a successful resume. Inspected the scoped-menu screenshot. All provider
  CLIs were controlled fixtures; no models, installed app or live config touched.
- User requested a logical stopping point near the weekly limit. Save current
  changes uncommitted, finish workspace checks and pause. Resume from
  [the handoff](resume-handoff.md); preserve the full objective and outstanding
  root decision, Linux live probes/Windows interop checks and running-session work.
