# qterm roadmap

Feature ideas collected along the way. The original milestones (M0 to M6) and what each
delivered are in [foundation.md](foundation.md). Status: ✅ done, 🚧 in progress, ⬜ open.

Proposed on 2026-10-11, after the Claude session grouping was finished.

## Claude Code

| # | Feature | Status |
|---|---|---|
| 1 | **"Claude needs you" alerts.** Catch Claude Code's notification output (terminal bell, or OSC 9 / OSC 777 / OSC 99 notifications), then show a Windows notification and mark the tab and the tray. Clicking it brings up the console on that tab, so you can keep the console hidden while Claude works. | ✅ via Claude Code's Notification hook (one-click setup in Settings), see foundation.md §17 |
| 2 | **Browse every Claude session**, not only the ones qterm saw: read all of `~/.claude/projects`, grouped by folder, with git branch, message count and last prompt. Add a "New Claude session here" action per folder. | ✅ ✳ menu → "All on this PC"; + per folder |
| 3 | **Claude status per tab**: show which panes run Claude Code and whether it is busy or waiting for you. | ✅ claude.exe in the pane's process tree; busy = recent output; waiting = alert |

## Terminal

| # | Feature | Status |
|---|---|---|
| 4 | **Quick wins**: Unicode 11 character widths (emoji and symbols, which Claude Code's UI uses heavily), clickable web links, and Ctrl+click on `file.ts:42` to open that line in VS Code. | ✅ |
| 5 | **Command palette** (Ctrl+Shift+P): fuzzy search over every action, profile and Claude session. | ✅ also tabs, themes, layouts |
| 6 | **Activity dots** on background tabs when they print output or ring the bell. | ✅ |
| 7 | **Named layouts / workspaces**, e.g. "dev" = 3 panes in a folder with start commands, opened from a menu. | ✅ `[[layouts]]`, ▾ menu, palette, "Save this tab as a layout" |
| 8 | **Custom profiles in config**: SSH hosts, `npm run dev` in a folder, per-profile colours and font. | ✅ `[[profiles]]` |
| 9 | **Pane tools**: zoom a pane temporarily, swap panes, type into all panes of a tab at once (broadcast input). | ✅ Alt+Shift+Z, Alt+Shift+B, swap via palette |
| 10 | **Scrollback across restarts**: restored tabs show their previous output, as Windows Terminal can. | ✅ `[scrollback]`, switchable per shell |

## Robustness and release

| # | Feature | Status |
|---|---|---|
| 11 | **Automated E2E suite in CI**: turn the Playwright-over-CDP checks used during development into committed tests that run on GitHub Actions (Windows runner). | ⬜ |
| 12 | **Job Objects**: shells are killed if qterm crashes (planned in M6). | ✅ already guaranteed by ConPTY (verified); locked in by a regression test instead of a Job Object, see foundation.md §19 |
| 13 | **Installer and auto-update** (NSIS + Tauri updater, M6). | ⬜ |

Suggested order: 11 (E2E in CI) before 13 (installer); the rest as wanted.
