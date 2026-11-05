# Resume handoff — 5 November 2026

The user-agreed delivery requirements are satisfied after the final scope decisions
and evidence audit. Check the actual goal status for the completion transition.
Do not restart the review or discard the worktree. Prior implementation is saved
in commit `bec702d` (the worktree was
clean at resumption); checkpoint 20–40 runtime/tests and documentation updates are
uncommitted. Preserve all these changes.
No installed qterm, live provider configuration, release or model call changed.

## Current checkpoint

Final decision: the user clarified “limits,” accepting unprivileged Linux cleanup.
Managed sessions and automatic running-agent delivery were explicitly deferred
with “1 defer.” No root supervisor is approved or implemented. These decisions
resolve the two earlier blockers for the agreed delivery; they do not turn the
omitted capabilities into implemented ones. `docs/goal-completion-audit.md` and
the report mapping reflect that final scope. Final report/restoration/cleanup
checks pass: 162 expected results, no failures/skips/flaky cases/report errors,
exact restored sources, and no launch/BusyBox runtime fixtures or processes.
There is no new production code change after
the accepted 162-case baseline; the installed app and live provider data remain
untouched. Future root or managed-session work requires separate authorization.

User decision update, 5 November 2026: “1 defer, 2 accept.” Record “1 defer” as
explicit deferral of managed agent sessions and automatic running-agent delivery.
Keep normal CLI/new/idle-shell handoffs as implemented; do not implement the
deferred feature or count it as implemented. A single async clarification asks
whether “2 accept” approves the fixed root supervisor or accepts unprivileged
cleanup limits. Do not infer either option, start root work or mark the goal
complete before that answer. No new code/test run is needed for this documentation
update. The earlier blocker history below is historical; no new blocker status
transition was requested for this reply.

Blocking audit (checkpoint 41): the same managed-session and privileged-supervisor
decisions remain unanswered across checkpoints 39–41. Current source and the
whole-goal audit were rechecked. No managed delivery or root supervisor exists;
the only `--user root` source occurrence is a rejection test. No independent
required implementation remains available without these decisions. The goal is
being marked blocked through the goal tool, preserving the full unfinished scope.
Resume with the user's answers; do not reinterpret an automatic continuation as
approval, defer requirements silently, repeat completed suites or invent optional
work to keep the loop running. Accepted evidence and all worktree changes remain.

Checkpoint 40 performs the whole-goal audit against the active objective,
numbered implementation plan, current source and actual accepted test report.
`docs/goal-completion-audit.md` maps every numbered item and the additional user
instructions to implementation, evidence and explicit limits. The report mapping
script `.tools.local/audit-goal-report.mjs` checks required spec results and writes
`.tools.local/goal-requirements-report.json` with the full report's SHA-256.
The generated mapping passes: all 162 desktop results are passing, with each
required native/WSL spec present. The audit also inspects actual assertions and
source; report counts alone are not treated as proof. The native index benchmark
raw log and persistence/output revision/clear ordering were inspected separately.

The whole goal is **unachieved**, with two outstanding implementation requirements:
structured delivery to running provider sessions, and privileged Linux descendant
cleanup. Both user decisions remain pending from checkpoint 39. No root or managed
runtime work was authorized by an automatic goal continuation. MCP and the separate
App Server experiment remain explicitly optional as originally planned; neither
is falsely marked implemented. A managed follow-up choice would require the
provider/version feasibility work in its proposal.

Diagnostic documentation was corrected to reflect implemented WSL file resolution.
There are no new production code changes, active processes or new test failures in
this audit checkpoint. The accepted full baseline remains checkpoint 38: 162
desktop, 205 native, 355 frontend tests plus Clippy/TypeScript/build; all earlier
runtime mutation sources remain restored. Do not rerun that suite without a new
change or unresolved concern. Completion must be re-audited after the decisions
and any resulting implementation. Goal stays active; no approval is inferred.

### Previous full-suite/runtime checkpoint

Checkpoint 39 accepts the completed checkpoint 38 full suite and adds actual
BusyBox runtime evidence. All 162 desktop tests pass (21.4 minutes), with zero
failed/skipped/flaky cases or report errors. Full exec **8097** is terminal;
report/restoration/cleanup checks pass. No desktop runner remains active.
The scoped-grant requirement audit is `docs/wsl-scoped-grants-audit.md`.

An official Ubuntu static BusyBox package was downloaded/extracted as UID 1000
to ignored `.tools.local/busybox-runtime/`, checked against indexed SHA-256 and
retained with metadata/copyright. No package install or root operation occurred.
Three real Linux tests cover twelve live applet/invocation variants, actual
kernel executable/argv inspection, production unregistered-image probes and
working stdin after refused Stop. Physical fixture aliases supply the classifier's
declared-name argument; Ubuntu's actual system shell registry is unchanged.
See `docs/wsl-shell-runtime-validation.md` for scope/provenance/reproduction.
Both deliberate declaration/invocation breaks fail; exact `wsl_owner.py`
restoration, all restored runtime checks and empty fixture/process cleanup pass.
All handles are terminal. Logs: `.tools.local/checkpoint39-*.log`.

Two user decisions were presented together through async input and remain pending:
opt-in managed agent sessions for structured running-agent follow-ups (versus an
explicit deferral), and the previously pending fixed root-supervisor proposal
(versus accepting user-level cleanup limitations). No answer means no approval.
`docs/running-agent-followups-proposal.md` records the concrete design, supported
Codex protocol documentation and need for a version-specific isolated feasibility
check. The OpenAI Docs skill was read and used; official App Server docs were
fetched. No Codex CLI was found on this tool session's PATH. No server/model call,
live provider config/transcript operation or managed agent implementation occurred.

Continue with the overall requirement audit and independent authorized work while
awaiting those decisions. Do not start root processes or silently replace the
running-agent feature with manual copy. Full goal remains active and unfinished.

### Previous delayed-launch checkpoint

Checkpoint 38 adds R121–R123 for delayed Linux profile/distribution/folder changes,
concurrent real Linux client retries and failed startup. Tests wait for actual
claimed pane IDs and use a real FIFO to release shell startup while preserving
task input reservation. The original delayed profile, unavailable replacement
distribution and directory-identity cases pass. Concurrent retries produce one
invocation/pane per intended request and preserve the requesting source process.

R123 exposed a real bug: after nonzero exit before the first prompt, the visible
shell stayed on screen but the invocation remained `launching`. The pre-fix
test fails the intended `cancelled` assertion in
`.tools.local/checkpoint38-before-exit-fix.log`. `App.onExit` now clears the task
reservation/startup input and reports failure for that invocation, retaining the
visible failed shell and stable request ID without replay. App/focused E2E
TypeScript, all 355 frontend tests and production bundling pass.

Script `.tools.local/verify-checkpoint38-launch-guards.mjs` session **90117** is
terminal and successful. Intended missing profile, directory/manifest identity
and idempotency guards each fail their target assertions. Exact `agent_tasks.rs`
restoration is verified; 14 Linux/native desktop cases pass (3.7 minutes), including
the shell-exit fix and native concurrent/pending-close regressions. All 205 native
tests (11 ignored) and strict Clippy pass. Logs: `.tools.local/checkpoint38-*.log`.

The full desktop suite is accepted: session **8097** is terminal and successful,
all **162 cases pass** (21.4 minutes) with zero failed/skipped/flaky tests or report
errors. `.tools.local/check-checkpoint38.mjs` verifies the JSON report, exact
checkpoint 37/38 mutation-source restoration and zero launch fixture directories.
Cleanup also finds zero Linux supervisors, fixture programs/environment processes
or bundled data/verification helpers. Report/log:
`.tools.local/checkpoint38-full-desktop.{json,log}`. No runner remains active.

Next: requirement-level WSL grant audit and real multi-call shell runtime proof.
Full goal also retains the pending privileged-supervisor decision, running-agent
follow-ups and the final requirement audit. Checkpoint 38 (162 cases) is now the
last accepted full desktop baseline. No root operation has been approved.

### Previous Linux grant scope/Stop checkpoint

Checkpoint 37 adds real Linux grant acceptance for R118–R120. Read-only scope
uses actual `Case`/`case` projects and a symlink escaping the granted root, keeps
historical commands that started inside the project, excludes commands started
outside, and denies execution. A second explicit grant supplies real outside
command IDs so the original grant must also reject direct result requests.
Manifest drift rejects a task request; revocation during a real Bash startup read
cancels the pending invocation and leaves the shell usable without execution.
Stop observes exact PID birth, ends the original Linux task, preserves the source
program and leaves the task shell usable. Fixture entry points are real Python
programs; no installed runners, provider calls or live data are used.

The initial manifest/revocation, task-run and Stop cases pass; corrected read
scope also passes. Scope assertions respect command-start cwd: moving a pane
must not remove read authority for its earlier project records. New risk rows
were registered before specs and focused E2E TypeScript passes.
Script `.tools.local/verify-checkpoint37-agent-guards.mjs` session **70528** is
terminal and successful: all three containment/manifest/Stop breaks fail their
intended assertions; exact sources are restored. Seven Linux/native desktop cases
pass (1.9 minutes), as do 205 native tests (11 ignored), strict Clippy and the final
focused E2E TypeScript check. Cleanup reports zero supervisors, fixture programs,
fixture-environment processes or bundled data/verification helpers. No runtime
mutation remains. Logs: `.tools.local/checkpoint37-*.log`.

Remaining WSL grant acceptance: delayed profile/folder changes, concurrent retry,
failed startup, unavailable distributions and broader/full regression. Full goal
also retains multi-call shell runtime proof, the pending privileged-supervisor
decision, running-agent follow-ups and the final requirement audit. Last full
desktop baseline remains checkpoint 33 (153 cases). Do not mark the goal complete.

### Previous named-task runtime checkpoint

Checkpoint 36 connects Linux named-task execution through queue, claim, actual
shell binding, reviewed folder/source/profile validation, evidence and submission.
Invocations retain environment and a private exact shell key; WSL spawn also gets
its optional launch hash. Native keys stay private. Native results reject WSL or
foreign environments; Linux task results require matching environment/kind/cwd
before attribution. `tasks.status` checks project and invocation environment.
Stop checks the original full pane/key binding and performs distro I/O outside
Access/Queue locks. Live configuration is checked around slow launch operations
and immediately before writing. Evidence failures remain warnings while fresh
launch policy remains mandatory.

Access now offers explicit environment selection and filters execution profiles
to that environment. The frontend captures current profile, environment/kind
and WSL launch key for prompt-gated new task panes. IPC defaults omitted
environment to native for existing clients, without a Linux fallback. The Linux
grant/launch rejection guards from checkpoint 35 have been replaced by the typed
runtime policy; WSL grants are available in the development build.

New R117 drives the actual Linux-to-Windows executable/pipe route with provider
indexing disabled. A real Python project entry point runs once in a separate WSL
pane, retains requester/environment/repository evidence, returns the same invocation
on retry and survives restart as a saved result without replay. Initial R117 and
both native task execution/definition/revocation desktop cases pass (1.1 minutes).
App and focused E2E TypeScript, production bundling, 355 frontend tests and strict
Clippy pass. Script `.tools.local/verify-checkpoint36-task-runtime.mjs` session
**24007** is terminal and successful: the missing-requester mutation fails its
intended attribution assertion; exact source restoration, five restored desktop
cases (1.3 minutes), 205 native tests and strict Clippy pass. The R117 review
screenshot was inspected; environment, canonical folder and separate read/task
consents are visible. Cleanup reports zero supervisors, fixture programs or
bundled data/verification helpers. Logs: `.tools.local/checkpoint36-*.log`.

**Not full WSL grant acceptance yet.** Add dedicated Linux GUI cases for read-only/
environment/project isolation, changed manifests/manager/profile/folder identities,
revocation while waiting, concurrent idempotent retries, Stop and failed startup.
Prove each new risk with a deliberate break, then run the broader/full desktop
suite and cleanup. Last full desktop baseline remains checkpoint 33 (153 cases).
The privileged supervisor proposal remains pending; running-agent follow-ups,
multi-call shell proof and final requirement audit remain open. Full goal active.

### Previous accepted environment-bound grant foundation

Checkpoint 35 connects the typed Linux task reader to environment-bound grant
policy and the Access backend. `agent_scope::Scope` captures native or explicit
distribution/project identity. Linux reads require matching environment and WSL
kind before batched canonical containment checks; native grants never read WSL
records. Pane observations now publish their captured environment. Project/user/
Git identities are revalidated outside Access locks before and after requests.

`wsl_tasks::Project` discovers nearest task definitions, shares native parsers,
reads ancestor package-manager locks without reading unrelated parent manifests,
checks transported bytes against their length/digest, and retains private source/
directory identities for policy. Review validates the complete task set with one
rediscovery rather than rediscovering separately for every task. Lock content
updates with the same manager remain valid; changed selection or identical-byte
manifest replacement invalidate the policy. Read-only empty task lists remain
empty. No raw manifest bytes are retained in the grant policy.

Grant creation now clones its pending review, validates outside the mutex, and
rechecks cancellation, expiry and single-use ownership at commit. Failed review
validation does not consume the review. **WSL grants are still unavailable in the
UI/IPC and Linux execution remains explicitly rejected at grant and launch.**
Do not remove those guards until queue/claim/launch/result/Stop and frontend
startup all retain their original environment, exact profile and session binding.
`tasks.status` still treats queue invocations as native; add invocation environment
before enabling Linux tasks. Commands still call the native review wrapper.

Current checks: 205 default native tests (11 ignored) and 355 frontend tests pass,
as does app TypeScript checking. The real opt-in Linux policy/pipe case passes
including matching/foreign/native/escaping panes and command results, ancestor
manager selection, changed source identity, lock-content updates and credential
revocation. Four focused desktop cases pass (native read/task grants, definition/
revocation and WSL recipe ordering), 1.5 minutes. Last full desktop suite remains
the 153-case checkpoint 33 baseline. Script
`.tools.local/verify-checkpoint35-policy.mjs` session **60224** is terminal and
successful: both deliberate environment/cancellation breaks fail their intended
assertions; the restored real Linux case, 205 native tests and strict Clippy pass.
Exact source restoration is verified. Desktop session **89957** is also terminal
and successful. Logs: `.tools.local/checkpoint35-*.log`.

Next: finish environment-bound queue records, actual WSL launch/evidence/Stop,
dynamic configuration revalidation and pane startup; then expose explicit Access
environment selection and prove the actual Linux CLI route plus GUI isolation,
revocation and task execution. No root approval is needed for this integration.
The privileged supervisor proposal remains pending separately. Full goal unfinished.

### Previous accepted task-source foundation

Checkpoint 34 verifies the named-task source foundation. `project::tasks_from_sources`
shares the existing package/Cargo/Make/Just/Composer/Python parsers across readers;
package-manager declaration, lock precedence and legacy Bun selection also share
one implementation. Native discovery still uses the original Windows reads.

New fixed `wsl_task_sources.py` is bundled into the actual Rust WSL transport.
`task_project` captures canonical root/directory, UID and root/shared-Git identities;
`task_directory` returns fixed-name manifest facts, lock presence and the scoped
parent; `task_source` returns an expected-identity/digest-checked manifest as base64.
Reads stay inside the selected project, revalidate root/user/directory before and
after I/O, bound manifests to 1 MiB and reject special-file byte reads. Locks are
presence/selection inputs, not content hashes: ordinary lockfile content updates
must not alone revoke a task whose command selection is unchanged. Oversized
regular files retain presence facts but cannot be read for execution review.

Nine actual Linux checks pass. A new opt-in Rust case uses the production bundle
and shared parsers across all supported task-format families; a full 1 MiB binary
Cargo source survives the real transport exactly. Strict Clippy and 204 default
native tests pass (ten ignored now); native sessions **76423** and **79421** are
terminal. Script `.tools.local/verify-checkpoint34-task-sources.mjs` **21079** is
terminal and successful: identity/digest/containment breaks each fail their
intended assertions; restored Linux checks, four GUI and six focused desktop
cases pass. Logs: `.tools.local/checkpoint34-*.log`. Exact source restoration and
cleanup pass: zero isolated app/WebViews, supervisors/helpers/fixture programs,
lifetime files or task-source/test/launch directories. No mutation remains.

WSL grants remain unavailable. Next, connect the source facts/shared parser to
typed environment-bound grant and selected-task policy, then Access UI, claim/
launch/result/Stop paths and the actual Linux CLI route. A grant must retain its
explicit distribution alongside these private filesystem facts; never infer it
from matching paths/UIDs or permit WSL through a native grant. Discover nearest
task directories and ancestor lock choices up to the captured Git root, preserve
the existing 200-task limit, and recheck selected manifests plus currently resolved
commands before request/claim/launch. No WSL I/O under Access/Queue locks. Read
panes/results must require captured environment and kind, with Linux case/component
scope. Checkpoint 33 remains the full 153-case baseline. Full goal unfinished.

### Previous accepted recipe checkpoint

Checkpoint 33 is accepted: WSL recipes are wired through typed Linux source/
directory facts, review, dependency/readiness scheduling, exact-profile/session
startup, environment-bound records and scoped Stop. Native grants stay native-only.
Linux relative cwd validation is separate from Windows `Path` parsing; both recipe
review and the WSL project-settings view use it. The integration preserves native
private profile keys; WSL spawn uses a separate optional `launchKey` hash. Recipe
Store start validates outside its mutex and rechecks cancellation/expiry/capacity
at commit; Stop performs distro I/O outside the store lock. Failed shell exit
cancels workflow startup/evidence. Evidence failures are warnings, with fresh
launch-policy checks still mandatory. Actual configuration is rechecked before
and after slow launch operations and at submission.

R113–R116 focused cases pass: Linux `..\literal` cwd, dependency ordering,
environment/requester/evidence retention and no replay, changed definitions and
profiles, readiness/cancel/timeout/Stop, plus restart during an active workflow
with observed old-program exit. Native recipe-order regression also passes.
204 native tests pass (nine ignored), including new Linux path and responsive
cancellation tests. Final strict Clippy, both TypeScript checks, all 355 frontend
tests and production bundling pass.

Script `.tools.local/verify-checkpoint33-recipes.mjs` session **2624** is terminal
and successful. Backup sources: `.tools.local/checkpoint33-originals.json`;
exact restoration passes and no mutation remains. Eight deliberate phases catch mutex blocking, Windows
path semantics, native-result coercion, definition/profile guards, timeout,
Stop and restored-command replay. All eight fail their intended assertions.
Nine GUI cases pass (1.9 minutes).
All **153 desktop cases pass** (16.8 minutes, zero skipped/failed/flaky cases or
report errors). Logs/report: `.tools.local/checkpoint33-*.log` and
`.tools.local/checkpoint33-full-desktop.json`. All handles are terminal. Cleanup
finds zero isolated app/WebViews, Linux supervisors, bundled data/monitor helpers,
fixture programs, lifetime files or launch directories. No installed app/live
data/release/model call changed. This accepts WSL recipes; the full goal remains
unfinished. Next: environment-bound WSL project read/named-task grants and the
actual Linux CLI client route. Do not widen native grants merely by permitting
WSL shell kinds. Multi-call runtime proof, privileged ownership decision,
running-agent follow-ups and the final requirement audit remain open.

### Checkpoint 32 foundation

Checkpoint 32 verifies the Linux workflow-source foundation. New fixed bundled
`wsl_workflows.py` provides `workflow_source`, `workflow_directories` and
`workflow_validate` through the existing bounded stdin transport. It reads the
nearest `.qterm.toml` in Git or non-Git folders, preserves literal UTF-8 bytes and
Linux case, caps source at 256 KiB and directory lists at 256, and revalidates
source digest plus source/project/step device+inode identities. Descriptor-pinned
regular-file reads reject special files without blocking; canonical source and
step containment reject escaping symlinks. Internal aliases remain supported.

Nine real Linux checks and two Node integration cases pass. An opt-in Rust case
also calls the actual production bundle and parses its TOML through the existing
Rust validator. Strict Clippy and 202 native tests pass (nine ignored now); native
session **33526** is terminal, including the explicitly passing production-bundle
case. Script `.tools.local/verify-checkpoint32-workflows.mjs` session **88695** is
terminal and successful: identity, digest and containment mutations each fail
their intended assertion; all sources restored, Linux checks pass, three GUI
cases and four focused desktop cases pass. Logs:
`.tools.local/checkpoint32-{missing-filesystem-identities,missing-definition-digest,missing-folder-containment,restored-linux,workflow-bundle-gui,restored-desktop}.log`.
Exact source restoration passes. Cleanup finds zero isolated app/WebViews,
supervisors, helper/fixture programs, lifetime files or workflow/test/launch
directories. All handles are terminal and no mutation remains.

This does not enable WSL recipes or grants. Next, connect the helper to a typed
environment-bound recipe policy and the full scheduler/launch/readiness/Stop/UI
path in `docs/wsl-workflows-implementation.md`. Preserve native-only grant
authority until its separate policy is integrated. Do not hold recipe Store
locks across WSL I/O: `Store.start` currently validates every step while locked;
snapshot outside the lock and recheck cancellation/expiry/bindings/capacity on
commit. Keep Linux path validation separate from Windows `Path` parsing (the
helper preserves literal backslashes and Linux case). Checkpoint 31 remains the
last full 146-case desktop baseline; its UI/verification acceptance is complete.
Full goal remains active and unfinished.

### Previous accepted verification checkpoint

Checkpoint 31 is accepted. R107–R112 add real UI coverage for pending-pane
close, direct qterm crash, actual monitor loss before/during execution, failed
shell exit, Windows-mounted source/shared metadata, unavailable replacement
distribution and case-sensitive startup folders. The shell-exit case reproduced
a real leak: nonzero exit kept both the error pane and its pending monitor.
`App.onExit` now cancels the verification ticket on every shell exit while
preserving unsuccessful panes. All nine new cases passed in focused runs.

Validation script `.tools.local/verify-checkpoint31-boundaries.mjs` session
**84068** is terminal and successful. All mutation sources were restored. Original
sources are pinned in `.tools.local/checkpoint31-originals.json`. Seven deliberate
negatives caught missing cancellation, lost crash lifetime, skipped launch
authorization, lost-monitor matches, missing filesystem guard, native fallback on
environment mismatch and case-folded Linux folder checks. All twelve verification
GUI cases pass (1.4 minutes), both TypeScript checks pass, all 355 frontend tests
and production build pass. All **146 desktop cases pass** (15.3 minutes, zero
failures, skips, flaky cases or report errors). Full report/log:
`.tools.local/checkpoint31-full-desktop.{json,log}`. Exact original-source
comparison passes. Read-only cleanup finds zero isolated app/WebViews, bundled
data/monitor helpers, lifetime files, Linux launch or Windows mount fixtures.
All handles from this checkpoint are terminal; no mutation remains.
Session 29503 is terminal: its harness expected `Received: 2` instead of
`Received length: 2` after the mount tests failed correctly. Logs/source restoration
were checked, the harness text was corrected, and 84068 resumed at the next phase
without rerunning accepted negatives. R109's original failure is retained in
`.tools.local/checkpoint31-shell-exit-before.md`. Full goal still unfinished.
Next: WSL recipes and scoped task grants, following
`docs/wsl-workflows-implementation.md`; multi-call runtime proof, privileged
ownership decision, running-agent follow-ups and the final audit remain open.

### Checkpoint 30 baseline

Checkpoint 30 wires WSL verification into the UI. Preparation passes the recorded
profile/environment and retains the frozen launch context; the new pane uses
canonical cwd and expected profile hash. Prompt validation authorizes the actual
session before writing the reviewed command. Results retain their ticket only
for that exact command; a different command cancels pending startup and is saved
as an ordinary run. Close/startup failure cancels the ticket. The preview displays
environment. Latest-run filtering now includes environment, with a regression
case for identical command/folder/profile spellings across environments.

R104–R106 real desktop cases pass: Linux checks retain matching evidence across
restart and become stale after edits, ignored build output remains eligible,
edit/restore during a blocked check remains stale despite exit zero, and a profile
changed during Bash startup prevents execution while leaving the shell usable.
Two deliberate breaks fail their intended assertions: detached ticket attribution
and missing profile validation. All sources were restored; three GUI-subsystem
cases and seven focused normal desktop cases pass (1.3 minutes for the latter).
Script `.tools.local/verify-checkpoint30-ui.mjs` session **64983** is terminal.
Logs: `.tools.local/checkpoint30-{missing-ticket,missing-profile-guard,verification-gui,restored-desktop}.log`.
Both TypeScript checks, all 355 frontend tests, production bundling and whitespace
checks pass. No lasting Rust changes were introduced in this checkpoint.
Read-only cleanup confirms zero isolated app/WebViews, bundled Linux data/monitor
helpers, lifetime files or launch fixture directories. All other handles from this
turn are terminal. The initial sandbox-only desktop attempt failed on AppData
access; its exact pinned runner descendants were ended before the normally
approved rerun. No outstanding approval failure remains.

Still required before accepting the whole WSL verification workflow: real UI
cancellation/close, watcher-loss and direct-crash scenarios, unsupported mounts,
unavailable distro and scope guards, then broader regression validation. Existing
backend/native tests cover several of those boundaries but do not replace UI
acceptance. Checkpoint 27 remains the last complete desktop-suite baseline.
The full goal remains active and unfinished.

### Previous backend checkpoint

Checkpoint 29's monitor and backend tickets/records are verified; UI remains
disabled for WSL. `wsl_repository.py`
checks actual fd mount IDs/device identities and supports known local Linux
filesystems; actual 9p source and shared metadata cases are refused. New
`wsl_verification.py` keeps continuous coverage in a detached child owned by an
immutable Windows lifetime. Fixed same-user authenticated status/finish/cancel
requests retain nonce/expiry/context and reject forged responses. A lifetime
thread ends the service on owner removal/replacement, including during reads.
Repo Git limits now run through a fresh isolated launcher rather than Python
preexec callbacks after threads start.

`wsl_verification_monitor.rs` owns Windows lifetime/capacity and typed results.
Backend preparation freezes environment/cwd/profile; authorization checks actual
PTY launch binding and unchanged coverage before marking a pane authorized.
Recording requires that pane/profile/environment/command/folder and scopes
comparison caches by environment plus root. Ticket Drop cancels lifetime even
with in-flight validation. Restored evidence remains unknown until comparison.
The frontend still blocks WSL tracking until its prompt/map/cancellation wiring
and real desktop scenarios are implemented.

Current evidence: nine repository and eight monitor Linux tests plus real 9p
boundary checks pass. Strict Clippy and 202 default native tests pass (eight
ignored now: three new opt-in fixtures). Two real opt-in native scenarios passed
(plus their conditional child fixture): independent Windows lifetimes/backend
records and direct Windows process crash. Log:
`.tools.local/checkpoint29-native-monitor.log`. Native handles 70158/37504/33607/
11704 and Linux handle 34832 are terminal.
`.tools.local/verify-checkpoint29-monitor.mjs` **53571** finished successfully.
All four deliberate breaks fail their intended assertion: missing filesystem
guard, missing request authentication, lost Windows lifetime and collapsed
environment comparison keys. Sources are restored. Final Linux/native checks,
five GUI cases and all 50 affected desktop cases pass (6.3 minutes). Logs:
`.tools.local/checkpoint29-{missing-mount-guard,missing-request-auth,missing-windows-lifetime,collapsed-comparison-environments,restored-linux,restored-clippy,restored-native,restored-native-monitor,monitor-gui,restored-desktop}.log`.
All handles are terminal; no mutation remains. Final cleanup found zero isolated
WebViews, Linux supervisors, fixture programs, lifetime files and Linux/Windows
verification directories. The exact bundled-helper process check also found
zero remaining helpers (`.tools.local/check-wsl-verification-monitors.mjs`).
Frontend TypeScript and all 354 frontend tests pass; diff whitespace checks pass.

Checkpoint 28 adds Linux snapshot/coverage primitives and a stdin helper envelope;
end-to-end WSL verification remains open. See
`docs/wsl-verification-implementation.md`. New files: `wsl_repository.py`,
`wsl_bootstrap.py`, `scripts/wsl-repository.integration.mjs` and
`scripts/wsl-repository-tests.py`. Nine real Linux cases passed with no skips,
including a real kernel queue overflow; three Node checks and the existing
worktree bridge check pass. Strict Clippy/202 native tests pass (five ignored).
Script `.tools.local/verify-checkpoint28-repository.mjs` **73848** is terminal:
three deliberate regressions failed their intended assertions, three GUI cases
passed, sources were restored and all 41 WSL desktop cases passed (4.7 minutes).
The final source lazy-loads `ctypes` only for monitoring and ignores common
temporary build directories even when removed before completion. All nine Linux
cases/four Node checks and three rebuilt desktop checks pass after those fixes.
Final strict Clippy/202 native tests pass (five ignored). Logs:
`.tools.local/checkpoint28-{final-linux,final-desktop,restored-wsl-desktop,repository-gui}.log`.
All handles (67546, 77641, 90313, 73848, 41618, 95422, 54587) are terminal and no
mutation remains. Final cleanup found zero isolated WebViews, WSL supervisors,
fixture processes, lifetime files and repository/transport fixture directories.
Commit-only and branch-only snapshot identity changes also passed in the final
Linux rerun. No new UI verification capability is enabled. Before enabling
matching evidence, enforce trustworthy filesystem coverage: Windows drvfs/9p
and remote mounts need host observation or explicit unknown/error. Local Linux
watch success cannot prove host edits were observed. Keep that acceptance item
alongside monitor lifetime/authentication and actual command/session binding.

Checkpoint 27 integrates WSL worktree tasks and is **accepted**. All **134 desktop
cases pass** (14.5 minutes, zero skips/failures/flaky results), alongside six GUI
cases and three deliberate regressions caught. Report/log:
`.tools.local/checkpoint27-full-desktop.{json,log}`. Final cleanup found zero
isolated WebViews, WSL supervisors, fixture programs and lifetime files. All
handles are terminal; no mutation remains. The full goal remains unfinished.

Task history now captures environment, exact profile launch hash and
shared Linux Git metadata identity. Pending previews retain source and parent
identities. Store saves metadata before Linux creation, validates the current
profile before creation/open, routes inspection to the recorded distro, and
preserves failures. WSL shell/agent opening uses Linux briefs, exact spawn profile
checks and a second session/profile/repository check at the empty prompt. This
adds a separate launch binding without enabling WSL grants through the existing
native-only automation binding. UI previews/details show environment and retained
runs associate by environment and case-sensitive Linux path.

Latest checks: 354 frontend tests, both TypeScript checks, production bundle,
strict Clippy and 202 native tests (five ignored) pass. Opt-in Linux bridge test
was renamed to `scripts/wsl-worktree-bridge.integration.mjs` because `.test.mjs`
is reserved for the Vitest script suites. R101–R103 were registered before new
desktop specs. Focused handle **46891** finished with five cases passing and R101
failing because its helper waited for PowerShell in Bash. Corrected that helper;
R101 then exposed a real restart failure: four active WSL data operations rejected
inspection. Add bounded admission (four active, sixteen waiting, five-second
maximum wait); no executed mutation is retried. Worktree creation revalidates its
profile after admission too. Native concurrency, legacy-history and profile tests
pass. Native handles 11200, 57722 and 66950 are terminal. Lifecycle rerun **32837**
passed (11-second test, 36.1-second run). Log:
`.tools.local/checkpoint27-wsl-worktree-lifecycle.log`. Mutation/GUI script
`.tools.local/verify-checkpoint27-worktrees.mjs` **82204** finished successfully:
all three deliberate breaks fail their intended domain assertions, all six GUI
cases pass, sources are restored and all six normal cases pass again. Logs:
`.tools.local/checkpoint27-{missing-profile-binding,missing-prompt-validation,missing-linux-history,worktree-gui,worktree-restored}.log`.
No mutation remains. Cleanup found no isolated WebViews/supervisors/fixture
programs. Full **134-case** desktop acceptance **43664** finished successfully.
Log: `.tools.local/checkpoint27-full-desktop.log`. A prior auto-review usage-limit rejection did
not execute its action; the new native run was approved and completed normally.

### Earlier checkpoints (historical)

Checkpoint 26 adds a tested **WSL worktree bridge foundation**, not a completed
user workflow. `wsl_bridge.py` has fixed preview/create/details operations and
`scripts/wsl-worktree-bridge.integration.mjs` exercises real Linux Git/files, dirty-source
preservation, replaced source/parent identities and hostile repository programs.
Removing the hook guard fails the forbidden-program assertion; restored source
passes. Logs: `.tools.local/checkpoint26-{missing-hook-guard,restored-bridge}.log`.
Integration plan: `docs/wsl-worktree-implementation.md`. The Rust durable store,
profile identity binding, UI and WSL verification are still open. No new worktree
UI capability is enabled. Final native handle **66997** and earlier focused
desktop handle **83978** are terminal; final-source strict Clippy and 199 native
tests pass (five ignored). Focused desktop rebuild **68395** finished with all
four cases passing (55.6 seconds): WSL project discovery, repeated interop Stop
and both provider-presence cases. Log: `.tools.local/checkpoint26-focused-desktop.log`.
All handles are terminal. Checkpoint 25 below is the last full-suite acceptance
baseline; its 130-case result predates this bridge foundation.

Latest checkpoint 25 is **accepted for Windows interoperability cleanup**:
all 130 desktop cases pass (13.1 minutes, no skips/failures/flaky results), along
with six GUI-subsystem cases, two deliberate regressions caught, and both restored
normal Stop cases. Report/log: `.tools.local/checkpoint25-full-desktop.{json,log}`.
Final cleanup found zero isolated WebViews, WSL supervisors, fixture programs and
lifetime files. `git diff --check` passes. No test runner remains active. This is
the logical stopping point requested near the weekly limit; full goal remains
unfinished. Next work is the remaining WSL workflow parity and running-agent
follow-ups below; do not repeat the completed Stop implementation.

`Job` now retains the exact client handle and pinned transport handles,
queries bounded job membership, opens/checks member handles, and performs bounded
termination while preserving transport. Stop state guards backend writes; explicit
terminal replies bypass that guard. Registry reserves user input during Stop and
shows a pending notice, then releases it on success/failure. R100 was registered
before `wsl-stop-input.spec.ts`; its real paused-supervisor input-reservation and
recovery case passes. Frontend tests (353), both TypeScript checks and strict
Clippy pass for the current implementation; native/focused checks passed.

Transport capture requires a startup barrier: the fixed Linux supervisor accepts
authenticated `ready`/`launch` before forking the user command. Native `pty_spawn`
must return the session ID promptly so cursor/device replies can flow; registry
flushes early input with its reply classification and calls new `pty_ready`.
Backend `SessionManager.ready` then captures transport before releasing the Linux
shell. Returning spawn only after the barrier was wrong: delayed cursor replies
produced an `R` prefix in shell commands. The split attach/launch sequence fixes
that; close, owned-terminal and failed-probe focused cases pass again.

R99's original one-cycle case now passes, including actual shell input afterward.
The input corruption (`;28;13;..._`) came from ending Linux interop relays before
Windows programs/consoles had unwound. Stop now first verifies a shell through a
read-only `can_stop` operation, ends Windows programs before console hosts (giving
hosts bounded natural-exit time), then ends remaining Linux programs. No host is
permanently exempted by name. Original transport remains protected by pinned
startup identity. An already-exiting Windows process can deny TerminateProcess
before its exit event is set; bounded waiting handles that race. The test now
requires a second Windows launch/Stop and fresh Linux input, not just one echo.

Native Clippy/tests **10220** finished: 199 passing, five ignored. Focused desktop
suite **41967** finished: all 12 cases pass, including two consecutive Windows
launch/Stop cycles and subsequent Linux input. Evidence:
`.tools.local/checkpoint25-stop-focused.log`. Both handles are terminal.
Regression/GUI validation **76516** finished successfully. Both deliberate breaks
failed for their intended assertions: missing Windows Stop left `owned-child`,
and missing frontend/backend reservation created the forbidden input file.
All six GUI-subsystem cases and both restored normal Stop cases pass. Script:
`.tools.local/verify-checkpoint25-stop.mjs`; all deliberate mutations are restored.
Full 130-case desktop acceptance **61436** finished successfully; all handles
listed here are terminal. Log: `.tools.local/checkpoint25-full-desktop.log`.
Old diagnostic runs (including 26396 and 14650) are terminal, and temporary
diagnostic source/logging was removed. The direct-program test's last text-only
failure used an older artifact; the original error wording is restored in current
source. Full suite and GUI acceptance passed for the Stop/bootstrap changes.
Both TypeScript checks, 353 frontend tests and the production bundle pass.
The older creation-time
mutation script needs adaptation: omitting job attachment now fails closed at
bootstrap, rather than permitting a leaking user program. Root approval is still
pending; no root execution or live configuration changes occurred.

### Earlier checkpoint 25 experiments (historical)

R97/R98/R99 were registered
before their specs. Actual Windows Node programs launched from WSL, plus detached
Windows children, are inspected by exact fixture executable/script/tag and pinned
OS process handles. An unrelated Windows root/child pair is preserved. A new
`Qterm.crash()` kills only the app process; tree-killing test cleanup must not mask
ownership. This replaces neither the installed app nor live provider data.

R97 normal quit and direct crash pass. R98 reproduced a detached Windows child
surviving pane closure. A per-pane qterm CLI helper made five focused desktop cases
pass in the console-subsystem debug build, but **all five failed with the GUI
subsystem used for releases**, before a WSL prompt appeared. That prototype was
rejected and removed from main/lib/PTY production code. Its source survives only
in `.tools.local/wsl-windows-owner-rejected-prototype.rs`; do not restore it as the
solution. Removing it deliberately reproduced R98. Logs:
`.tools.local/interop-owner-{missing-pane-job,gui-subsystem}.log`.

**R99 remains red:** Stop ends the Windows root but leaves its detached child while
the pane remains alive to preserve the shell. Evidence:
`.tools.local/checkpoint25-interop-stop.log`. Do not drop/skip/weaken this spec or
claim Windows interoperability ownership complete. Investigate parent-held
per-pane job control so Stop can target pinned, verified job members while keeping
the original WSL client, with deadlines and truthful failure reporting.
Never add a generic arbitrary-PID endpoint or terminate unrelated Windows trees.

Mutation session 13763 is terminal (expected negative passed, GUI variant failed).
Its finally block restored source; the rejected production helper was then removed
explicitly. Do not rerun that old prototype script unchanged. The next approach
is documented in `docs/wsl-interop-ownership-plan.md`: ConPTY process-creation job
attributes (a narrow portable-pty patch), rather than a GUI helper or after-start
PID assignment. That replacement now exists as described below.

Update: the replacement is now implemented for **pane close/app exit only**.
`src-tauri/vendor/portable-pty` is a licensed copy of cached 0.9.0. Only three
upstream source files changed: CommandBuilder's non-serialized optional Windows
job handle, job-list attribute support, and ConPTY creation. Version/dependencies
are unchanged; Cargo.lock only removes the registry source/checksum for that path
dependency. See `vendor/portable-pty/QTERM-PATCH.md`. The handle array outlives
the native attribute list, including failed creation paths.

`wsl_windows_job.rs` creates a private, non-inheritable kill-on-close job. The
Session holds it and explicitly drops Linux lifetime/Windows job before console
teardown. Only owned WSL profiles get a job, attached before their initial thread
runs. Raw `spawn` is now test-only; `spawn_profile` uses the private job-aware
method. Offline check and strict Clippy pass. All five focused cases pass with
the new implementation (close/quit/crash, terminal control/resize, Linux Stop).
This **does not fix R99**; Stop still queries only Linux ownership.

Creation-time mutation/GUI validation is complete (session 48161 terminal), script
`.tools.local/verify-interop-job-creation.mjs`. Removing the creation attribute
failed R98 with surviving `owned-child`; restored source passed all five focused
cases with the GUI subsystem, then normal sources/artifact were rebuilt and R98
passed again. Logs: `.tools.local/interop-job-{missing-attribute,gui-subsystem,restored}.log`.
All handles are terminal. Cleanup found zero isolated WebViews, supervisors,
fixture programs/environment processes, interoperability programs and lifetime
files. No desktop run needs resuming. This script replaces the retired helper
script; use its current anchors if a future change requires another regression check.

For Stop, portable-pty already exposes `Child::as_raw_handle()`; clone the original
WSL client handle before moving Child to its wait thread, rather than reopening a
root PID later. Job membership must be checked through pinned process handles.
Respect expiry/new input and retain terminal protocol replies. Registry already
classifies `isTerminalReply`; currently `ptyWrite(session,data)` drops that source
distinction before the backend. Do not block protocol replies with a user-input
guard or blindly terminate every job member (the original client must survive).

Final setup-error review moved the job into a local declared after the PTY, so an
early post-spawn failure releases Windows ownership before console destruction,
even before Session exists. Strict Clippy and the native suite pass after this
last change (**199 passed, five ignored**); normal-mode R98 passes again. Native
session 82690 and desktop session 34372 are terminal. E2E artifact matches current
native source. The earlier five-case GUI result predates only this drop-order
adjustment. Full 129-case acceptance remains pending R99 and broader checks.

Historical validation after rejecting the helper: the normal debug artifact was
rebuilt from the then-restored production source. R97
quit/crash both pass again (session 2664 terminal). Transcript:
`.tools.local/checkpoint25-restored-interop-exit.log`. All build/test handles from
that run were terminal. Cleanup found zero isolated WebViews, Linux supervisors,
fixture programs/environment processes, interoperability programs/folders and
lifetime files. These checks predate the new creation-time job implementation;
the current accepted focused creation-time results are recorded above.
The first setup attempt used Windows PowerShell 5, which rejected the fixture
script. The fixture now uses the existing PowerShell 7 tool without policy changes.
Both initial failed fixture families were checked and removed with
`.tools.local/cleanup-initial-interop-fixtures.mjs`. No programs had started in them.

The last complete acceptance below is checkpoints 23/24. Production source now
includes the new checkpoint 25 creation-time job; R98 passes focused validation,
while R99 still exposes unfinished behavior. Privileged Linux cleanup remains
pending the unanswered root-supervisor decision. No root execution occurred.

Checkpoint 23 is validated. New Linux provider-presence probing,
shared frontend process polling and process-evidence handling are in the worktree
(`agent_process.rs`, `processEvidence.ts`, `useProviderProcesses.ts`, plus IPC,
supervisor and adapter changes). All **125 desktop scenarios passed** in the final
full run (12.3 minutes, no skips/failures/flaky results). R95/R96 were
registered before their specs. All four focused desktop cases now pass: quiet
Claude/Codex process discovery, same-folder isolation, ended-process removal and
independent probe-error recovery. The fixture copies the real Python executable
under provider image names and waits for a signal; it never invokes a provider.
Ubuntu's multicall sleep binary rejects renamed images, including with argv[0]
changed; earlier missing-badge failures used that invalid fixture.

Both adapters now use `withProcessEvidence`, which clones the observation before
overriding its displayed state. A frozen-event regression test proves a probe
failure cannot corrupt retained hook activity and that recovery restores it.
Both TypeScript checks, strict Clippy, 353 frontend tests, production bundling and
199 native tests pass (five helper/opt-in tests ignored). The old lost Clippy result has been
replaced by a successful current run. `snapshot_result()` call sites are in the
Result-returning programs/Stop methods. All four deliberate regression checks
were caught (presence, probe errors, ended-process retention and hook corruption),
with source restored. The ended-process mutation first exposed a weak assertion:
unknown-to-busy was accepted as disappearance; both specs now require all provider
status badges to disappear. Logs are `.tools.local/provider-process-mutation-*`.
The first full run completed 124/125 passing (11.6 minutes). R88 could not launch
its fixture helper: embedding the now-larger supervisor source exceeded Windows'
command-line limit (`ENAMETOOLONG`). Preserve that report/log in
`.tools.local/checkpoint23-before-helper-stdin.{json,log}`. Fixture Python now
receives code on stdin with isolated startup. R88 and both provider-probe cases
pass after the fix. R82 startup-isolation failed once with cwd `/`, then passed on
a focused rerun; its cause is unproven. Keep the new cwd-plus-terminal diagnostics
in `fixture.ready` and watch for recurrence; do not dismiss it as fixed by a rerun.

A separate freshness clock now expires published process evidence while a later
backend request is still pending, without overlapping RPCs. Two added unit cases
cover expiry/recovery and retention of ended/error evidence. Deliberately omitting
expiry failed the unit test; restoring command-line fixture transport failed R88
with `ENAMETOOLONG`. Both sources restored. Logs/helper:
`.tools.local/provider-process-mutation-{expiry,helper-stdin}.log` and
`.tools.local/verify-process-freshness.mjs`.

The final report/log are `.tools.local/checkpoint23-full-desktop.{json,log}`.
Session 76984 and the older 79152 run are terminal. R82 passed in the final full
run, although the earlier failed start is not independently explained. Final
cleanup found no isolated app/WebView, lifetime files, Linux supervisors or
fixture processes. No desktop runner remains live. Retain all source and do not
claim full WSL parity.

Checkpoint 24 completes the initial native indexing measurement. Its test-only
benchmark is in
`src-tauri/src/codex_benchmark.rs` (registered only under `#[cfg(test)]` in lib.rs).
It does not change production app code or invalidate the current desktop artifact.
Strict Clippy and the default native suite pass (**199 passing, five ignored**).
The explicit ignored benchmark passed after desktop validation/cleanup finished.
All three generated-history cases correctly updated appended usage and removed
deleted sessions. No benchmark fixture directories remained (zero before/after).
Raw output: `.tools.local/codex-index-debug.log`; baseline and assessment:
`docs/codex-index-measurement.md`. Batch-of-16 reads were 15.04–15.84x faster than
16 separate calls. At 1,000 transcripts, cached batch median/p95 were 28.03/33.42 ms;
initial debug indexing was 3.15 seconds. Keep batching and the current cache;
release-build, cold-disk, larger-history and WSL performance are not established.
Benchmark session 62180 and native-test session 25378 are terminal. All build/test
handles are now terminal. Check actual process state before restarting anything
if a later tool observation is interrupted.

Checkpoint 22 fixes a reproduced startup-reservation race: old workspace effects
could cancel task/verification reservations before their panes committed. The
shared guard now distinguishes not-yet-observed panes from panes closed later.
R93's 24 concurrent Git Bash launches and R94's mounted pending-pane cancellation
pass, alongside native shell and verification scenarios. Both deliberate guard
breaks failed their intended assertions and sources were restored. Frontend checks
pass (347 tests, both TypeScript checks, production build); native source is
unchanged from its strict Clippy/199 passing tests. All **121 desktop scenarios
passed** in the final full run (10.7 minutes, no skips/failures/flaky results).
Evidence: `.tools.local/checkpoint22-full-desktop.{json,log}`. All build/test
handles are terminal. Final cleanup found no isolated app/WebView, lifetime files,
Linux supervisors or fixture processes. Check actual process state before a future
restart if a tool connection is interrupted.
Thirty sequential Bash reproductions passed before the concurrent failure exposed
the commit race. The original R61 failure lacked state diagnostics, so its exact
cause was not independently proved; keep its enhanced diagnostics. It passed in
the final full run. See checkpoint 22 in the implementation plan for logs and details.

## Earlier checkpoints (historical validation)

Checkpoint 21 adds delayed close/switch and confirmation context guards plus
invocation-aware Linux shell classification. Six focused desktop cases and 14
pure Python invocation cases pass; five deliberate breaks were caught/restored.
Frontend checks pass (347 tests, both TypeScript checks, production build). Strict
Clippy and 199 native tests pass (four helpers ignored). The first 119-scenario run
passed 117, with two pre-frontend WebView2 resource-in-use startup failures. Added
an exact isolated WebView profile process-exit gate; its live/empty matches were
verified. The next full **119 desktop** run passed **118/119**, with no startup
failures; R61 Git Bash watch launch intermittently did not create its PID file.
Added invocation state/error and terminal-output diagnostics, then repeated Cmd
and Bash cases five times: **10/10 passed**. The intermittent failure is still open;
do not claim a clean 119-scenario run or treat those repeats as a proven fix.
Evidence: `.tools.local/checkpoint21-full-desktop.{json,log}` (118/119),
`.tools.local/checkpoint21-watch-failure.*` (copy), and
`.tools.local/checkpoint21-native-shell-repeat.log` (10/10).
All build/test handles are terminal. Final cleanup: no isolated app/WebView,
lifetime files, Linux supervisors, fixture programs or fixture-environment processes.
BusyBox is absent; shared-image matching has pure-case coverage, not a real
BusyBox run. No installation or root operation occurred.

Checkpoint 20 implements same-user WSL program inspection and targeted Stop for
close/switch/Stop actions, authenticated supervisor control with expiry, explicit
probe-error confirmation and direct-program-root handling. Four new scenarios
(R87–R90) pass, and eight deliberate breaks were caught/restored. A stale queued
Stop bug was reproduced and fixed. All **113 desktop scenarios passed** in the
final full run (8.0 minutes, no skips/failures/flaky results).
Current frontend checks pass (347 tests, both TypeScript checks, production build).
Native final checks pass (199 tests, four helpers ignored, strict Clippy).
Detailed evidence is in checkpoint 20
of the implementation plan and ignored `.tools.local/wsl-program-mutation-*.log`.
The acceptance report is `.tools.local/checkpoint20-full-desktop.json`; its log is
`.tools.local/checkpoint20-full-desktop.log`. After the final run, no isolated
app/runner, lifetime files, Linux supervisors or fixture programs remained. There
are no live build/test handles. Check actual process state before any future
restart if a tool connection is interrupted.
The previous completed run passed 111/113; R71/R73 had obsolete unconditional
switch-confirmation clicks. Their corrected idle-switch/path assertions passed
focused validation and the added false-helper mutation. The successful final run
includes those corrections; the earlier two failures are resolved.

Checkpoint 19 in [developer-agent-plan.md](developer-agent-plan.md) implements
provider-menu environment identity, scoped forgetting, backend history gates,
verified new/current resumes and environment-bound fresh sessions. Its 12 focused
desktop scenarios pass. Five deliberate mutations failed their intended assertions;
all sources were restored and focused/native checks passed again.

- Frontend: 347 tests passed.
- Native: strict Clippy, 199 tests passed; 4 subprocess/real-WSL helpers ignored.
- **All 109 checkpoint 19 desktop scenarios passed**, no skips/failures, in 7.7 minutes
  on 4 November 2026. Report: `.tools.local/checkpoint19-full-desktop.json`;
  transcript: `.tools.local/checkpoint19-full-desktop.log`. Inspected current menu
  screenshot, including the Native Windows label and separate environment groups.
- An earlier run lost its tool session after at least 26 passing scenarios. Its
  handle was missing and process inspection confirmed no runner/app remained
  before restarting. The completed full run above is the acceptance evidence.
- After checkpoint 19 completion: no isolated app/runner, Windows lifetime files,
  Linux supervisors or fixture daemons remained. Check authoritative state
  if a future tool reports otherwise; never restart a still-live test on timeout.
- Root-supervisor question is still pending. No root supervisor was implemented
  or run. Do not infer approval from goal resumption or elapsed time. See
  [wsl-ownership-proposal.md](wsl-ownership-proposal.md).

## First actions after resume

1. Checkpoint 34 verifies task-source filesystem facts and shared format parsers.
   Integrate them into WSL grant/policy/runtime/UI next; do not redo that foundation.
   Checkpoint 33 accepts WSL recipes and all 153 desktop cases. Do not redo recipe
   or verification integration. Implement WSL scoped named-task/read grants and
   validate the Linux CLI client route using `docs/wsl-workflows-implementation.md`,
   starting at steps 4–6. Keep
   environment identity and exact launch policy throughout dependency/readiness
   delays, revalidate definitions, preserve session-only explicit authority and
   never widen native grants by merely permitting the WSL shell kind.
   Checkpoint 33 is the current full-suite baseline: 153 desktop cases, nine
   recipe GUI cases, eight deliberate regressions caught, 355 frontend tests,
   204 native tests (nine ignored), strict Clippy, both TypeScript checks and
   production bundling. Mutation sources were restored exactly. WSL worktree storage/UI/profile
   binding and prompt-gated launch are already implemented; do not redo them.
   The explicit indexing benchmark passed. Keep R61/R82 diagnostics for recurrence.
2. Proceed with the remaining workflow acceptance list below. Linux provider presence
   is now validated; missing lifecycle events must remain unknown. The current
   WSL supervisor covers same-user Linux descendants;
   privileged/sudo descendants require the pending root-supervisor decision.
   Delayed close/switch and confirmation context guards are now implemented.
   Shell classification includes invocation/applet identity; real multi-call
   runtime evidence is still needed beyond the verified Bash and pure cases.
3. The remaining workflow acceptance list in `wsl-parity-proposal.md` retains WSL
   scoped-grant execution requirements, plus
   running-session structured follow-ups. The initial native Codex indexing
   measurement is complete; its stated limits remain. Optional
   MCP/App Server work stays separately scoped. Do not mark the entire goal
   complete at this checkpoint.

## Commands and constraints

Windows repo: `C:\Users\unami\Dev\qterm`, PowerShell. Read `e2e/RULES.md` before
editing specs. Register risks before specs; real ConPTY/files/processes, no mocked
invoke, no sleeps, role/label selectors. Deliberately break protected behavior,
restore and pass. Never run desktop suites in parallel (CDP 9333/Vite 1420).
Notification suppression must stay enabled, even in mutations. No root execution
until the pending decision is answered. Do not spawn agents without authorization.

For native/desktop commands use normal sandbox approval; never bypass it. A usage
review failure occurred, then the stated 11:29 AM reset passed and normal review
succeeded. There is no outstanding approval rejection blocking this checkpoint.

```powershell
$taskRoot=(Get-Location).Path
$env:PATH="$taskRoot\.tools.local\node-v26.13.0-win-x64;$taskRoot\.tools.local\node_modules\.bin;$taskRoot\.tools.local\pwsh;C:\Users\unami\.cargo\bin;"+$env:PATH
$env:QTERM_E2E_WSL_DISTRIBUTION='Ubuntu'
Remove-Item Env:QTERM_E2E_SKIP_BUILD -ErrorAction SilentlyContinue
& ./.tools.local/node-v26.13.0-win-x64/node.exe ./node_modules/@playwright/test/cli.js test
```

Use `QTERM_E2E_SKIP_BUILD=1` only when the native test executable still matches
current Rust/Python source. Native checks from `src-tauri`: `cargo clippy --locked
--all-targets -- -D warnings`, then `cargo test --locked`. Workspace frontend tools:
`.tools.local/node-v26.13.0-win-x64/node.exe`, `node_modules/typescript/bin/tsc
--noEmit`, `tsc -p e2e`, `node_modules/vitest/vitest.mjs run --reporter=dot`,
`node_modules/vite/bin/vite.js build`, and `git diff --check`.

Use UTF-8 explicitly. Format only new Rust modules, never whole baseline files.
Verify canonical owned paths before recursive Windows/temp cleanup. Tests use
isolated `dev.qterm.e2e` state and fixture provider homes; never replace the installed
app or operate on live transcripts/configuration. Diagnostic scripts/logs remain
in ignored `.tools.local/`, including `verify-provider-menu-regressions.mjs` and
`check-wsl-owners.mjs`.
