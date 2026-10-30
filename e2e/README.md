# End-to-end tests

These drive the real app: a debug build of qterm (own identifier `dev.qterm.e2e`, so it
never touches an installed qterm) is started for every test, Playwright attaches to its
WebView2 over the remote debugging port, and the tests type into real shells.

```
pnpm e2e                         # builds the test app (incremental), runs every spec
pnpm e2e e2e/seed.spec.ts        # one spec
QTERM_E2E_SKIP_BUILD=1 pnpm e2e  # skip the build when nothing in src-tauri changed
QTERM_E2E_DEBUG=1 pnpm e2e       # log the app's startup steps
```

Needs Windows with WebView2 and PowerShell 7 (`pwsh`). The Vite dev server is started
for you on port 1420 (or reused if it's already running). CI runs the same on GitHub
Actions (`.github/workflows/ci.yml`).

Writing a spec: read [RULES.md](RULES.md) and start from [seed.spec.ts](seed.spec.ts).
The harness is [qterm.ts](qterm.ts).

## Risks covered

Each risk crosses the app's boundaries (UI → Rust → ConPTY → shell → files) in a way
unit tests can't reproduce. One spec per risk.

| # | Risk | Spec |
|---|---|---|
| R1 | What you type in the console runs in its shell and the result shows up. | `seed.spec.ts` |
| R2 | After a split, input goes to the pane you typed in only, and closing it leaves the other working. | `split-panes.spec.ts` |
| R3 | A restart brings back the tab, the folder it was in and its earlier output. | `restore-session.spec.ts` |
| R4 | A long command that fails in a tab you aren't looking at marks that tab. | `long-command-alert.spec.ts` |
| R5 | A setting saved in the Settings panel reaches config.toml and applies to open terminals. | `settings.spec.ts` |
| R6 | A shell with its own background shows it in its panes, at the console's opacity; others keep the theme's. | `pane-background.spec.ts` |
| R7 | A background chosen for one pane colours that pane only and survives a restart. | `pane-background-picker.spec.ts` |
| R8 | Explorer's "Open in qterm" (registered from the setting) opens a tab in that folder in the qterm already running. | `open-here.spec.ts` |
| R9 | A command run in one shell can be typed again from the palette after a restart. | `recent-command.spec.ts` |
| R10 | Tabs saved as a named workspace open again after a restart, each shell in its folder. | `named-workspace.spec.ts` |
| R11 | Quick select labels what's on screen, and typing a label picks exactly that target (keys never reach the shell). | `quick-select.spec.ts` |
| R12 | The first start after an update shows what's new in that version, once. | `whats-new.spec.ts` |
| R13 | Claude Code's status line, relayed by qterm, brings the plan usage into the app. | `claude-statusline.spec.ts` |
| R14 | Claude stopping on an API error in a background tab marks that tab with the reason. | `claude-stop-failure.spec.ts` |
| R15 | A command's ✓/✗ bar opens that command's menu, and its actions (select output, run again) work on that command. | `command-block.spec.ts` |
| R16 | Searching Settings shows the matching settings and hides the rest; Esc clears the search before closing. | `settings-search.spec.ts` |
| R17 | A [[triggers]] pattern matching a line printed in a background tab marks that tab with the trigger and the line. | `output-trigger.spec.ts` |
| R18 | Settings kept in a folder of your choice apply live and after a restart. | `settings-folder.spec.ts` |
| R19 | Every setting stays inside its group's box in the Settings panel, and groups don't overlap. | `settings-layout.spec.ts` |
| R20 | Esc closes a menu or panel (Settings) opened while the keyboard is in a terminal, and doesn't reach the shell. | `menu-escape.spec.ts` |
| R21 | Closing a pane where a program still runs asks first and names it; an idle pane closes at once. | `close-confirm.spec.ts` |
| R22 | Ctrl+Shift+/ opens "Shortcuts and tips", showing the shortcuts in effect (a rebound one by its new keys). | `help-sheet.spec.ts` |
| R23 | When Claude finishes a turn in a pane, hovering its tab shows what it said last (Stop hook). | `claude-last-reply.spec.ts` |
| R24 | An idle Claude tab counts down to when its prompt cache goes cold, then says it's cold. | `claude-cache-countdown.spec.ts` |
| R25 | A package.json script picked from the palette runs in a new pane, in the project's folder. | `project-task.spec.ts` |
| R26 | A tab in a git repository shows its branch and changes on hover, updated after a command changes them. | `git-status.spec.ts` |
| R27 | A project's `.qterm.toml` names the tab and adds its snippets while a pane is inside it, and not after leaving. | `project-settings.spec.ts` |
| R28 | Pasting several lines into a shell runs nothing until confirmed. | `paste-warning.spec.ts` |
| R29 | Pasting with an image on the clipboard types the path of a PNG holding that image. | `image-paste.spec.ts` |
| R30 | A command's JSON output opens in the JSON viewer, and Copy on one value puts exactly that value on the clipboard. | `json-viewer.spec.ts` |
| R31 | F11 makes the console full size and back, and the terminal refits each time. | `console-size.spec.ts` |
| R32 | A dev server's address gives its tab an Open button, which goes as soon as the server stops. | `dev-server-link.spec.ts` |
| R33 | The palette names who listens on a port and in which pane; ending it frees the port and keeps the shell. | `port-owner.spec.ts` |
| R34 | A command's bar and the palette's recent commands say when it ran and how long it took. | `command-timing.spec.ts` |
| R35 | A pane split with another shell runs it in the same folder, panes name their shells while a tab mixes them, and switching a pane's shell keeps its place and folder. | `mixed-shells.spec.ts` |
| R36 | Codex response-item history appears in both All on this PC and Remembered, separate from Claude, and resumes in the current shell. | `codex.spec.ts` |
| R37 | Codex hook commands installed from Settings run in PowerShell and deliver context, plan usage, activity and replies. | `codex.spec.ts` |
| R38 | A quiet Claude/Codex process without lifecycle events shows unknown status, rather than idle; reported cache expiry remains visible. | `codex.spec.ts`, `claude-cache-countdown.spec.ts` |
| R39 | A failed workspace save stays visibly pending and retries the unchanged layout after the filesystem recovers. | `persistence-recovery.spec.ts` |
| R40 | The Codex session browser identifies unrecognized files and discovers a new session when refreshed. | `codex.spec.ts` |
| R41 | Local delivery probes for both providers reach the real inbox watcher without creating provider events, and health identifies the pane of a real hook. | `agent-health.spec.ts` |
| R42 | A Codex Stop shows completed, approval routing is explicitly unconfirmed input, and a subsequent submitted input invalidates that state; tooltips show the event source. | `codex.spec.ts` |
| R43 | A reviewed command-output brief opens either provider in the command's original folder; shell expressions in the request/output remain literal data. | `agent-handoff.spec.ts` |
| R44 | Reusing a busy source shell for an agent handoff is rejected without typing into its running program. | `agent-handoff.spec.ts` |
| R45 | A new agent handoff waits for an empty shell prompt rather than typing into a profile's startup program. | `agent-handoff.spec.ts` |
| R46 | Keyboard focus stays in the handoff preview, and Escape cancels without starting an agent. | `agent-handoff.spec.ts` |
| R47 | Provider attention remains separate by event; viewing does not resolve it, closing its pane does not remove it, and a restart retains it with its project and prior-run context. | `agent-inbox.spec.ts` |
| R48 | A failed inbox save visibly retries after the filesystem recovers without losing the event; unreadable saved history is preserved before recovery. | `agent-inbox-recovery.spec.ts` |
| R49 | Real TypeScript and Rust compiler failures appear with their source locations; editor links use the run's original folder, and a successful rerun supersedes only that command's older problems. | `problems.spec.ts` |
| R50 | Codex approval routing never creates a false unanswered question or desktop toast; repeated completion notifications are deduplicated, and test builds record attempted notifications without touching Windows notifications. | `codex-notifications.spec.ts` |
| R51 | A reviewed tracked check records before-run repository evidence, survives restart, and becomes stale when source changes. | `verification-staleness.spec.ts` |
| R52 | Source changes during a tracked check invalidate it even if the original bytes are restored before it ends. | `verification-during-run.spec.ts` |
| R53 | Failed command-history writes retain results and retry automatically; recovery preserves unreadable history before starting fresh. | `command-record-recovery.spec.ts` |
| R54 | Command records capture final output without a newline, with no prompt text mixed into it, and retain it after a restart. | `command-capture.spec.ts` |
| R55 | A worktree preview creates nothing; explicit creation preserves dirty source, opens its own agent in the correct checkout, retains task/check history after restart and never removes files when completed. | `worktree-task.spec.ts` |
| R56 | Failed worktree-history writes block creation until recovered, and unreadable history is backed up before recovery. | `worktree-recovery.spec.ts` |
| R57 | Explicit session grants expose only their project through the real CLI/pipe; revocation and app exit remove credentials and block further reads. | `agent-access.spec.ts` |
| R58 | Only separately granted named tasks launch through the CLI, in a new visible tab, with idempotent request IDs, requester attribution and retained results. | `agent-task-run.spec.ts` |
| R59 | Changed manifests or shell definitions invalidate task execution; revoking a grant while its new tab waits for a prompt prevents launch. | `agent-task-grant.spec.ts` |
| R60 | Revoking access leaves an accepted running task visible, and the developer can explicitly stop it without targeting another pane. | `agent-task-stop.spec.ts` |
| R61 | Reviewed tasks use the selected Command Prompt/Git Bash shell, preserve folder/requester and reported exit status, and leave that shell usable after targeted stop. | `agent-task-shells.spec.ts` |
| R62 | Explicitly reviewed recipe steps run in dependency order in their chosen layout, retain original results, and never replay after restart. | `recipe-order.spec.ts` |
| R63 | Service output readiness unlocks only its dependents; failures, unknown exits, timeouts and cancellation block pending steps without silently stopping unrelated programs. | `recipe-readiness.spec.ts` |
| R64 | Changing a reviewed recipe or its shell before a delayed step starts cancels that launch instead of running a substituted command. | `recipe-definition.spec.ts` |
| R65 | The session library separates provider/environment identities, filters reported metadata, retains pins across restart and labels missing sessions unavailable. | `session-library.spec.ts` |
| R66 | Session pin writes retry without another edit, and unreadable pin history is preserved until explicit backup recovery. | `session-library-recovery.spec.ts` |
| R67 | A reviewed session handoff exports bounded historical context and opens a chosen agent with literal file data, without executing hostile text or silently sharing excerpts. | `session-handoff.spec.ts` |
| R68 | Disabling provider history clears its library data and prevents further discovery, resume or handoff while retaining only explicit pin identities. | `session-library-retention.spec.ts` |
| R69 | An explicitly selected WSL distribution reports its real cwd, discovers Linux project settings/tasks without executing Git hooks/filters, and opens case-sensitive diagnostic files using the saved distribution context. | `wsl-project.spec.ts` |
| R70 | A restored WSL pane retains its original distribution and output; editing or removing its profile cannot launch another environment with the saved Linux folder. The user can explicitly switch the pane to recover. | `wsl-restore.spec.ts` |
| R71 | Windows/WSL folder transfers and pasted image paths use the selected distribution's actual filesystem mapping, including a Linux alias outside /mnt; the real shell can read the pasted PNG and transfer back to the original Windows folder. | `wsl-paths.spec.ts` |
| R72 | A clipboard image broadcast to mixed Windows and WSL shells is translated and quoted separately, arrives exactly once in each pane, and both real interpreters read the same PNG bytes without another pane's terminal protocol replies corrupting input. | `broadcast-files.spec.ts` |
| R73 | Switching from a Linux folder that Windows cannot represent reports the conversion error and preserves the original running pane instead of silently opening a profile's home. | `wsl-unrepresentable.spec.ts` |
| R74 | Named WSL transcript sources require explicit source and provider-history opt-in, keep native/WSL UUIDs separate, invalidate changed/disabled source context, and report unavailable distros without default fallback. | `wsl-sources.spec.ts` |
| R75 | Resuming a WSL library session uses its selected distribution, literal provider home and exact Linux project, without typing into the existing pane. | `wsl-resume.spec.ts` |
| R76 | A WSL session handoff delivers exactly the reviewed literal brief to its chosen provider in the selected distribution and project. | `wsl-session-handoff.spec.ts` |
| R77 | A pending WSL source launch is cancelled when its shell reaches a differently cased Linux folder or source access is revoked before the prompt. | `wsl-launch-guard.spec.ts` |
| R78 | A reviewed WSL output handoff preserves command context and literal brief bytes for either provider, in a new tab or the confirmed idle source shell. | `wsl-output-handoff.spec.ts` |
| R79 | A WSL output handoff cannot reuse a busy shell, a differently cased folder or a broadcasting pane; rejecting it leaves the existing program/input untouched. | `wsl-output-guard.spec.ts` |
| R80 | Each WSL pane owns its detached Linux descendants: closing one pane cleans only that tree, and normal app exit or a forced Windows crash cleans all owned trees while unrelated Linux processes survive. | `wsl-ownership.spec.ts` |
| R81 | The WSL ownership wrapper preserves real terminal input, Bash job control, Ctrl-C, pipeline signals, prompt/exit telemetry and terminal-size changes without consuming shell input. | `wsl-owned-terminal.spec.ts` |
| R82 | Fixed WSL control helpers ignore Python startup paths: opening a pane/project and discovering sources cannot execute a project's sitecustomize.py through inherited PYTHONPATH. | `wsl-control-isolation.spec.ts` |
| R83 | Provider menus separate colliding native/distribution UUIDs and folders; per-row/group forgetting removes only selected references, and native transcript rows resume natively. | `provider-menu-scope.spec.ts` |
| R84 | Legacy menu resume uses the verified distribution/home/folder for both providers, waits through a new shell's startup program and safely reuses an actual idle prompt. | `provider-menu-resume.spec.ts` |
| R85 | Disabling an already-discovered WSL source or selecting an unavailable distribution blocks remembered-menu resume without a fallback launch or cached source reuse. | `provider-menu-gates.spec.ts` |
| R86 | Fresh-session menu actions use their folder group's exact environment and profile configuration; a missing matching distribution cannot fall back to another shell. | `provider-menu-new.spec.ts` |

Claude Code itself isn't needed for R23 and R24: its hook and status line input is piped
in by hand, and a copy of Node named `claude.exe` (see `startFakeClaude` in `qterm.ts`)
stands in for it, so qterm sees Claude running in the pane.

Not covered here (unit tests or manual): the global hotkey and tray (OS input), Windows
notifications, Claude Code itself, administrator tabs (UAC can't be automated).
For R50, notification requests reach the native command and are recorded in the
isolated app's `notification-attempts.jsonl`; the E2E identifier returns before
Windows toast delivery or app-ID registration. This guard is always enabled for
test builds, including deliberate negative tests. Never disable it to test alert
policy: the user's desktop must not receive synthetic permission requests.
"Stop what runs in this pane" is covered by a Rust test on a real ConPTY
(`pty::tests::stopping_ends_the_program_and_keeps_the_shell`).
