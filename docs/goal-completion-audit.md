# Developer and coding-agent goal: completion audit

**Result: the user-agreed delivery requirements are satisfied.**
The user explicitly deferred managed sessions/automatic running-agent follow-ups
on 5 November 2026 (“1 defer”). That feature remains unimplemented and is excluded
from this delivery by the user's decision, rather than counted as implemented.
The user subsequently clarified “limits,” explicitly accepting unprivileged Linux
cleanup and excluding a root supervisor from this delivery. Privileged-descendant
cleanup remains unimplemented and is recorded as an accepted limit, not a tested
capability. Proposals: [managed follow-ups](running-agent-followups-proposal.md)
and [root supervision](wsl-ownership-proposal.md).

This audit derives its requirements from the active user objective and the numbered
[implementation plan](developer-agent-plan.md). It preserves the reviewed scope;
it does not count the unimplemented parts as complete because adjacent features
work. It concerns this Windows workspace build and its selected WSL environment.
No installed qterm, live provider configuration/transcripts or release changed.

## Evidence baseline

- Full desktop report: `.tools.local/checkpoint38-full-desktop.json`, all **162**
  cases passing in 21.4 minutes, zero skipped/failed/flaky cases or reporter errors.
  `check-checkpoint38.mjs` verifies report counts and mutation restoration/cleanup.
- Native: `.tools.local/checkpoint38-native.log`, **205 passed**, 11 explicitly
  ignored. Ignored cases are not counted as passed; separately executed opt-in
  source/policy/benchmark evidence is identified in the relevant implementation doc.
- Strict Clippy, app/focused E2E TypeScript, **355 frontend tests** and production
  bundling pass in checkpoint 38. The subsequent production ownership mutations
  were restored byte-for-byte; checkpoint 39 added runtime test artifacts only.
- `.tools.local/audit-goal-report.mjs` walks the actual full-suite JSON results,
  rejects missing/nonpassing required specs and writes
  `.tools.local/goal-requirements-report.json`, binding the mapping to the report's
  SHA-256. Spec presence alone is not the audit: source paths and relevant test
  assertions were inspected below. Cases can support more than one requirement.

## Numbered-plan audit

| Item | Concrete requirement and inspected implementation | Authoritative verification | Assessment |
| --- | --- | --- | --- |
| 1. Recoverable persistence | `workspace/persistence.ts` serializes each store, records only acknowledged snapshots and preserves per-pane captured output revisions. `App.tsx` uses the same output queue for clear/save, retains failed saves and offers automatic/manual retry. Inbox, command-history, worktree and pin stores preserve unreadable data before explicit recovery. | Six persistence unit cases cover unchanged retries, overlapping writes, independent stores, clear ordering, partial failures and newer output. R39 and recovery cases R48/R53/R56/R66 exercise actual filesystem failures, recovery and restart. | Implemented and verified |
| 2. Integration health | `agent_health.rs` distinguishes nonce-bound local delivery probes from real hook events. `IntegrationHealth.tsx` displays the resolved home, executable/inbox, receiving pane/session/time and errors. Codex scan diagnostics distinguish unsupported inputs and failed/old scans. | R41 runs both actual local hook/watcher probes and a pane-associated event. Codex desktop cases verify scan diagnostics and refresh. The probe does not claim provider trust/configuration or a model call. | Implemented and verified within the local-test contract |
| 3. Accurate status | `agents/status.ts` retains lifecycle provenance/revision/freshness and makes silent processes unknown. `processEvidence.ts` expires failed/stale/different-environment evidence. Codex approval routing is informational rather than a confirmed human question. | R38/R42 and real WSL provider-presence/probe cases cover quiet/failed/stale evidence. R50 verifies no approval-request toast without a confirmed question and one notification for duplicate completions. | Implemented and verified |
| 4. Send output | `handoff.ts` bounds/fences context and gives the shell only a generated brief reference. `HandoffDialog.tsx` requires preview and explicit action. `App.tsx` and startup authorization bind the original environment/folder/prompt. | R43–R46 and WSL output-handoff cases verify literal hostile text, both providers, busy-source rejection, prompt waiting, focus/Escape and matching Linux environment. | New/idle-shell flow verified; automatic running-session delivery **explicitly deferred by the user** |
| 5. Efficient Codex indexing | `codex.rs` caches unchanged metadata and batches usage; `useCodex.ts` shares batched usage polling. `codex_benchmark.rs` generates isolated histories and checks appended/deleted data. | Actual generated benchmark log `.tools.local/codex-index-debug.log` contains three successful datasets and measurements; [measurement report](codex-index-measurement.md) preserves bounds and methodology. R40 verifies UI scan/refresh behavior. | Implemented and measured for the required initial native baseline |
| 6. Attention inbox | `agent_inbox.rs`, `useAgentInbox.ts` and `AgentInbox.tsx` separate viewed/resolved state, provider/type/run/pane/session identity and persisted history; keyboard-accessible actions preserve terminal approval ownership. | R47 verifies independent events, viewed versus resolved, pane close and prior-run persistence. R48 verifies retry and backup recovery. R50 keeps informational approvals out of unresolved human-input state. | Implemented and verified |
| 7. Problems | `problems/diagnostics.ts`, `toolDiagnostics.ts`, `runs.ts` and Problems UI retain source positions, original environment/cwd, unsupported-output state and per-command supersession. | R49 uses real TypeScript/rustc failures, actual editor arguments and a successful rerun. Adapter fixtures cover additional formats; R54 covers final output without newline. R69 exercises actual WSL diagnostic files and case. | Implemented and verified; adapter scope is documented |
| 8. Verification | `run_records.rs`, `repo_state.rs` and fixed Linux repository/monitor helpers bind before-run state, watch coverage and historical comparisons. The UI distinguishes stale, unknown and matched state. | Native R51/R52 and WSL tracking cases verify restart, edits restored during execution, monitored metadata, profile/folder changes, monitor loss, unsupported mounts and shell/app cleanup. [Acceptance details](wsl-verification-implementation.md). | Implemented and verified within declared evidence limits |
| 9. Worktrees | `worktree_tasks.rs` and the Worktree UI separate preview/create/open, retain task/check/environment metadata, inspect changes and mark completion without deleting source/worktree files. | R55/R56 plus WSL worktree/profile/startup cases verify dirty-source preservation, exact checkout/agent context, history/recovery, changed profiles and delayed startup. [WSL evidence](wsl-worktree-implementation.md). | Implemented and verified |
| 10. Scoped local CLI | `agent_pipe.rs`, `agent_scope.rs`, `agent_tasks.rs` and `agent_access.rs` authenticate session-only project capabilities and selected tasks, with strict inputs and retained invocation identity. | R57–R61, native reservation/concurrency cases and R117–R123 prove real CLI/pipe reads, consent, scope, definition/revocation, Stop, retries, startup failure and actual Linux interop. [Full requirement audit](wsl-scoped-grants-audit.md). | Implemented and verified |
| 11. Optional MCP adapter | The plan explicitly makes this an optional later adapter over the same capabilities. The active objective requires the scoped local interface, which is delivered through the CLI. No MCP adapter exists. | Implementation/protocol inventory and [local interface scope](local-agent-interface.md). | Optional, not implemented; no completion claim |
| 12. Recipes | `recipes.rs` parses versioned project recipes, validates dependencies, gates readiness and retains reviewed source/profile/folder/session identity. UI launch remains explicit. | R62–R64 and R113–R116 use actual commands/files for layouts/order, unknown exits, failure/timeout/cancel/readiness/Stop, changed definitions and restart without replay. | Implemented and verified |
| 13. Session library/handoffs | `session_library.rs`, `useSessionLibrary.ts`, `sessionHandoff.ts` and dialogs preserve provider/environment/source identities, filters, explicit pins, retention gates and bounded reviewed exports. Resume/handoff use a new prompt-gated pane. | R65–R68 and WSL source/resume/session-handoff cases verify colliding identities, source changes, unavailable distributions, pins/recovery, retention, consent and literal context. | Implemented and verified; no automatic cross-provider sync |
| 14. WSL parity | Explicit distro identity flows through panes, source caches, commands, links, transfers, library, worktrees, verification, recipes and grants. Per-pane Linux ownership and Windows job boundaries handle normal-user and interoperability descendants. | R69 onward, all 162 desktop cases, the three WSL implementation audits and real BusyBox runtime evidence. Source inspection confirms failed distro probes do not substitute defaults. Root descendants remain outside user-level signal authority. | Implemented and verified within the user's explicitly accepted unprivileged cleanup limit |
| 15. Optional App Server spike | The user deferred managed sessions and automatic follow-ups. The follow-up proposal remains future design; no managed provider runtime was implemented or started. | [Decision and feasibility boundary](running-agent-followups-proposal.md). No CLI was available on this session's PATH; that is not proof the machine has no installation. | Deferred with managed follow-ups; no implementation claim |

## Additional user instructions

- Full Windows build toolchain installation was authorized and completed earlier;
  actual Rust compilation, native tests and real desktop builds establish that the
  required Windows validation toolchain works. No further toolchain installation
  is needed for this checkpoint.
- Named-task authority uses explicit session-only per-project grants, remains off
  until enabled and exposes no arbitrary typing/command endpoint. Read consent is
  separate from selected task consent.
- All-descendant exit ownership is verified for native Windows, same-user Linux
  and tested Windows-interoperability descendants. The requested policy is not
  enforced for Linux descendants gaining privilege; the user explicitly accepted
  that limitation with the reply “limits.” No root supervisor is authorized.
- The reported excessive qterm Codex “needs answers” notifications are fixed in
  source and protected by R50 in the accepted full suite. Test builds suppress
  actual Windows toast delivery. The installed qterm has not been replaced.

## Limits and remaining actions

Native index measurements use generated debug workloads with an unflushed OS
cache; they make no release, arbitrary real-history or WSL-performance claim.
Diagnostic adapters support their documented formats. Verification excludes its
documented ignored/external/environment state and refuses unsupported event
coverage. BusyBox evidence uses actual processes and physical fixture aliases;
Ubuntu's system shell registry is unchanged. Local provider fixtures validate
qterm boundaries without model calls or changing provider trust.

Managed sessions/automatic running-agent delivery are explicitly deferred, and
the user explicitly accepts unprivileged cleanup limits. These decisions resolve
the two previously unachieved requirements for this delivery. The report and
requirement mapping have been rechecked against the resulting scope. No further
required implementation remains. Root supervision and managed sessions require
separate future authorization and their own acceptance work.

No publishing, installed-app replacement, model-backed test, automatic merge,
dependency bootstrap, destructive worktree cleanup or ongoing transcript sharing
is included in the current authorized delivery. The delivered work remains in
the workspace; no release or installed-app replacement is implied by completion.
