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

Claude Code itself isn't needed for R23 and R24: its hook and status line input is piped
in by hand, and a copy of Node named `claude.exe` (see `startFakeClaude` in `qterm.ts`)
stands in for it, so qterm sees Claude running in the pane.

Not covered here (unit tests or manual): the global hotkey and tray (OS input), Windows
notifications, Claude Code itself, administrator tabs (UAC can't be automated).
"Stop what runs in this pane" is covered by a Rust test on a real ConPTY
(`pty::tests::stopping_ends_the_program_and_keeps_the_shell`).
