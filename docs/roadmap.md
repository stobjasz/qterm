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
| 13 | **Installer and auto-update** (NSIS + Tauri updater, M6). Designed: Tauri updater with signed `latest.json` for the installer; the portable exe either self-replaces or only announces updates. Waiting on two choices: where releases are hosted (a private repo's assets need a token, so a public releases-only repo, the user's `gh` login, or other hosting), and the portable exe's behaviour. | ⬜ |

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
| 29 | **Log file** plus tray → "Open logs". | S | ⬜ |
| 30 | **Publish to winget** (after #13). | S | ⬜ |
| 31 | **Settings export/import** for moving to another PC. | S | ✅ Settings footer: Export… / Import… |

Suggested next: #29 (log file), then #13 (installer and auto-update), now that CI tests every push.
