# qterm roadmap

Feature ideas collected along the way. The original milestones (M0 to M6) and what each
delivered are in [foundation.md](foundation.md). Status: ✅ done, 🚧 in progress, ⬜ open, ✖ descoped.

Effort: S = small, M = medium, L = large.

## Round 1 (proposed 2026-10-11)

### Claude Code

| # | Feature | Status |
|---|---|---|
| 1 | **"Claude needs you" alerts.** Catch Claude Code's notification output (terminal bell, or OSC 9 / OSC 777 / OSC 99 notifications), then show a Windows notification and mark the tab and the tray. Clicking it brings up the console on that tab, so you can keep the console hidden while Claude works. | ✅ via Claude Code's Notification hook (one-click setup in Settings), see foundation.md §17 |
| 2 | **Browse every Claude session**, not only the ones qterm saw: read all of `~/.claude/projects`, grouped by folder, with git branch, message count and last prompt. Add a "New Claude session here" action per folder. | ✅ ✳ menu → "All on this PC"; + per folder |
| 3 | **Claude status per tab**: show which panes run Claude Code and whether it is busy or waiting for you. | ✅ claude.exe in the pane's process tree; busy = recent output; waiting = alert |

### Terminal

| # | Feature | Status |
|---|---|---|
| 4 | **Quick wins**: Unicode 11 character widths (emoji and symbols, which Claude Code's UI uses heavily), clickable web links, and Ctrl+click on `file.ts:42` to open that line in VS Code. | ✅ |
| 5 | **Command palette** (Ctrl+Shift+P): fuzzy search over every action, profile and Claude session. | ✅ also tabs, themes, layouts |
| 6 | **Activity dots** on background tabs when they print output or ring the bell. | ✅ |
| 7 | **Named layouts / workspaces**, e.g. "dev" = 3 panes in a folder with start commands, opened from a menu. | ✅ `[[layouts]]`, ▾ menu, palette, "Save this tab as a layout" |
| 8 | **Custom profiles in config**: SSH hosts, `npm run dev` in a folder, per-profile colours and font. | ✅ `[[profiles]]` |
| 9 | **Pane tools**: zoom a pane temporarily, swap panes, type into all panes of a tab at once (broadcast input). | ✅ Alt+Shift+Z, Alt+Shift+B, swap via palette |
| 10 | **Scrollback across restarts**: restored tabs show their previous output, as Windows Terminal can. | ✅ `[scrollback]`, switchable per shell; restored output stays in view; prompt-only panes skipped; clearing per pane or all (foundation.md §19, §20a–c) |

### Robustness and release

| # | Feature | Status |
|---|---|---|
| 11 | **Automated E2E suite in CI**: turn the Playwright-over-CDP checks used during development into committed tests that run on GitHub Actions (Windows runner). | ✅ `e2e/` (5 risk-tied specs) + `.github/workflows/ci.yml`, see foundation.md §23 |
| 12 | **Job Objects**: shells are killed if qterm crashes (planned in M6). | ✅ already guaranteed by ConPTY (verified); locked in by a regression test instead of a Job Object, see foundation.md §19 |
| 13 | **Installer and auto-update** (NSIS + Tauri updater, M6). | ✅ Per-user NSIS installer and portable exe, published by `release.yml` on a version tag with a signed `latest.json` on GitHub Releases. Checks on start and daily (switchable); banner, tray and Settings offer one-click update; the portable exe replaces itself. Tested locally end to end (update and a tampered download). v0.2.0, the first public release, published 2026-10-12. |

Also done outside the list: file drag and drop from Explorer, with paths quoted per shell
(foundation.md §20); autostart limited to release builds and re-pointed on launch (§15).

## Round 2 (proposed 2026-10-12)

### Claude Code

| # | Feature | Effort | Status |
|---|---|---|---|
| 14 | **Alert when Claude finishes**: hook Claude Code's Stop event for an instant ✳ and notification when a reply ends and you're not looking at that pane. (Today's Notification hook fires only for permission prompts, rare in auto mode, and after 60 s idle.) | S | ✖ descoped 2026-10-12: a notification after every reply would be too many |
| 15 | **Bring Claude sessions back after a restart**: panes that were running Claude reopen with `claude --resume <id>` typed for you (opt-in). | M | ✅ `claude_restore` (off by default); also "here" to resume a saved session in the current tab |
| 16 | **"Ask Claude about this"**: select an error, then a palette action opens a pane in that folder with `claude "<selection>"`. | S | ⬜ |
| 17 | **Context and cost per tab**: token use read from the session's transcript, shown in the tab tooltip and the ✳ menu. | M | ✅ context % on the tab, details in its tooltip, "Running now" in the ✳ menu; SessionStart hook maps panes to sessions |

### Terminal

| # | Feature | Effort | Status |
|---|---|---|---|
| 18 | **Command marks** (OSC 133 from the shell integration): jump between commands, copy the last command's output, ✓/✗ per exit code. | M | ✅ PowerShell, Git Bash (exit codes), cmd (no exit codes); Ctrl+↑/↓ |
| 19 | **"Long command finished" notifications** for commands over N seconds while you're not looking (needs #18). | S | ✅ `long_command_alert` (default 30 s) |
| 20 | **Snippets**: named commands in config (`[[snippets]]`), run from the palette into the current pane. | S | ✅ |
| 21 | **Search across all panes**, restored output included. | M | ✅ Alt+Shift+F |
| 22 | **SSH quick-connect**: profiles from `~/.ssh/config`. | S | ✅ `ssh_profiles` (on); concrete Host names only |
| 23 | **Inline images (sixel) and font ligatures** (xterm.js add-ons). | S–M | ✅ sixel/iTerm/Kitty images (on), ligatures (off; needs e.g. Cascadia Code) |
| 24 | **Tab colours and icons**, per tab or per profile. | S | ✅ right-click a tab; `tab_color` / `icon` in [[profiles]] |

### The console window

| # | Feature | Effort | Status |
|---|---|---|---|
| 25 | **Pin the console open**: ignore hide-on-blur and stray hotkey presses for a while. | S | ⬜ |
| 26 | **Acrylic / Mica background blur** (Windows 11) instead of plain transparency. | S–M | ✅ `background_effect` = none / acrylic / mica |
| 27 | **A second console on its own hotkey** (scratch console, or docked bottom/side). | M | ⬜ |
| 32 | **A background colour per shell**: today every pane sits on the console's one background (the global theme at `opacity`), so a profile's `theme` changes text colours only. Needs the console to stop painting behind the panes (each pane paints its own, dividers and the tab bar keep the console's), because two translucent layers compound. See foundation.md §22. | M | ✅ `[[profiles]] background` (or a profile `theme`); the console paints around the terminal area, panes paint their own; foundation.md §24 |
| 28 | **Run a tab as administrator**. | L | ✅ through Windows' sudo set to Inline; otherwise an elevated window. Elevation itself untested here (sudo is off on the dev machine) |

### Robustness and release

| # | Feature | Effort | Status |
|---|---|---|---|
| 29 | **Log file** plus tray → "Open logs". | S | ✅ with #37: `logs\qterm.log`, tray and Settings → Open logs |
| 30 | **Publish to winget** (after #13). | S | ⬜ |
| 31 | **Settings export/import** for moving to another PC. | S | ✅ Settings footer: Export… / Import… |

## Round 3 (proposed 2026-10-12)

### Install and release

| # | Feature | Effort | Status |
|---|---|---|---|
| 33 | **The installed copy owns "Start with Windows"**: both builds share one autostart entry ("qterm") and each re-points it to itself on start, so a portable copy left running keeps it after an install (the installer's "Run qterm" only toggles the running portable copy). Installed copies always take the entry; a portable copy takes it only when it doesn't point at an installed qterm. | S | ✅ `install.rs`, also for the Explorer item (#36) |
| 34 | **Code signing** (e.g. Azure Trusted Signing) in `release.yml`, so SmartScreen stops warning on first run. | S + cost | ⬜ |
| 35 | **"What's new" after an update**: the release notes (already in the update feed) shown once after the restart. | S | ⬜ |
| 36 | **"Open in qterm" in Explorer's context menu**: a new tab in that folder, console shown. Registered by the installer; a setting for the portable exe. | S–M | ✅ one setting for both, `explorer_menu` (off); the uninstaller removes it; E2E R8 |
| 37 | **Diagnostics**: panics and errors into the log file (#29), plus "Copy diagnostics" (version, build, Windows, ConPTY, settings errors) for bug reports. | S | ✅ Settings → Copy diagnostics; panics and UI errors logged too |
| 38 | **ARM64 build** next to x64 (Windows on Snapdragon). | S–M | ⬜ |

### Claude Code

| # | Feature | Effort | Status |
|---|---|---|---|
| 39 | **Tabs named after their Claude session** (its first prompt or summary from the transcript) unless renamed by hand. | S | ✅ Claude Code titles the terminal itself while it runs; the tab now keeps the title after it exits and across restarts |
| 40 | **New Claude session in a git worktree**: `git worktree add` on a new branch, then a pane there running `claude`, for parallel tasks in one repo. | M | ⬜ |
| 41 | **Usage overview**: tokens and estimated cost per day and per project across all sessions (the per-tab figures from #17, summed). | M | ⬜ |
| 42 | **Waiting list**: every pane where Claude waits for you, in one popup, with a key to jump to the next one. | S | ✅ ✳ menu → Waiting for you, palette, Alt+Shift+W |

### Terminal

| # | Feature | Effort | Status |
|---|---|---|---|
| 43 | **Recent commands** (from the command marks of #18) across panes in the palette: run again here, or copy. | S–M | ✅ typed at the prompt (Enter is yours); `history.json`; E2E R9 |
| 44 | **Recent folders** (from shell integration's folder tracking) in the palette: a new tab there. | S | ✅ with #43 |
| 45 | **Quick select**: label every URL, path, git hash and IP on screen and copy or open one by its label, keyboard only. | M | ✅ Alt+Shift+S; Shift+label opens; E2E R11 |
| 46 | **Output triggers**: patterns in config that highlight a line, mark the tab or notify (e.g. "Compiled successfully", "error TS"). | M | ⬜ |
| 47 | **Save a pane's output** to a text or HTML file, or open it in the editor. | S | ✅ palette: Save pane output… / Open pane output in editor |
| 48 | **Accessibility**: screen reader mode (xterm.js) and a minimum-contrast setting. | S | ⬜ |

### The console window

| # | Feature | Effort | Status |
|---|---|---|---|
| 49 | **Size toggle**: a key that switches the console between its height and full screen. | S | ⬜ |
| 50 | **Named workspaces**: save and reopen a whole set of tabs (layouts cover one tab). | M | ✅ opened next to the open tabs; `workspaces.json`; E2E R10 |

Suggested next: #30 (winget) and #35 ("What's new" after an update), then #16 and #25.
