# qterm

A quake-style drop-down terminal for Windows 11: the **~** key (left of 1) slides a
translucent console down from the top of the screen.

- Tabs and split panes for PowerShell, cmd, Git Bash and WSL; rename (double-click)
  and reorder (drag) tabs
- Copy/paste (right-click, Ctrl+Shift+C/V, optional copy on select), scrollback search
- Nine colour themes, adjustable size, opacity, font, slide speed; drag the console's
  bottom edge to change its height (double-click it for half the screen)
- Reopens your tabs and layout, each pane in the folder it was in
- Claude Code: remembers sessions (from `claude --resume <id>` in the output), grouped
  by folder, and resumes them from the ✳ menu; alerts you (Windows notification, ✳ on
  the tab) when Claude is waiting for you. Turn both on in Settings → Claude Code.
- Ctrl+click web links, and file references like `src/app.ts:42` to open them in your
  editor (VS Code by default)
- Command palette (Ctrl+Shift+P) for every action, tab, profile, layout, theme and
  Claude session
- Pane tools: zoom a pane, swap panes, type into all panes of a tab at once; dots and
  bells on background tabs that printed something
- Your own profiles (`[[profiles]]`: SSH hosts, dev servers, each with its own look) and
  named layouts (`[[layouts]]`, or "Save this tab as a layout")
- Claude Code: browse every session on the PC grouped by folder (with branch and
  prompt count), start a new one in a folder, see per tab whether Claude is working or
  idle
- Settings panel (⚙ or Ctrl+,), tray icon with "Start with Windows"

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

Settings: the ⚙ button, Ctrl+, or tray → **Settings…** open the settings panel. Everything
lives in `%APPDATA%\dev.qterm.app\config.toml`, which the panel edits for you (keeping its
comments); you can also edit the file directly. Changes apply when saved.

Design and roadmap: [docs/foundation.md](docs/foundation.md).

## Develop

Prerequisites: Node + pnpm, Rust (MSVC toolchain), Visual Studio C++ build tools.

```sh
pnpm install
pnpm tauri dev                     # run the app (tray icon → Quit to exit)
pnpm test                          # workspace + keybinding unit tests (Vitest)
cd src-tauri && cargo test         # PTY session and profile tests
pwsh scripts/smoke.ps1             # hotkey/window smoke check against the running app
```

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
