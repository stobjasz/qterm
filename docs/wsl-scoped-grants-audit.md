# WSL scoped project grants: acceptance audit

Scope: steps 4–6 of [the WSL workflow plan](wsl-workflows-implementation.md),
preserving explicit session-only project reads and separately selected named
tasks. This audit does not claim completion of privileged process ownership or
running-agent follow-ups.

## Accepted baseline

Checkpoint 38 passes all 162 real desktop cases in 21.4 minutes, with no failed,
skipped or flaky cases and no reporter errors. The report is
`.tools.local/checkpoint38-full-desktop.json`; the log uses the same basename.
`.tools.local/check-checkpoint38.mjs` checks counts, current mutation-source
restoration and fixture-directory cleanup. All 205 default native tests, strict
Clippy, 355 frontend tests, app/focused E2E TypeScript and production bundling pass.
Opt-in real Linux source/policy tests were run separately; ignored tests are not
counted as default-suite proof.

## Requirement-by-requirement evidence

| Requirement | Current implementation and evidence | Result |
| --- | --- | --- |
| Explicit distribution, canonical project and current Linux user | `agent_scope::Scope` captures a typed `wsl_tasks::Project`. Fixed Linux operations bind UID, root/shared-Git and directory device/inode identities, rechecking before/after reads. Checkpoints 34–35 exercise the actual transport and changed identities. | Proven |
| Native and Linux authority remain separate | Scope filtering requires captured environment and kind before path checks; Linux never accepts missing/native/other-distribution metadata. Real policy/pipe checks cover those metadata combinations; R118 proves case-sensitive project and symlink exclusion with real panes and records. | Proven |
| Shared supported task formats | Both readers use `project::tasks_from_sources` and shared manager selection. Actual Linux transport discovers package/Cargo/Make/Just/Composer/Python formats; existing native parser tests remain passing. | Proven |
| Nearest directory and ancestor package-manager choice | Linux discovery walks bounded parents inside the captured repository and reads ancestor locks independently of unrelated manifests. The real policy test rejects changed selection while allowing lock-content updates that leave selection unchanged. | Proven |
| Bounded, nonexecuting discovery | Fixed-name regular manifest reads cap bytes at 1 MiB, preserve raw bytes with base64, check size/hash after decoding and cap discovered tasks at 200. Linux source cases cover oversized/special files, aliases and exact binary transport. No package manager or project task runs during discovery. | Proven |
| Read consent separate from execution | Access review has explicit environment, read consent and selected-task consent. R117/R118 exercise actual UI and CLI; read-only and unselected task requests are rejected. | Proven |
| Review cancellation and expiry | Validation runs outside Access locks, then grant commit rechecks cancellation, expiry and single use. The native commit test and checkpoint 35's deliberate cancellation break establish this boundary. | Proven |
| No arbitrary command/argument override | Requests use strict schemas, selected task IDs and stable request IDs. Existing native tests and R117 reject unselected/extra command input. Discovery commands must match the reviewed source and current resolution. | Proven |
| Fresh policy on request/claim/launch | Linux policy revalidates selected source/directory facts and resolved commands; exact profile and actual pane/session bindings are required. R119 rejects changed source; R121 rejects delayed profile, unavailable replacement distribution and task-directory replacement. Deliberate missing guards fail. | Proven |
| Live configuration and final submission checks | Launch rechecks live configuration around slow distro/evidence operations and at writing; revocation/state are checked at commit. Linux I/O is outside Access/Queue mutexes. Native task regressions stay green. | Proven |
| Idempotent concurrent requests | Queue and request paths preserve grant/request/task identity. R122 uses four actual Linux CLI processes with two intended request IDs, yielding two invocations and panes while preserving the source program. Removing idempotency fails the test. | Proven |
| Revoked or failed startup cannot execute later | R119 revokes during Bash startup; R123 verifies a nonzero startup exit cancels the pending task, retains the failure and does not replay on retry. The latter exposed and verified the `App.onExit` fix. | Proven |
| Scoped Stop preserves source and shell | R120 checks exact PID birth, termination of the original task, continued source-program life and subsequent task-shell input. Removing interrupt/Stop fails. Stop uses the original full session/pane/key binding. | Proven |
| Result/evidence attribution | Linux records require matching environment/kind/cwd before requester attribution; native records reject foreign contexts. R117 verifies run/request identity, output, repository evidence and retained results. Removing requester attribution fails. | Proven |
| Outside record IDs reveal no output | R118 obtains outside IDs through a second explicitly granted project, then proves the first grant rejects direct result reads. Historical commands started inside remain readable after a pane moves. | Proven |
| Restart restores no execution authority | Grants remain in memory; Windows owns credential handles. R117 and native grant cases verify removed credentials, saved result attribution and no command replay after restart. | Proven |
| Actual Linux client route | R117 runs the Windows executable through real WSL interop, retaining Windows connection-path spelling. Provider indexing is disabled. The private Windows pipe is reused; no new listener or token-bearing shell argument is introduced. | Proven |

Source anchors: [scope](../src-tauri/src/agent_scope.rs),
[Linux facts](../src-tauri/src/wsl_task_sources.py),
[typed reader](../src-tauri/src/wsl_tasks.rs),
[task policy/queue](../src-tauri/src/agent_tasks.rs),
[Access](../src-tauri/src/agent_access.rs),
[UI](../src/agents/AgentAccessPanel.tsx) and
[runtime integration](../src/App.tsx). Risks R117–R123 and their actual specs are
registered in [the E2E risk table](../e2e/README.md).

## Limits retained from the contract

These are same-user capabilities, not a sandbox against the developer's own
processes. Read authority follows captured command-start cwd, not current pane
location or every file a command might read. Deleted/unreachable projects and
unsupported environments are refused. Verification coverage limitations remain
those in [verification records](verification-records.md); evidence failure does
not bypass launch policy. No persistent grants, arbitrary input endpoint,
automatic transcript sharing, privileged supervisor or managed-agent protocol
integration was added by this work.
