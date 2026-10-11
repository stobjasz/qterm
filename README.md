# qterm

A quake-style drop-down terminal for Windows 11: the **~** key (left of 1) slides a
translucent console down from the top of the screen. Tabs and split panes for PowerShell, cmd, Git Bash and WSL;
tray icon with "Start with Windows". Tauri 2 + xterm.js + ConPTY.

| Keys | Action |
|---|---|
| ~ | Show / hide (global; switch it off in the tray to type a backtick elsewhere) |
| Ctrl+Shift+T / Ctrl+Shift+1..9 | New tab (default / Nth profile) |
| Ctrl+Shift+W | Close tab |
| Ctrl+Tab / Ctrl+Shift+Tab | Next / previous tab |
| Ctrl+Alt+1..9 | Go to tab N |
| Alt+Shift+= / Alt+Shift+- | Split right / down |
| Alt+Arrow | Move focus between panes |
| Alt+Shift+Arrow / Alt+Shift+0 | Resize pane / equalize |

Settings: tray → **Settings…** opens `%APPDATA%\dev.qterm.app\config.toml`. Every
option is documented in the file, and changes apply when you save. Shortcuts can be
remapped in its `[keybindings]` table.

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
