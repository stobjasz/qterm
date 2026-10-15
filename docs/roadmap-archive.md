# qterm roadmap: done

Finished and descoped items, as they were proposed, round by round, with what was
delivered. Open items are in [roadmap.md](roadmap.md); the design notes for each are in
[foundation.md](foundation.md). Status: ✅ done, ✖ descoped.

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
| 25 | **Pin the console open**: ignore hide-on-blur and stray hotkey presses for a while. | S | ✅ 📌 in the tab bar / palette; until unpinned or a restart |
| 26 | **Acrylic / Mica background blur** (Windows 11) instead of plain transparency. | S–M | ✅ `background_effect` = none / acrylic / mica |
| 32 | **A background colour per shell**: today every pane sits on the console's one background (the global theme at `opacity`), so a profile's `theme` changes text colours only. Needs the console to stop painting behind the panes (each pane paints its own, dividers and the tab bar keep the console's), because two translucent layers compound. See foundation.md §22. | M | ✅ `[[profiles]] background` (or a profile `theme`); the console paints around the terminal area, panes paint their own; foundation.md §24 |
| 28 | **Run a tab as administrator**. | L | ✅ through Windows' sudo set to Inline; otherwise an elevated window. Elevation itself untested here (sudo is off on the dev machine) |

### Robustness and release

| # | Feature | Effort | Status |
|---|---|---|---|
| 29 | **Log file** plus tray → "Open logs". | S | ✅ with #37: `logs\qterm.log`, tray and Settings → Open logs |
| 31 | **Settings export/import** for moving to another PC. | S | ✅ Settings footer: Export… / Import… |

## Round 3 (proposed 2026-10-12)

### Install and release

| # | Feature | Effort | Status |
|---|---|---|---|
| 33 | **The installed copy owns "Start with Windows"**: both builds share one autostart entry ("qterm") and each re-points it to itself on start, so a portable copy left running keeps it after an install (the installer's "Run qterm" only toggles the running portable copy). Installed copies always take the entry; a portable copy takes it only when it doesn't point at an installed qterm. | S | ✅ `install.rs`, also for the Explorer item (#36) |
| 35 | **"What's new" after an update**: the release notes (already in the update feed) shown once after the restart. | S | ✅ once per update, from GitHub; Settings → Updates shows it again; E2E R12 |
| 36 | **"Open in qterm" in Explorer's context menu**: a new tab in that folder, console shown. Registered by the installer; a setting for the portable exe. | S–M | ✅ one setting for both, `explorer_menu` (off); the uninstaller removes it; E2E R8 |
| 37 | **Diagnostics**: panics and errors into the log file (#29), plus "Copy diagnostics" (version, build, Windows, ConPTY, settings errors) for bug reports. | S | ✅ Settings → Copy diagnostics; panics and UI errors logged too |

### Claude Code

| # | Feature | Effort | Status |
|---|---|---|---|
| 39 | **Tabs named after their Claude session** (its first prompt or summary from the transcript) unless renamed by hand. | S | ✅ Claude Code titles the terminal itself while it runs; the tab now keeps the title after it exits and across restarts |
| 42 | **Waiting list**: every pane where Claude waits for you, in one popup, with a key to jump to the next one. | S | ✅ ✳ menu → Waiting for you, palette, Alt+Shift+W |

### Terminal

| # | Feature | Effort | Status |
|---|---|---|---|
| 43 | **Recent commands** (from the command marks of #18) across panes in the palette: run again here, or copy. | S–M | ✅ typed at the prompt (Enter is yours); `history.json`; E2E R9 |
| 44 | **Recent folders** (from shell integration's folder tracking) in the palette: a new tab there. | S | ✅ with #43 |
| 45 | **Quick select**: label every URL, path, git hash and IP on screen and copy or open one by its label, keyboard only. | M | ✅ Alt+Shift+S; Shift+label opens; E2E R11 |
| 46 | **Output triggers**: patterns in config that highlight a line, mark the tab or notify (e.g. "Compiled successfully", "error TS"). | M | ✅ `[[triggers]]`: text or regex; highlight, mark or notify; E2E R17 |
| 47 | **Save a pane's output** to a text or HTML file, or open it in the editor. | S | ✅ palette: Save pane output… / Open pane output in editor |

### The console window

| # | Feature | Effort | Status |
|---|---|---|---|
| 50 | **Named workspaces**: save and reopen a whole set of tabs (layouts cover one tab). | M | ✅ opened next to the open tabs; `workspaces.json`; E2E R10 |
| 49 | **Size toggle**: a key that switches the console between its height and full screen. | S | ✅ F11 (`toggle_size`): the whole work area and back; kept while hidden, a drag of the edge ends it; E2E R31 |

## Round 4 (proposed 2026-10-14)

### Claude Code

| # | Feature | Effort | Status |
|---|---|---|---|
| 51 | **Plan limits and exact usage**: relay Claude Code's status line data (an existing status line of your own keeps working) for the 5-hour / 7-day plan usage and reset times (tray, ✳ menu; warnings at 80% and 95%), and Claude Code's own context and cost figures instead of qterm's transcript estimate. | M | ✅ Settings → Claude Code → Plan limits and exact usage; ✳ menu, tray, warnings; E2E R13 |
| 52 | **Alert when Claude stops on an error** (StopFailure hook): rate limit, overload or billing, with the reason. Rare, unlike #14. | S | ✅ hook setup adds StopFailure (Update in Settings); the tab shows ! with the reason; E2E R14 |
| 54 | **Claude's last reply on hover** (Stop hook's last message): in the tab tooltip and the waiting list; no notification. | S | ✅ Stop hook (hook setup → Update); tab tooltip and the ✳ menu's waiting list; E2E R23 |
| 56 | **Cache-cold countdown** on idle Claude tabs (status line's prompt cache data): resuming after the cache expires costs more. | S | ✅ ⏱4m, then seconds, then “cold”, on idle Claude tabs (needs plan limits set up); E2E R24 |

### Terminal

| # | Feature | Effort | Status |
|---|---|---|---|
| 57 | **Command blocks**: click a command's ✓/✗ bar to select or copy its output, collapse long output, run it again. | M | ✅ copy / select output, copy command, run again; collapsing isn't possible in xterm.js; E2E R15 |
| 59 | **Search in Settings**: a filter box over the settings panel. | S | ✅ search box in the Settings header; Esc clears it first; E2E R16 |

### Windows and setup

| # | Feature | Effort | Status |
|---|---|---|---|
| 60 | **Import from Windows Terminal**: its profiles (command, start folder, colours) as qterm profiles. | S–M | ✅ settings, fragments, VS developer shells (vswhere); also fixed PowerShell profiles with -Command |
| 63 | **Settings in a folder of your choice** (OneDrive, a dotfiles repo) to keep PCs in sync. | S | ✅ Settings → Settings file; the folder's own settings win; falls back when unreachable; E2E R18 |

Also done outside the list: the Settings panel's groups are as tall as their content
(masonry layout, tall groups span more columns), so on a wide, short console every group
fits without scrolling (2026-10-14, not released yet).

## Usability review (2026-10-14)

Found by driving the app on a 5120x720 console, outside the roadmap:

- ✅ Esc didn't close menus and panels opened while the keyboard was in a terminal (tab
  and pane menus, a command's menu, Settings, Shortcuts and tips, What's new), and went
  to the shell instead; now they close and the shell never sees it. E2E R20.
- ✅ The tab bar's tools sat at the far right edge, thousands of pixels from the tabs on
  a wide console; they follow the tabs now.
- ✅ Closing a tab or pane where a program still runs asks first. E2E R21.
- ✅ "Shortcuts and tips" (Ctrl+Shift+/, the ? button) and a welcome on the first start.
  E2E R22.
- ✅ The palette with nothing typed: recent entries first, long lists only when typing.
- ✅ Settings marks what applies right away (⚡).
- ✅ "Claude is waiting" (tray, ✳ menu, palette, Alt+Shift+W) counts Claude only, not
  long-command or trigger marks.
- ✅ The tab's × has a tooltip.

## Round 5 (proposed 2026-10-14, for developers)

### Projects and tools

| # | Feature | Effort | Status |
|---|---|---|---|
| 64 | **Project tasks in the palette**: the scripts of the pane's project (package.json, Cargo, Makefile, justfile, composer.json, pyproject), run in a new split beside it. | M | ✅ palette “Project task”: package.json (pnpm / yarn / bun / npm), Cargo, Makefile, justfile, composer.json, pyproject; a split beside, in the manifest's folder; E2E R25 |
| 65 | **Git status per tab**: branch, uncommitted changes, ahead/behind for the pane's folder, in the tab tooltip and the palette; refreshed after each command. | S–M | ✅ tab tooltip and its palette entry: `main · 3 changed, 1 new · ↑2 ↓1`; re-read after each command and Claude reply; E2E R26 |
| 66 | **Project settings** (`.qterm.toml` in a repo): tab name, colour and icon, snippets and triggers that apply in panes inside that project. | M | ✅ `.qterm.toml` (here or any folder above): `name`, `tab_color`, `icon`, `[[snippets]]`, `[[triggers]]`; nothing runs by itself; E2E R27 |

### Output and processes

| # | Feature | Effort | Status |
|---|---|---|---|
| 69 | **Dev server links**: a "Local: http://localhost:5173" in the output becomes an "Open" button on the tab while the server runs. | S | ✅ ↗port button on the tab and a “Dev server” palette entry, while the port is listened on (gone at once when the server stops); E2E R32 |
| 70 | **Stop what runs in a pane**: end the running program and everything it started (when Ctrl+C isn't enough), keeping the shell. | S | ✅ palette “Stop what runs in this pane” (`stop_programs`): the process tree under the shell, children first; Rust test on a real ConPTY |
| 71 | **Who uses this port?**: the palette names the process listening on a port, with its pane if it's one of qterm's, and can end it. | S | ✅ palette “Port” entries (type “port 3000”): process, its pane, Go to its pane / End (with what it started); E2E R33 |
| 73 | **Command timestamps and durations**: when each command ran and how long it took, on its ✓/✗ bar and in recent commands. | S | ✅ bar tooltip and menu (“14:32:05 · took 3s”), recent commands in the palette; E2E R34 |

### Safety and convenience

| # | Feature | Effort | Status |
|---|---|---|---|
| 74 | **Multi-line paste warning**: pasting several lines into a shell asks first (they would run one by one); off for Claude Code panes, where multi-line input is normal. | S | ✅ asks with a preview (`paste_warning`, on); not in Claude Code or full-screen programs; E2E R28 |
| 75 | **Paste an image as a file**: an image on the clipboard is saved to a temp file and its path typed, for Claude Code and other tools that read images from paths. | S | ✅ PNG in `%TEMP%\qterm-images` (a week), its path typed for the pane's shell; E2E R29 |
| 76 | **JSON viewer**: select JSON in the output (or a command's whole output) and see it formatted and foldable, with copy of any value. | M | ✅ selection or last output (`view_json`), or a command's bar → View output as JSON; JSON Lines and log prefixes too; E2E R30 |

## Round 6 (proposed 2026-10-15)

| # | Feature | Effort | Status |
|---|---|---|---|
| 78 | **Different shells in one tab**: split with a chosen shell (▾ menu, palette, a key with a picker), the folder carried over between Windows, Git Bash and WSL; switch a pane to another shell; panes name their shell when a tab mixes them. | S–M | ✅ Ctrl+Alt+Shift+= / -, ▾ split buttons, palette; Switch shell… in the pane menu; labels in mixed tabs; E2E R35 |

