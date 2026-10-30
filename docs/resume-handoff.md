# Resume handoff — 30 October 2026

The user requested a pause near the weekly limit. Do not restart the review or
discard the worktree. The full objective remains unfinished; resume the existing
goal when requested. All cumulative uncommitted changes are this implementation.
No installed qterm, live provider configuration, release or model call changed.

## Current checkpoint

Checkpoint 19 in [developer-agent-plan.md](developer-agent-plan.md) implements
provider-menu environment identity, scoped forgetting, backend history gates,
verified new/current resumes and environment-bound fresh sessions. Its 12 focused
desktop scenarios pass. Five deliberate mutations failed their intended assertions;
all sources were restored and focused/native checks passed again.

- Frontend: 347 tests passed.
- Native: strict Clippy, 199 tests passed; 4 subprocess/real-WSL helpers ignored.
- Full desktop baseline: checkpoint 18 passed 97 scenarios.
- **Next required validation: run all 109 current desktop scenarios.** Do not claim
  that this full run has already passed.
- No running build/test handles are expected at pause. Check authoritative state
  if a future tool reports otherwise; never restart a still-live test on timeout.
- Root-supervisor question is still pending. No root supervisor was implemented
  or run. Do not infer approval from goal resumption or elapsed time. See
  [wsl-ownership-proposal.md](wsl-ownership-proposal.md).

## First actions after resume

1. Inspect current worktree and this checkpoint; run the full desktop suite once.
   Fix actual failures, inspect final menu screenshot and finish documentation
   alignment (including the old-menu audit and current WSL limits).
2. Continue Linux live-process/lifecycle probes and Windows interoperability
   descendant validation. Current WSL supervisor covers same-user Linux descendants;
   privileged/sudo descendants require the pending root-supervisor decision.
3. Keep running-session structured follow-ups and optional MCP/App Server work on
   the original backlog. Do not mark the entire goal complete at this checkpoint.

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
