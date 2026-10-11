# qterm

A quake-style drop-down terminal for Windows 11: **Ctrl+`** slides a translucent
console down from the top of the screen. Tauri 2 + xterm.js + ConPTY.

Design and roadmap: [docs/foundation.md](docs/foundation.md).

## Develop

Prerequisites: Node + pnpm, Rust (MSVC toolchain), Visual Studio C++ build tools.

```sh
pnpm install
pnpm tauri dev                     # run the app (tray icon → Quit to exit)
cd src-tauri && cargo test         # PTY session tests
pwsh scripts/smoke.ps1             # hotkey/window smoke check against the running app
```

Inside qterm, `scripts/bench.ps1` measures output throughput.
