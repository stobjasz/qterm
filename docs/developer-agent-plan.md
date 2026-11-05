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
4. **Send output to an agent** (new/idle-shell handoff implemented; running-session follow-ups explicitly deferred by the user on 5 November): preview command, cwd, exit status and bounded
   selected output; choose Claude or Codex and new or compatible existing pane.
   Treat text as prompt data, never shell source. Do not auto-submit from a preview.
5. **Efficient Codex indexing** (implemented and measured; [baseline and limits](codex-index-measurement.md)): batch usage reads, surface scan diagnostics and
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
10. **Scoped local CLI** (implemented and regression-verified; startup reservation race fixed in checkpoint 22): list panes, retrieve bounded command results, list/run
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
14. **WSL parity** (implemented within the user's accepted unprivileged cleanup limit; [support](wsl-support.md), [contract](wsl-parity-proposal.md)): explicit distro identity, opt-in session indexing, distro-side
    project discovery and path-aware file links. Keep native and WSL identities
    separate even when textual paths match.
15. **Optional Codex App Server spike**: isolate behind a capability adapter and
    test against a specific CLI version before deciding whether to ship it.

## Decisions to bring to the user

- Local automation **decided**: the user approved explicit, session-only project
  grants for named-task execution. All access stays off until granted; see
  [the interface proposal](local-agent-interface-proposal.md). Ask again before
  adding persistent grants or arbitrary execution authority.
- Native agent UI **deferred by the user, 5 November 2026**: no managed-session
  conversation/approval UI or automatic running-agent follow-ups in this delivery.
  Keep the normal CLI as the primary UI and retain reviewed new/idle-shell handoffs.
- Cross-provider handoffs: explicit exports initially; ask before enabling ongoing
  automatic sharing of transcript/context between providers.
- Worktree completion: ask before adding automated merge, dependency bootstrap,
  or destructive cleanup behavior.
- Process ownership **decided**: the user chose to end all descendant processes
  when qterm exits, including detached tools launched from shells. Use a Windows
  job; allow only an explicit verified update's replacement/installer to survive
  the old instance. This supersedes the earlier preserve-GUI-tools design.
- Linux privilege exception **accepted by the user, 5 November 2026**: “limits”
  accepts user-level cleanup; descendants gaining Linux privilege may survive.
  No root supervisor is approved. This is the explicit exception to the original
  unrestricted descendant policy for the delivered scope.

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

### Checkpoint 19 full validation after resumption — 4 November 2026

- Prior implementation is saved in commit `bec702d`; the worktree was clean at
  resumption. All **109 desktop scenarios passed** with no skips or failures in
  7.7 minutes, including the 12 provider-menu scenarios and R50 notification policy.
- The first attempt lost its tool session after at least 26 passing scenarios.
  Checked its missing handle and actual process state before restarting; no
  parallel suite was launched. The completed run has a durable JSON report and
  transcript in ignored `.tools.local/checkpoint19-full-desktop.{json,log}`.
- Inspected the current scoped-menu screenshot: Native Windows and separate WSL
  groups fit without overlapping labels/controls. Updated the historical menu
  audit and WSL documentation to reflect implemented fixes. Cleanup checks found
  zero isolated app/runner processes, lifetime files, Linux supervisors or fixture
  daemons. Native notification suppression remained enabled; installed qterm and
  live provider configuration were untouched.
- Frontend/native validation remains the checkpoint 19 result (347 frontend,
  199 native, strict Clippy and both TypeScript checks); this run rebuilt the
  isolated desktop app without changing runtime source. The full goal remains
  active. The explicit remaining WSL workflow acceptance list is in
  [the parity plan](wsl-parity-proposal.md#remaining-workflow-acceptance).

### Twentieth implementation checkpoint: Linux close/Stop program evidence

- WSL close/switch and explicit Stop now query the supervisor captured when the
  pane started. Native inspection remains separate. Operations run on blocking
  workers; the session lock is released before distribution I/O. Probe failure
  requires an explicit close confirmation and cannot be treated as an idle pane.
- A fixed Unix-socket channel exposes only `programs` and `stop`, with matching
  user credentials, a random per-pane key, nonce-bound request/response HMACs,
  bounded frames and authenticated expiry. The address hashes the key rather
  than exposing it. No caller-supplied executable, command, PID or root operation
  is accepted. Abstract sockets have no filesystem permission boundary, so the
  authentication/credential checks are required; see [Linux Unix sockets](https://www.man7.org/linux/man-pages/man7/unix.7.html).
- Linux inspection walks only the supervisor's kernel-reported descendants,
  including each process's worker-thread children. PID file descriptors pin
  targets; a parent must remain alive while its children are accepted. Work,
  thread/child counts and output are bounded. Stop repeats inspection to catch
  newly forked/adopted programs, preserves the shell and leaves other panes alone.
- Root executable identity is compared with the user's configured shell and
  `/etc/shells`. A directly launched/replaced program is named before close;
  shell-preserving Stop reports that no shell remains instead of claiming idle.
- Registered R87–R90 before four real desktop scenarios. All four focused cases
  pass. Eight deliberate breaks were caught across detection, worker threads,
  Stop signaling, error-as-idle, request authentication, direct roots, expiry
  and false helper confirmation for idle switches; original sources were restored.
  Teardown tolerates an already-ended supervisor and avoids resuming a reused PID.
- A stronger suspended-supervisor test reproduced a queued Stop killing a program
  started after timeout. Authenticated monotonic expiry now gates acceptance and
  every Stop signal; the restored scenario preserves the later program. A full
  run of the earlier implementation was deliberately stopped after 15 passing
  scenarios to fix this issue. It is not final acceptance evidence.
- The first completed full run passed 111 scenarios; two older path scenarios
  timed out waiting for an unconditional switch confirmation. Actual idle Linux
  shells now switch directly. Updated R71/R73 and their assertions while retaining
  path/PNG conversion and unrepresentable-path preservation checks; both passed.
  Deliberately adding a false Windows-helper program made the updated path test
  fail. Timeout cleanup now tolerates already-removed owned Linux directories;
  the one remaining Windows fixture was verified and removed separately.
- Final frontend validation passes: 347 tests, both TypeScript checks and
  production bundling. Strict Clippy and 199 native tests pass (four helpers
  ignored). All **113 desktop scenarios passed** in the final full run (8.0 minutes,
  no skips/failures/flaky results). The durable JSON report and transcript are
  `.tools.local/checkpoint20-full-desktop.{json,log}`. Final cleanup checks found
  no isolated runner/app, lifetime files, Linux supervisors or fixture programs.
  Notification suppression stayed enabled throughout; installed qterm, live
  provider configuration and model usage were unchanged.
  Remaining provider-specific Linux presence/status, Windows interop,
  privileged cleanup decision and WSL workflow parity stay on the full backlog.

### Twenty-first implementation checkpoint: close context and shell invocation

- Close/switch captures pane/profile/environment, actual terminal session and
  user-input revision. Whole-tab checks also bind the exact membership. Recheck
  after successful/failed process probes and again when confirmation is accepted;
  cancel obsolete actions with an explanation. Newer requests supersede older
  pending checks. Terminal protocol replies do not invalidate user-input context.
- Linux shell-root classification now checks the bounded invocation alongside
  the executable and declared shell names. Command/script launches do not imply
  an interactive shell to preserve; shared BusyBox images require a declared
  shell applet/name. RC/init-file operands remain literal data and supported
  interactive profiles retain Stop. Unknown long options conservatively decline
  shell-preserving Stop.
- R91/R92 registered before six desktop cases: delayed input/split/exit,
  confirmation after session exit, and actual Bash command/script roots. Fourteen
  pure Python cases additionally cover shared images, aliases, login names,
  literal RC operands, missing operands and unsupported flags. BusyBox is absent
  from this Ubuntu installation; no package or root operation was used, and no
  real BusyBox runtime validation is claimed.
- Focused validation passed. Five deliberate breaks were caught: omitted input
  revision, omitted tab-membership check, unguarded confirmation callback,
  executable-only shell classification and omitted shared-image alias check.
  Restored sources before final checks. The confirmation race keeps a second tab
  open: normal hide-on-last-tab behavior otherwise hides its modal. A pinned,
  command-line-checked child signal supplies the real exit boundary.
- Frontend: 347 tests, both TypeScript checks and production build pass. Strict
  Clippy and 199 native tests pass (four helpers ignored). The first full run passed
  117/119; two apps failed before frontend load with WebView2 HRESULT 0x800700AA
  (profile resource still in use). The harness now waits for actual processes
  using the exact isolated profile to exit before launch, rather than relying on
  CDP-port closure. Verified its matcher against six live isolated WebViews and
  an empty post-run result; no retries or unrelated process termination were added.
  The original result/log are `.tools.local/checkpoint21-before-profile-barrier.*`.
  The next full run completed **118/119 passing**, with no startup failures. One
  existing R61 Git Bash watch program did not start before its 15-second bound;
  that older assertion captured only file existence. Added actual invocation
  state/error and terminal output to the assertion, then repeated both native
  shell scenarios five times: **10/10 passed**. This does not prove the intermittent
  failure fixed. Preserve it as open work and use the improved evidence on recurrence.
  Reports: `.tools.local/checkpoint21-full-desktop.{json,log}` (118/119),
  `.tools.local/checkpoint21-watch-failure.*` (copy), and
  `.tools.local/checkpoint21-native-shell-repeat.log` (10/10). No live handles
  remain. Final cleanup found no isolated app/WebView, lifetime files, Linux
  supervisors, fixture programs or fixture-environment processes. Provider-specific
  process/lifecycle status, Windows interop, privileged ownership decision and
  the remaining WSL workflow acceptance list still prevent full-goal completion.

### Twenty-second implementation checkpoint: startup reservation commit race

- Thirty additional sequential Git Bash task scenarios passed without reproducing
  R61 (`.tools.local/checkpoint22-bash-reproduction.log`). A new R93 concurrent
  request test then reproduced cancellation with **The task pane closed or changed
  shell** while panes were being created. Four simultaneous requests exercise the
  interface's actual active-task limit; no invoke mocking or state injection.
- Startup reservations enter mutable maps before React commits their panes. An
  effect from an older workspace could mistake an uncommitted pane for a closed
  pane. Track whether each reservation has observed its expected pane; absence
  before that observation keeps it pending, while later absence or a wrong profile
  still cancels it. Apply the same guard to tracked-verification tickets, which
  shared the premature-cancellation pattern.
- Registered R93/R94 before their specs. R93 runs six rounds of four real concurrent
  Git Bash requests, checks distinct panes and exactly-once output, verifies retry
  identity and preserves the busy source program. R94 closes a mounted PowerShell
  task waiting for a startup prompt and verifies cancellation without command
  execution or source-pane closure. The focused task/shell/verification suite passes.
- Restoring premature cancellation failed R93 again; disabling real-close
  cancellation failed R94. Both deliberate breaks were caught and the helper was
  restored (`.tools.local/pane-reservation-mutation-*.log`). The concurrency case
  used all 24 task panes; WebGL context-loss warnings caused renderer fallback
  without losing terminal results.
- Frontend: 347 tests, both TypeScript checks, production bundling pass. Native
  source is unchanged from the prior strict Clippy/199-test result. All **121
  desktop scenarios passed** in the final full run (10.7 minutes, no skips,
  failures or flaky results), with report/log in
  `.tools.local/checkpoint22-full-desktop.{json,log}`. Cleanup found no isolated
  app/WebView, lifetime files, Linux supervisors or fixture processes. There are
  no live build/test handles. Notification suppression remained enabled; no
  installed app, live provider configuration or model call changed. The original isolated R61
  failure lacked job diagnostics, so do not claim this proves its sole cause;
  retain the improved diagnostics. That scenario passed in the final full run.
- Provider-specific Linux process/lifecycle status, Windows interop ownership,
  the pending privileged-supervisor decision and WSL workflow parity remain open.

### Twenty-third implementation checkpoint: scoped provider process evidence

- Share a bounded process poll between Claude and Codex. Capture terminal-session
  identity and its environment in the backend; return presence, errors, observation
  time and ended-session state separately. Native ToolHelp failures are errors
  rather than successful empty scans. Keep unsupported custom contexts unknown.
- Probe only each WSL pane's captured supervisor tree through authenticated
  presence requests. Group requests by exact distribution, bound batches to four
  owners, and retain per-owner failures without discarding healthy sibling results.
  No native process or transcript index substitutes for Linux evidence. Provider
  image names and Node script positions are recognized; prompt arguments are not
  provider identity. This implements process presence, not Linux lifecycle hooks.
- Associated panes retain unknown state for failed, stale or mismatched process
  evidence. Unrecognized Linux wrappers with known associations need a shell prompt
  before clearing. Keep hook provenance and clone observation views so a transient
  failure cannot mutate the retained hook event or prevent subsequent recovery.
  Unknown status text does not claim a running process after an unsuccessful probe.
- R95/R96 were registered before four real desktop cases. Both providers pass
  quiet process discovery, same-folder isolation, ended-process removal and
  independent probe-error recovery. Copy the real Python executable under provider
  image names; wait for signals without provider/model calls. Ubuntu's multicall
  sleep rejects renamed images, even with altered argv[0]; initial failures used
  that invalid fixture, not a working quiet process.
- Four deliberate breaks were caught and restored: disabled presence, omitted
  errors, retained ended status and mutation of a frozen lifecycle event. The
  ended-process test initially accepted unknown-to-busy as badge removal; strengthen
  it to require every status badge for that provider to disappear. Logs and helper:
  `.tools.local/provider-process-mutation-*`,
  `.tools.local/verify-provider-process-regressions.mjs`.
- A separate freshness clock expires published evidence while a backend request
  is pending, without issuing overlapping RPCs. Two additional unit cases cover
  expiry/recovery and ended/error retention. Deliberate omission of expiry fails.
  The first full run passed 124/125; R88 hit Windows' command-line length limit
  while embedding the larger supervisor in its helper. Pass helper source on
  stdin instead. Deliberately restoring the old transport reproduces
  `ENAMETOOLONG`; restored transport passes R88 and both provider-probe cases.
  R82 once reported cwd `/`, then passed on focused rerun. Its cause remains
  unproved; preserve cwd-plus-terminal diagnostics and watch the next full run.
- Current checks: both TypeScript checks, 353 frontend tests, production bundle,
  strict Clippy and 199 native tests pass (five helpers/opt-in tests ignored after
  the benchmark addition). All **125 desktop scenarios passed** in the final full
  run (12.3 minutes, no skips/failures/flaky results). Report/log:
  `.tools.local/checkpoint23-full-desktop.{json,log}`. Final cleanup found no
  isolated app/WebView, lifetime file, Linux supervisor or fixture process. R82
  passed in this run; its earlier failed start is not independently explained.
  Windows interoperability ownership, real multi-call
  shell validation, privileged ownership decision and WSL workflow parity remain
  open, alongside running-session follow-ups.

### Twenty-fourth implementation checkpoint: measured native Codex indexing

- Added an opt-in, test-only generated-history benchmark with 100/1,000 smaller
  transcripts and 100 larger transcripts. Measure initial indexing, cached scans,
  16-usage batching versus individual calls and one-file append refresh; assert
  append/deletion correctness. No live provider data or configuration is involved.
- Strict Clippy and the default native suite pass (199 passing, five ignored).
  After desktop testing and process cleanup finished, the explicit ignored
  benchmark passed all three generated-history datasets and removed its fixtures.
- A 16-usage batch was 15.04–15.84 times faster than 16 separate calls. At 1,000
  transcripts/64 MiB, debug-build initial indexing took 3.15 seconds; the cached
  batch median/p95 were 28.03/33.42 ms versus 434.20 ms median for separate calls.
  Keep the existing cache and batching; these results do not justify a more complex
  index yet. Preserve background scan/loading diagnostics for initial indexing.
  This is not a cold-disk, release-build or WSL performance claim. See the
  [baseline, procedure and limits](codex-index-measurement.md).
- Raw output: `.tools.local/codex-index-debug.log`. No installed app, provider
  configuration, live transcript or model call changed. All handles are terminal.

### Twenty-fifth implementation checkpoint: Windows interoperability ownership (accepted)

- Registered R97/R98/R99 before four actual Windows-through-WSL cases. Launch
  inert Windows Node programs with detached Windows children, retaining unrelated
  root/child programs. Inspect/clean only exact fixture executable/script/tag
  identities through pinned OS handles. `Qterm.crash()` terminates only the app;
  test-side tree killing must not provide the cleanup being tested.
- Quit and direct crash already cleaned both Windows processes. Pane closure
  reproduced a surviving detached Windows child. A per-pane owner helper fixed
  it in the console-subsystem debug build (five focused cases passed), but all
  five cases failed before a prompt with the release GUI subsystem. Reject and
  remove that production prototype. Preserve its ignored source/logs as evidence.
  Removing it deliberately reproduced the detached-child failure. Replace the
  approach with parent-held, creation-time ConPTY job assignment; see
  [the next implementation plan](wsl-interop-ownership-plan.md).
- **R99 is still failing:** shell-preserving Stop leaves a detached Windows child.
  A per-pane job cannot simply be terminated while retaining the WSL
  client. Keep this requirement and failing spec; investigate controlled parent
  job access, pinned member identity and a preserved client boundary. Do not
  substitute an app exit or pane close for Stop. Log:
  `.tools.local/checkpoint25-interop-stop.log`.
- Mutation/GUI-subsystem script is terminal; do not rerun that rejected prototype
  script unchanged. Production source and the normal artifact are restored;
  quit/crash revalidation passes (2/2). All handles are terminal and cleanup found
  no isolated WebViews, supervisors, fixture programs or lifetime files. No complete
  129-scenario desktop run is claimed: R98/R99 still need implementation.
  Root-supervisor
  approval remains pending; no privileged Linux operation was used.
- Replacement now implemented: a licensed local portable-pty 0.9.0 patch adds only
  a Windows job-list creation attribute and optional, non-serialized builder handle.
  qterm creates a private kill-on-close job before the WSL client runs and retains
  its handle in Session, releasing it before console teardown. Cargo.lock changes
  only the dependency's registry source/checksum; no versions changed. Offline
  check and strict Clippy pass. All five focused cases pass. Removing the creation
  attribute deliberately reproduces R98. All five focused cases pass with the GUI
  subsystem too; normal sources/artifact were restored and R98 passed again.
  Replacement script: `.tools.local/verify-interop-job-creation.mjs`, logs:
  `.tools.local/interop-job-{missing-attribute,gui-subsystem,restored}.log`.
  Three upstream source files differ (38 additions, one removal); license text
  and dependency versions are unchanged. Cleanup found no isolated WebViews,
  supervisors, fixture programs or lifetime files; all handles are terminal.
  R99 Stop implementation and full acceptance are still outstanding.
- Setup failures also release the job before the PTY: the owning local is declared
  after console creation, then moved into Session on success. Final strict Clippy
  and native tests pass (199 passing, five ignored); rebuilt normal-mode R98 passes
  after this drop-order adjustment. All handles are terminal.
- Stop implementation is now present, with bounded verified job-member handles,
  pinned original transport and backend write reservation. A frontend Stop
  reservation retains terminal replies and releases input on failure. R100's real
  paused-supervisor case passes, preserving another pane's input and preventing
  queued user commands from leaking through after Stop.
- Transport is captured before user/profile commands run: the fixed Linux owner
  waits for authenticated ready/launch, while new `pty_ready` occurs only after
  the frontend receives the session ID and flushes early device replies with
  their classification. Blocking the spawn response until launch delayed cursor
  replies into shell text; the separate attachment/launch phase resolves that.
- Windows programs must end before Linux interop relays. Reversing that order
  left Win32 key protocol text in Bash input even though programs were gone.
  Stop now verifies an interactive shell first, ends programs before their console
  hosts (bounded natural-exit grace), then remaining Linux programs. R99's original
  usability case passes; it now also checks a second Windows launch/Stop cycle.
  Temporary process diagnostics were removed. Current TypeScript checks, 353
  frontend tests and production build pass. Native and 12-case focused desktop
  validation are in progress; full/GUI/mutation acceptance remains outstanding.

- Final checkpoint acceptance: all **130 desktop scenarios pass** (13.1 minutes,
  no skips, failures or flaky results), including repeated Windows launch/Stop
  and fresh shell input. Six GUI-subsystem cases pass. Removing Windows Stop
  deliberately leaves `owned-child`; removing both input-reservation guards
  deliberately executes the forbidden command. Both assertions fail as intended;
  restored sources and both normal Stop cases pass. Strict Clippy, 199 native
  tests (five ignored), 353 frontend tests, both TypeScript checks, production
  bundle and diff whitespace checks pass. Final cleanup finds no isolated
  WebViews, WSL supervisors, fixture programs or lifetime files; all handles are
  terminal. Report/log: `.tools.local/checkpoint25-full-desktop.{json,log}`.
  This supersedes the historical in-progress notes above. Remaining full-goal
  work: WSL worktree/verification, recipes and scoped execution, real multi-call
  shell evidence, the privileged ownership decision, running-agent follow-ups
  and the final requirement audit. Resume from `docs/resume-handoff.md`.

### Twenty-sixth implementation checkpoint: WSL worktree foundation (integration pending)

- Fixed distro-side preview, create and details operations now use Linux Git and
  filesystem identities. Revalidate exact commit, source/shared-metadata and
  destination-parent device/inode identities; reject replaced paths and reserve
  the new directory exclusively. Preserve dirty source and partial failure state.
- The real disposable Linux/Git test covers creation/inspection and hostile
  repository programs. Removing the hook guard fails the forbidden-program
  assertion; restored bridge passes. Inspection matches symlink-as-text checkout
  without changing shared config. See [integration plan and test procedure](wsl-worktree-implementation.md).
- The durable task store, profile binding and UI still require integration; do
  not claim WSL worktree tasks or verification complete. Native records and UI
  capabilities remain unchanged. Final strict Clippy and 199 native tests pass
  (five ignored); all four rebuilt desktop checks pass (WSL project discovery,
  repeated interop Stop, Claude/Codex process presence). Log:
  `.tools.local/checkpoint26-focused-desktop.log`. Node syntax and diff whitespace
  checks pass. Checkpoint 25 remains the last full desktop-suite baseline.

### Twenty-seventh implementation checkpoint: integrated WSL worktrees (accepted)

- Add environment, exact profile launch hash and Linux shared-metadata identity
  to durable tasks, retaining native history compatibility. Pending previews keep
  source/parent identities. Save history before distro-side creation and preserve
  partial failures. Revalidate profiles before mutation/open and use fixed Linux
  operations for inspection; no native or default-distribution fallback.
- Worktree UI exposes WSL shells and environment labels. Agent requests use
  literal distro brief files in separate tabs, exact spawn configuration checks
  and fresh session/profile/repository validation at the prompt. Native automation
  grants remain native-only. Saved runs match environment and Linux case.
- Register R101–R103 before real desktop scenarios. Current 354 frontend tests,
  both TypeScript checks, production bundle, strict Clippy and 202 native tests
  (five ignored) pass, including native history migration and launch-configuration
  binding. Real WSL restart coverage exposed immediate data-operation rejection
  at four active operations. Bounded admission retains four active, allows up to
  sixteen waiting for at most five seconds, and never retries an executed
  mutation. Worktree creation revalidates the profile after admission; native
  concurrency checks cover release, expiry and queue capacity.
- All six focused worktree cases pass in the GUI subsystem and again after source
  restoration with the normal build. Deliberately removing profile binding,
  prompt validation and Linux history association makes each protected scenario
  fail its intended assertion. No mutations remain; cleanup found no isolated
  WebViews, Linux supervisors or fixture processes. Full **134-case acceptance
  passes** (14.5 minutes, zero skips/failures/flaky results); report/log:
  `.tools.local/checkpoint27-full-desktop.{json,log}`. Final cleanup also found no
  fixture programs or lifetime files. All handles are terminal and diff whitespace
  checks pass. Remaining: WSL verification, recipes and scoped execution,
  multi-call shell runtime evidence, privileged ownership decision, structured
  follow-ups to running agents and the full requirement audit.

### Twenty-eighth implementation checkpoint: Linux verification primitives

- Add bounded Linux repository snapshots (bytes/index/HEAD/mode and repository
  identity) plus persistent-in-scope inotify coverage of directories, source
  inodes and shared Git metadata. Observed edits remain invalid after restoration;
  watcher errors/overflow never produce unchanged evidence. Pinned/no-follow
  source opens reject symlinks/FIFOs/submodules. Ignore ordinary build output,
  including common temporary output directories removed before completion.
- Send fixed bundled helper source and request separately through a bounded
  stdin envelope, avoiding Windows argv limits and preserving Unicode. No IPC
  caller can supply Python code. Monitor FFI loads only when monitoring is used.
- Nine real Linux cases pass, including actual kernel overflow and descriptor
  cleanup. Three deliberate breaks (hashing, inode watches, overflow handling)
  each fail their intended assertion. Four Node checks pass, including existing
  worktrees, Unicode snapshots and envelope bounds. All 41 existing WSL desktop
  cases pass (4.7 minutes), three GUI cases pass and final source passes all Linux
  checks plus three rebuilt desktop cases. Strict Clippy and 202 native tests
  pass (five ignored). No user-facing WSL verification action is enabled yet.
- Next: trusted filesystem coverage (host/remote edits cannot rely solely on
  Linux inotify), Windows-owned authenticated monitor lifetime, environment-bound
  tickets/recording/refresh and prompt/session/profile validation, then real
  desktop verification scenarios. See [implementation plan](wsl-verification-implementation.md).

### Twenty-ninth implementation checkpoint: owned Linux verification backend (verified)

- Enforce local filesystem coverage through actual descriptor mount IDs and
  device identities. Real Windows-mounted source/shared-metadata fixtures cannot
  acquire Linux-only coverage; readonly snapshots remain separate from proof.
- Add an immutable Windows-owned monitor lifetime, fixed-context authenticated
  same-user requests, freshness/response proofs and bounded I/O. Lifetime removal
  or replacement interrupts the monitor and releases its watches. A fresh
  isolated Git launcher applies output limits without thread-unsafe preexec code.
- Add environment/cwd/profile-bound backend tickets and PTY startup authorization.
  Results need matching authorized pane/profile/environment/command/folder.
  Compare caches use environment plus root; restored records start unknown.
  Native history/verification retain their existing paths. UI WSL tracking is
  still disabled until prompt, map and cancellation integration is complete.
- Linux repository/monitor and real 9p cases pass; strict Clippy/default 202 native
  tests pass (eight ignored). Two opt-in native ownership/record/crash scenarios
  passed, plus their child fixture. Four deliberate regressions fail their intended
  assertions (filesystem coverage, request authentication, Windows lifetime,
  environment cache isolation). Sources restored; all Linux/native checks, five
  GUI scenarios and all 50 affected desktop scenarios pass (6.3 minutes). Final
  cleanup finds no isolated app/WebView, supervisor, helper/fixture process,
  lifetime file or verification fixture directory. Frontend TypeScript and 354
  frontend tests pass. All handles are terminal. Next: frontend ticket/startup/
  cancellation wiring and real WSL verification command scenarios; this does not
  complete WSL verification or the broader goal.

### Thirtieth implementation checkpoint: WSL verification UI (focused checks verified)

- Enable reviewed WSL checks with original profile/environment, canonical folder,
  frozen profile hash and actual session authorization at the empty prompt. Keep
  ticket attribution only for the exact reviewed command; cancel on close/startup
  failure or an intervening different command. Preview the environment.
- Scope latest-run deduplication by environment as well as command/folder/profile,
  with a regression test for identical spellings across native and Linux contexts.
- R104–R106 real desktop cases prove matching evidence through restart, ignored
  build output, source-edit staleness, edit/restore during a check and changed
  startup-profile rejection without losing interactive shell use. Deliberate
  missing-ticket and missing-profile-check mutations fail their intended assertions.
  All sources restored; three GUI and seven focused normal desktop cases pass.
  Both TypeScript checks, 355 frontend tests, production bundle and whitespace
  checks pass. No isolated app/WebViews, bundled helper processes, lifetime files
  or launch fixtures remain. Logs/script are in `.tools.local/checkpoint30-*` and
  `.tools.local/verify-checkpoint30-ui.mjs`; all handles are terminal.
- Remaining verification acceptance: real UI cancellation, watcher loss,
  unsupported mounts, unavailable distribution/scope guards and direct crash,
  followed by broader regression coverage. WSL recipes/scoped grants, multi-call
  runtime proof, privileged ownership decision, running-agent follow-ups and the
  final requirement audit remain open. The full goal remains unfinished.

### Thirty-first implementation checkpoint: WSL verification accepted

- Register R107–R112 before real desktop cases for pending-pane close, direct
  qterm crash, monitor loss before/during execution, nonzero shell exit, actual
  Windows-mounted source/shared metadata, unavailable replacement distribution
  and case-sensitive startup folders. OS assertions identify fixture-owned
  monitor processes by birth identity, bundled argv and real inotify watches;
  PID descriptors guard signals and forced cleanup follows acceptance assertions.
- Reproduce a monitor leak after nonzero shell exit. Cancel the verification
  ticket on every shell exit while preserving the visible error pane.
- Catch seven deliberate failures: cancellation, crash lifetime, authorization,
  lost-monitor matches, filesystem guard, native fallback and case-folded folders.
  All sources restored; twelve verification GUI cases and **all 146 desktop
  cases** pass (15.3 minutes, zero skipped/failed/flaky cases or report errors).
  Both TypeScript checks, 355 frontend tests and production bundling pass. Logs:
  `.tools.local/checkpoint31-*.log`; full report:
  `.tools.local/checkpoint31-full-desktop.json`. All handles are terminal.
  Cleanup finds no isolated app/WebViews, bundled helpers, lifetimes or launch/
  mount fixture directories. This accepts WSL verification within its documented
  coverage limits; Windows-mounted/remote filesystems cannot acquire Linux-only
  proof. No installed app, live provider configuration, release or model call
  changed.
- Next: [WSL recipes and scoped task grants](wsl-workflows-implementation.md).
  Multi-call runtime proof, the privileged ownership decision, running-agent
  follow-ups and the final requirement audit remain open. Full goal unfinished.

### Thirty-second implementation checkpoint: Linux workflow-source foundation

- Add fixed bounded distro-side source/directory reads and revalidation, bundled
  through the existing stdin transport. Preserve exact bytes, canonical Linux
  paths and source/project/step identities. Reject source replacement, modified
  definitions, escaping aliases and special files without executing project code.
- Nine real Linux cases, two Node integration cases and an opt-in Rust production
  transport/TOML case pass. Three deliberate identity/digest/containment breaks
  fail their intended assertions. Sources restored; strict Clippy, 202 native
  tests (nine ignored), three GUI and four focused desktop cases pass. Script/logs:
  `.tools.local/verify-checkpoint32-workflows.mjs`, `.tools.local/checkpoint32-*.log`.
  All handles are terminal; exact restoration and fixture/process cleanup pass.
- WSL recipe policy/runtime/UI and scoped grants are still open. Continue with
  [the integration plan](wsl-workflows-implementation.md), avoiding WSL I/O under
  Store locks and Windows interpretation of Linux relative paths. Checkpoint 31
  remains the last full desktop acceptance. Full goal remains unfinished.

### Thirty-third implementation checkpoint: WSL recipes accepted

- Integrate typed Linux source/directory identities into recipe review and
  runtime. Retain environment and exact launch configuration through scheduling,
  readiness, recording and Stop. Native private profile keys remain private;
  WSL spawn uses a separate launch hash. Revalidate current configuration around
  slow operations and immediately before submission. Evidence failures remain
  warnings while independent command-launch authorization stays mandatory.
- Move start validation and distro Stop I/O outside Store locks. Recheck review
  cancellation/expiry/bindings/capacity on commit. Preserve input reservations
  across React commits; cancel on failure/shell exit. Apply Linux path semantics
  to both recipe parsing and WSL project settings; native grants stay native-only.
- R113–R116 prove dependency order, `..\literal` as a Linux filename, evidence/
  requester/environment retention, changed definitions/profiles, readiness,
  cancellation/timeout/Stop and restart during active work without replay.
  Eight deliberate negatives fail their intended assertions. All sources restored;
  nine GUI and **all 153 desktop cases pass** (16.8 minutes, zero failed/skipped/
  flaky cases or report errors), plus strict Clippy, 204 native tests (nine
  ignored), 355 frontend tests, both TypeScript checks and production bundling.
  Logs/report: `.tools.local/checkpoint33-*.log` and
  `.tools.local/checkpoint33-full-desktop.json`. All handles are terminal; no test
  app/WebViews, Linux supervisors/helpers/fixture programs, lifetimes or launch
  directories remain. No installed app/live data/release/model call changed.
- Next: WSL project read/named-task grants and actual Linux client access in
  [steps 4–6 of the integration plan](wsl-workflows-implementation.md). Multi-call
  runtime proof, privileged ownership decision, running-agent follow-ups and the
  final requirement audit remain open. Full goal unfinished.

### Thirty-fourth implementation checkpoint: Linux named-task source foundation

- Factor the existing task-format and package-manager selection logic from native
  filesystem access. Add fixed Linux project/directory/manifest fact reads with
  UID, filesystem/Git identities, component-aware containment, regular-file and
  1 MiB bounds, and expected-source digest checks. Transfer raw manifests with
  bounded base64 rather than lossy text or oversized JSON byte arrays.
- Nine Linux cases and the actual Rust production transport/shared-parser case
  pass, including all supported task-format families and an exact 1 MiB binary
  manifest round trip. Three deliberate identity/digest/containment failures are
  caught. Sources restored; strict Clippy, 204 native tests (ten ignored), four
  GUI and six focused desktop checks pass. Script/logs:
  `.tools.local/verify-checkpoint34-task-sources.mjs`, `.tools.local/checkpoint34-*.log`.
  All handles are terminal; exact restoration and cleanup pass with no isolated
  app/WebViews, Linux supervisors/helpers/fixture programs, lifetimes or fixtures.
- No WSL grant authority is enabled. Integrate explicit environment-bound grant
  and task policy, Access UI, request/claim/launch/results/Stop and actual Linux
  client access next. Native grants stay native-only. Checkpoint 33 remains the
  last full desktop baseline; full goal remains unfinished.

### Thirty-fifth implementation checkpoint: environment-bound grant foundation

- Add typed native/Linux project scopes and Linux task-policy discovery with
  private filesystem/user/Git identities, explicit distribution, bounded source
  bytes, ancestor manager selection and current definition revalidation. Validate
  a selected task set with one rediscovery. Access read filtering now checks
  environment and shell kind before canonical containment, using batched Linux
  path checks outside locks; pane publication retains its captured environment.
- Grant creation validates a cloned pending review outside the mutex, then checks
  cancellation, expiry and single-use ownership at commit. Two deliberate missing
  environment/cancellation guards fail their intended assertions. Exact sources
  restored; real Linux policy/pipe checks, 205 native tests, strict Clippy, 355
  frontend tests, app TypeScript and four focused desktop cases pass. Script
  `.tools.local/verify-checkpoint35-policy.mjs` and desktop sessions are terminal.
- WSL grants remain unavailable in UI/IPC and execution is explicitly rejected at
  grant/launch. Next integrate environment-bound queue records, dynamic profile/
  session checks, launch/evidence/Stop and frontend startup, then explicit Access
  selection, real Linux CLI invocation and GUI acceptance. The 153-case checkpoint
  33 suite remains the last full desktop run. Full goal remains unfinished.

### Thirty-sixth implementation checkpoint: Linux named-task runtime and client route

- Carry reviewed environment and exact shell binding through queue, claim,
  launch, evidence, result attribution, status and Stop. Recheck live configuration
  around distro operations and at submission; retain independent launch policy
  checks after evidence failure. WSL results require matching environment/kind/cwd;
  native results reject WSL or foreign environments. Stop uses the original full
  pane/key binding outside Access/Queue locks for distro work.
- Access exposes explicit Windows/WSL environment selection, matching execution
  profiles, original environment in review/grants and a captured WSL spawn hash.
  R117 uses actual Linux-to-Windows executable/pipe interop with provider indexing
  disabled, runs a real Python project entry point once in its new Linux pane and
  retains requester/environment/repository evidence across restart without replay.
  CLI docs explain Windows connection-path spelling and executable translation.
- The intended missing-requester mutation fails its attribution assertion. Exact
  source restored; five desktop cases (1.3 minutes), 205 native tests, strict Clippy,
  355 frontend tests, app/focused E2E TypeScript and production bundling pass. Review
  screenshot inspected; no supervisors/fixture programs/data or verification
  helpers remain. Script `.tools.local/verify-checkpoint36-task-runtime.mjs`
  session 24007 is terminal and successful. Logs: `.tools.local/checkpoint36-*.log`.
- Full WSL grant acceptance still requires dedicated Linux isolation, changed/
  delayed definition/profile/folder, concurrent retry, revocation, Stop and startup
  failure coverage plus broader/full regression. Checkpoint 33 remains the last
  full 153-case run. Privileged supervisor approval remains pending separately;
  running-agent follow-ups, multi-call shell proof and final audit remain open.

### Thirty-seventh implementation checkpoint: Linux grant scope, revocation and Stop

- R118 uses real differently cased Linux projects and an escaping symlink. The
  read grant excludes outside panes and command captures, cannot execute tasks,
  and rejects direct result requests for outside IDs obtained through a second
  explicit grant. Earlier commands started inside the project remain readable
  after their pane moves; scope follows captured command-start cwd.
- R119 rejects changed Linux manifests and cancels a granted task while its actual
  Bash startup waits for input. Releasing the shell after revocation executes no
  task and leaves a usable prompt. R120 observes exact PID birth, stops the Linux
  task, preserves its requesting source program and retains the task shell.
- Deliberate missing containment/definition/Stop guards fail their intended
  desktop assertions. Exact sources restored; seven Linux/native desktop cases
  pass (1.9 minutes), 205 native tests and strict Clippy pass, and focused E2E
  TypeScript passes. Cleanup finds zero supervisors, fixture programs, fixture
  environment processes or data/verification helpers. Script
  `.tools.local/verify-checkpoint37-agent-guards.mjs` session 70528 is terminal;
  logs are `.tools.local/checkpoint37-*.log`. No installed app/live data/model call
  changed. Remaining Linux grant coverage includes delayed profile/folder changes,
  concurrent retries, failed startup, unavailable distributions and full regression.
  Full goal stays active with the other recorded remaining requirements.

### Thirty-eighth implementation checkpoint: delayed Linux launch and failed-shell cleanup

- R121 changes the actual profile, distribution or task-directory identity while
  Linux startup waits on a real FIFO. Releasing startup rejects the changed context
  without execution. R122 uses parallel Linux CLI processes with duplicate stable
  request IDs, proving one invocation/pane per intended task and retained source
  process/requester. Task input reservation remains enabled throughout these tests.
- R123 exposed a failed shell that stayed visible while its pending invocation
  incorrectly remained `launching`. The pre-fix test fails its cancellation check.
  `App.onExit` now clears the unfinished task's reservation and startup input,
  reports its failure and retains the visible nonzero-exit pane; retries return the
  same cancelled invocation without replay.
- Three deliberate profile/identity/idempotency breaks fail their intended
  assertions. Exact source restored; 14 Linux/native desktop cases pass (3.7 minutes),
  including all new launch cases and native concurrency/pending-close regressions.
  All 205 native tests, strict Clippy, 355 frontend tests, both focused/app TypeScript
  checks and production bundling pass. Script
  `.tools.local/verify-checkpoint38-launch-guards.mjs` session 90117 is terminal.
  Logs: `.tools.local/checkpoint38-*.log`. Full desktop regression/report audit and
  cleanup are running next; checkpoint 33 remains the last accepted full baseline.
  The full goal retains the other recorded lifecycle/follow-up/audit requirements.

### Thirty-ninth implementation checkpoint: full WSL grants and real multi-call evidence

- Accept all 162 full desktop cases (21.4 minutes), no failures/skips/flaky cases
  or reporter errors. Source restoration and cleanup pass; session 8097 is terminal.
  The [scoped-grant requirement audit](wsl-scoped-grants-audit.md) maps steps 4–6
  to actual implementation and tests. Checkpoint 38 is the current full baseline.
- Download/extract a verified official Ubuntu BusyBox static package as UID 1000
  into ignored workspace storage, retaining metadata/copyright. Three real Linux
  tests cover twelve live invocation variants, actual process images/arguments,
  physical alias declarations, production unregistered-image probes and real stdin.
  System shell configuration is unchanged. Both declaration/invocation breaks
  fail; exact ownership source restored and no runtime/acquisition fixtures or
  processes remain. [Runtime scope and evidence](wsl-shell-runtime-validation.md).
- Prepare the [managed follow-up proposal](running-agent-followups-proposal.md)
  using fetched official Codex App Server documentation. Ask the user to decide
  managed agent UI versus explicitly deferring automatic running-agent follow-ups,
  and approve/reject the fixed root-supervisor proposal. Both remain pending; no
  privileged process, provider server/model call or live provider data change is
  authorized by silence. The final whole-goal requirement audit remains open.

### Fortieth implementation checkpoint: whole-goal evidence audit

- [The completion audit](goal-completion-audit.md) checks every numbered phase
  and additional user instruction against current source and actual test behavior.
  `.tools.local/audit-goal-report.mjs` verifies required spec results in the accepted
  162-case report and writes a SHA-256-bound requirements mapping. Native index
  benchmark logs, persistence queue/revision/clear ordering, status/probe provenance,
  inbox semantics and the implemented task/library/workflow boundaries were read.
- The delivered portions are evidenced; the full goal remains unachieved because
  structured running-agent delivery and privileged Linux cleanup are not implemented.
  Their user decisions remain pending. Optional MCP/App Server experiments retain
  their original optional status. No deferral or approval is inferred from silence.
- Correct the diagnostic adapter documentation's stale WSL-link limitation. No
  production code changes or redundant full-suite rerun were made. Checkpoint 38
  remains the accepted full baseline; completion requires another requirement audit
  after the decisions and resulting work.

### Final agreed-scope acceptance, 5 November 2026

The user deferred managed sessions/automatic running-agent follow-ups (“1 defer”)
and clarified acceptance of unprivileged Linux cleanup (“limits”). No root
supervisor is approved or implemented. The final completion audit and report
mapping reflect these explicit scope decisions; no required implementation remains
for this delivery. Report/restoration/cleanup checks pass against all 162 desktop
cases, with zero failures/skips/flaky cases or report errors. Earlier accepted
gates remain 205 native tests, 355 frontend tests, strict Clippy, TypeScript and
production bundling. Changes remain in the workspace; no installed-app update,
release, live provider data/config change or model call was performed.
