# qterm

[![CI](https://github.com/stobjasz/qterm/actions/workflows/ci.yml/badge.svg)](https://github.com/stobjasz/qterm/actions/workflows/ci.yml)
[![Latest release](https://img.shields.io/github/v/release/stobjasz/qterm)](https://github.com/stobjasz/qterm/releases/latest)

A quake-style drop-down terminal for Windows 11: the **~** key (left of 1) slides a
translucent console down from the top of the screen.

How to use it, every feature and setting: **[User guide](docs/user-guide.md)**.

## Download

**Latest release: [qterm 0.2.2](https://github.com/stobjasz/qterm/releases/tag/v0.2.2)**:
[installer](https://github.com/stobjasz/qterm/releases/download/v0.2.2/qterm_0.2.2_x64-setup.exe) ·
[portable exe](https://github.com/stobjasz/qterm/releases/download/v0.2.2/qterm-0.2.2-portable-x64.exe) ·
[all releases](https://github.com/stobjasz/qterm/releases)

Two ways to run it:

- **`qterm_<version>_x64-setup.exe`**: installs for your user only (no administrator
  rights) into `%LOCALAPPDATA%\qterm`, with a Start menu entry and an
  uninstaller in Windows' Installed apps.
- **`qterm-<version>-portable-x64.exe`**: one file, nothing to install; put it in any
  folder and run it.

Both need Windows 11 (or Windows 10 with the WebView2 runtime). The files aren't
code-signed yet, so SmartScreen may say "Windows protected your PC" the first time:
click **More info**, then **Run anyway**. `SHA256SUMS` in the release lists their
checksums.

**Updates.** qterm checks GitHub for a newer release shortly after it starts and then
daily, and offers it in a banner, in the tray menu and in Settings → Updates. One click
saves your tabs and their output, updates and restarts. The installer updates itself in
place; the portable exe replaces itself. Every update is checked against qterm's signing
key before it runs. Settings → Updates → "Check for updates automatically" turns the
checks off.

- Tabs and split panes for PowerShell, cmd, Git Bash and WSL; rename (double-click)
  and reorder (drag) tabs
- Copy/paste (right-click, Ctrl+Shift+C/V, optional copy on select), scrollback search
- Drop files from Explorer on a pane to type their paths, quoted for its shell
- Command marks: a ✓/✗ bar per command (click it to copy or select its output, or run
  it again), Ctrl+↑/↓ between prompts, and a notification when a long command finishes
  while you're away
- Quick select (Alt+Shift+S): copy or open any link, file, folder, git hash or IP on
  screen by typing its label
- Recent commands and folders across panes in the palette; named workspaces (every tab
  saved under a name); save a pane's output as text or HTML
- "Open in qterm" in Explorer's folder menu (optional); pin the console open (📌)
- Search the output of every pane at once (Alt+Shift+F); snippets in the palette;
  inline images (sixel, iTerm, Kitty) and optional font ligatures
- Administrator tabs through Windows' sudo (Inline); settings export and import
- Nine colour themes, adjustable size, opacity, font, slide speed; drag the console's
  bottom edge to change its height (double-click it for half the screen)
- Reopens your tabs and layout, each pane in the folder it was in, with its earlier
  output (switchable per shell)
- Claude Code: remembers sessions (from `claude --resume <id>` in the output), grouped
  by folder, and resumes them from the ✳ menu; alerts you (Windows notification, ✳ on
  the tab) when Claude is waiting for you; each tab shows how full Claude's context is and
  an estimated cost. Turn them on in Settings → Claude Code. Tabs take the Claude
  session's title; Alt+Shift+W jumps to the next pane where Claude waits. Optionally,
  your plan's 5-hour / 7-day usage (warnings at 80% and 95%) through Claude Code's status
  line, and an alert when Claude stops on an API error (rate limit, overload).
- Ctrl+click web links, and file references like `src/app.ts:42` to open them in your
  editor (VS Code by default)
- Command palette (Ctrl+Shift+P) for every action, tab, profile, layout, theme and
  Claude session
- Pane tools: zoom a pane, swap panes, type into all panes of a tab at once; dots and
  bells on background tabs that printed something
- Your own profiles (`[[profiles]]`: SSH hosts, dev servers, each with its own look; or
  imported from Windows Terminal, Visual Studio's developer shells included) and
  named layouts (`[[layouts]]`, or "Save this tab as a layout")
- Claude Code: browse every session on the PC grouped by folder (with branch and
  prompt count), start a new one in a folder, see per tab whether Claude is working or
  idle
- Settings panel (⚙ or Ctrl+,) with search, tray icon with "Start with Windows"; settings
  can live in a folder of your choice (OneDrive) to share between PCs; a log file and
  "Copy diagnostics" for bug reports
- Output triggers (`[[triggers]]`): highlight a line, mark the tab or notify when output
  matches a pattern

| Keys | Action |
|---|---|
| ~ | Show / hide (global; switch it off in the tray to type a backtick elsewhere) |
| Ctrl+Shift+T / Ctrl+Shift+1..9 | New tab (default / Nth profile) |
| Ctrl+Shift+W | Close pane |
| Ctrl+Tab / Ctrl+Shift+Tab | Next / previous tab |
| Ctrl+Alt+1..9 | Go to tab N |
| Alt+Shift+= / Alt+Shift+- | Split right / down |
| Alt+Arrow | Move focus between panes |
| Alt+Shift+Arrow / Alt+Shift+0 | Resize pane / equalize |
| Ctrl+Shift+C / Ctrl+Shift+V | Copy / paste |
| Ctrl+Shift+F | Find in scrollback |
| Ctrl+, | Settings |
| Ctrl+Shift+P | Command palette |
| Alt+Shift+Z | Zoom the focused pane |
| Alt+Shift+B | Type into every pane of the tab |
| Alt+Shift+S | Quick select: copy (or Shift: open) what's on screen |
| Alt+Shift+W | Next pane where Claude waits |

Settings: the ⚙ button, Ctrl+, or tray → **Settings…** open the settings panel. Everything
lives in `%APPDATA%\dev.qterm.app\config.toml`, which the panel edits for you (keeping its
comments); you can also edit the file directly. Changes apply when saved.

Design notes: [docs/foundation.md](docs/foundation.md). What's planned:
[docs/roadmap.md](docs/roadmap.md) (done so far: [docs/roadmap-archive.md](docs/roadmap-archive.md)).

## Develop

Prerequisites: Node + pnpm, Rust (MSVC toolchain), Visual Studio C++ build tools.

```sh
pnpm install
pnpm tauri dev                     # run the app (tray icon → Quit to exit)
pnpm test                          # workspace + keybinding unit tests (Vitest)
cd src-tauri && cargo test         # PTY session and profile tests
pnpm e2e                           # end-to-end tests against the real app (see e2e/README.md)
pwsh scripts/smoke.ps1             # hotkey/window smoke check against the running app
```

CI (`.github/workflows/ci.yml`, Windows runner) runs the type checks, unit tests,
clippy, the Rust tests and the end-to-end tests on every push to master and every pull
request.

## Releasing

```sh
pwsh scripts/release.ps1 0.2.0     # sets the version, commits "release: v0.2.0", tags v0.2.0
git push origin master v0.2.0      # the tag starts .github/workflows/release.yml
```

The release workflow builds the portable exe and the NSIS installer, signs both for the
updater (the `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` repo
secrets; the public key is in `tauri.conf.json`), writes `latest.json` (the updater's
feed, `scripts/release-manifest.mjs`) and `SHA256SUMS`, and publishes the GitHub release.
Losing the private key means existing copies can't verify later updates; keep a backup.

With the `WINGET_TOKEN` secret set (a classic token with `public_repo`), the workflow
also submits the release to winget (`stobjasz.qterm`) as a pull request to
microsoft/winget-pkgs. The first version's manifests came from
`node scripts/winget-manifests.mjs <version>` (in `winget/`).

Inside qterm, `scripts/bench.ps1` measures output throughput.

## Portable build

```sh
pnpm build:portable
```

This produces `dist-portable/qterm-<version>-portable-x64.exe`, a single ~6 MB file to
copy anywhere and run. It needs only Windows 11, which already includes the WebView2
runtime. The newer ConPTY (Windows Terminal's console host) is embedded and extracted to
`%LOCALAPPDATA%\dev.qterm.app` on first run. `scripts/fetch-conpty.ps1` fetches it for
builds (`build:portable` runs it if needed); without it, builds use the ConPTY built into
Windows. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## License

[MIT](LICENSE). qterm embeds Microsoft's ConPTY, also MIT; see
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
