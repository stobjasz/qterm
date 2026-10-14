# qterm — technical foundation

A quake-style drop-down terminal for Windows 11: a hotkey slides a semi-transparent
console down from the top of the screen. It starts with Windows, lives in the tray,
supports tabs, and splits each tab into panes (e.g. 3 shells side by side).

Status: M0–M6 and the feature rounds done (§11–30; v0.2.2 released 2026-10-14). What's
next: [roadmap.md](roadmap.md); what's done: [roadmap-archive.md](roadmap-archive.md).

---

## 1. Requirements

| # | Requirement | Notes |
|---|---|---|
| R1 | Global hotkey toggles the console from any app | Default **Ctrl+`**; bare `` ` ``/`~` as an opt-in mode (see §6) |
| R2 | Slides in at the top of the current monitor, semi-transparent | Height % and opacity configurable |
| R3 | Starts with Windows, always available | Tray icon, single instance, no taskbar entry |
| R4 | Tabs, each with its own shell(s) | pwsh, Windows PowerShell, cmd, WSL, Git Bash profiles |
| R5 | Split panes, N-way (3 columns side by side) | Nested horizontal/vertical splits, keyboard focus nav, drag resize |
| R6 | Real terminal fidelity | VT sequences, 24-bit color, mouse, Unicode/emoji, IME, fast output |

Non-goals for v1: session restore of running processes, SSH manager, plugin system,
macOS/Linux.

---

## 2. Stack decision

**Recommended: Tauri 2 (Rust) + xterm.js (WebGL renderer) + `portable-pty` (ConPTY).**

| Option | Verdict | Why |
|---|---|---|
| **Tauri 2 + xterm.js + portable-pty** | ✅ Chosen | Small footprint for an always-running app (uses the OS's WebView2 instead of bundling Chromium). Rust gives direct Win32 access (hotkeys, keyboard hook, `SetWindowPos`, DWM effects) via the `windows` crate. Official plugins cover global shortcut, autostart, single instance, tray. xterm.js is the terminal engine behind VS Code. `portable-pty` is WezTerm's PTY layer over ConPTY. |
| Electron + xterm.js + node-pty | Fallback | Most proven path (Tabby, VS Code, Hyper — Tabby already has a quake dock). All TypeScript. Costs: higher idle RAM and a large installer for something that runs 24/7, and Win32 tweaks need native addons or FFI. Pick this if you don't want Rust. |
| .NET WPF + Windows Terminal's WPF control (`EasyWindowsTerminalControl` / `CI.Microsoft.Terminal.Wpf`) | ❌ Rejected | The real Windows Terminal renderer, but the control **does not support transparency** — it is its own HWND, so only whole-window alpha (text fades with the background) is possible. It also depends on beta packages that Microsoft doesn't officially publish. Fails R2. |
| Fork WezTerm / Alacritty | ❌ Rejected | Excellent GPU terminals, but a large codebase to own just to add window behaviour. |
| Own renderer (Direct2D/DirectWrite) | ❌ Rejected | Months of work to reach xterm.js fidelity (R6). |

Frontend: **TypeScript + Vite + React** (a small store such as Zustand for tab/layout state).
Any framework works; React is chosen for ecosystem and agent-friendliness. See §5.3 for
the one rule that matters: framework re-renders must never recreate a terminal.

---

## 3. Architecture

```
┌──────────────────────────── qterm.exe (Rust, Tauri 2) ──────────────────────────────┐
│                                                                                     │
│  HotkeyService ──toggle──▶ QuakeWindowController ──SetWindowPos / show / focus──┐   │
│  (RegisterHotKey or            (slide anim, monitor pick,                       │   │
│   WH_KEYBOARD_LL hook)          topmost, hide-on-blur)                          ▼   │
│                                                                        ┌──────────┐ │
│  Tray + Autostart + SingleInstance                                     │ WebView2 │ │
│                                                                        │  (UI)    │ │
│  ConfigService (%APPDATA%\qterm\config.json, hot reload) ──event──▶    │          │ │
│                                                                        │ tabs     │ │
│  SessionManager ── HashMap<SessionId, Session>                         │ split    │ │
│     Session = ConPTY master + child process + reader thread            │ tree     │ │
│          │  output bytes ──(tauri::ipc::Channel, raw ArrayBuffer)──▶   │ xterm.js │ │
│          ◀── pty_write / pty_resize (invoke) ─────────────────────────│ ×N       │ │
│                                                                        └──────────┘ │
└──────────────────────┬──────────────────────────────────────────────────────────────┘
                       │ ConPTY (conpty.dll / kernel32)
                 pwsh.exe   cmd.exe   wsl.exe   bash.exe   … (in a Job Object)
```

**Ownership rule:** Rust owns processes, windows and OS integration. The frontend owns
tabs, layout and terminal rendering. A pane holds a `sessionId`; closing a pane asks Rust
to kill that session. The PTY never knows about panes.

---

## 4. Backend (Rust) design

### 4.1 Window (`window/`)
One main window, created hidden at startup:

```jsonc
// tauri.conf.json → app.windows[0]
{ "label": "quake", "visible": false, "decorations": false, "transparent": true,
  "alwaysOnTop": true, "skipTaskbar": true, "resizable": false, "shadow": false }
```

`QuakeWindowController`:
- **Show:** pick the monitor under the mouse cursor (configurable: primary or
  monitor-with-focus). Compute rect = work area × width% × height%. Place the window
  there **once**, show and focus it, and emit `quake-visibility`. The UI then slides the
  content in with a CSS `transform` (150 ms, ease-out). *(Decided in M0: moving the
  native window every frame stutters with acrylic and can land on a monitor stacked
  above.)*
- **Hide:** emit `quake-visibility {visible:false}`, so the UI slides the content out.
  Rust calls `hide()` after the slide time on its own timer, so a hung webview can't
  keep the window on screen.
- **Focus stealing:** `SetForegroundWindow` only works if Windows thinks the process may
  take focus. The process that receives `WM_HOTKEY` is allowed; a low-level hook path
  may not be. Fallback: `AttachThreadInput` to the foreground thread or a synthetic
  Alt press. Must be tested in the S3 spike.
- **Optional:** hide on blur (`WindowEvent::Focused(false)`), off by default.
- DPI: Tauri is per-monitor-v2 aware. Recompute the rect on every show so
  monitor/DPI/taskbar changes are picked up.

### 4.2 Transparency
- Base: transparent window + CSS `rgba` background + xterm.js `allowTransparency: true`
  with a theme background of `rgba(r,g,b,a)` where `a = opacity`.
- Optional blur: `window-vibrancy` crate (`apply_acrylic` / `apply_mica` /
  `apply_blur`). Its README warns acrylic lags while a window is **moved or resized** on
  Win10 1903+ / Win11 22000, and blur lags on Win11 22621+. Moving is exactly what our
  slide animation does. So the default is plain alpha, and acrylic is an opt-in setting
  (or animate with no blur, then apply it). Mica is not see-through (it tints with the
  wallpaper), so it doesn't meet the "semi-transparent" look.

### 4.3 Hotkey (`hotkey/`)

> **Superseded in M4 (§14):** by request, the console key is a single bare key
> (default `~`), registered with `RegisterHotKey`, plus a tray switch to turn it off
> when you need to type that key elsewhere. The table below is the original plan.
Two backends behind one trait:

| Mode | Mechanism | Trade-off |
|---|---|---|
| `combo` (default) | `tauri-plugin-global-shortcut` (→ `RegisterHotKey`) | Rock solid. Fails if another app already registered the same combo, so report that in the tray and a toast. Bind by scan code (`sc 0x29`, the key left of `1`) so it works on PL/DE/US layouts. |
| `tilde` (opt-in) | Own `WH_KEYBOARD_LL` hook on a dedicated message-loop thread | Lets the bare `` ` `` key work **without** breaking typing elsewhere, using a double-tap: hold back the first press for ~250 ms. A second press in that window toggles the console; otherwise replay the press with `SendInput`. Typing a single backtick is delayed slightly, and typing ``` `` ``` quickly would toggle. |

Important: PowerShell uses `` ` `` as its escape character and bash uses backticks, so
the hide key **inside** the console must not swallow a plain backtick either. In `tilde`
mode, hiding also uses the double-tap.

### 4.4 PTY sessions (`pty/`)

```rust
struct Session {
    master: Box<dyn portable_pty::MasterPty + Send>,
    writer: Box<dyn std::io::Write + Send>,
    child:  Box<dyn portable_pty::Child + Send + Sync>,
}
struct SessionManager { sessions: Mutex<HashMap<SessionId, Session>>, job: JobHandle }
```

IPC contract (Tauri commands and events):

| Call | Direction | Payload |
|---|---|---|
| `pty_spawn(profileId, cols, rows, cwd?, onOutput: Channel)` → `SessionId` | UI → Rust | Spawns the shell and starts the reader thread |
| `pty_write(id, data: string)` | UI → Rust | Keystrokes / paste (UTF-8) |
| `pty_resize(id, cols, rows)` | UI → Rust | After fit-addon recalculation, debounced |
| `pty_kill(id)` | UI → Rust | Pane closed |
| `onOutput` channel | Rust → UI | Raw bytes as `ArrayBuffer` (`tauri::ipc::Response`), no JSON/base64 cost |
| event `pty-exit {id, code}` | Rust → UI | The shell exited, so the UI closes or marks the pane |
| event `quake-visibility {visible}` | Rust → UI | UI focuses the active pane / pauses the cursor blink |
| `get_config` / event `config-changed` | both | Hot-reloaded settings |

Details that matter:
- **Output batching:** the reader thread reads up to 64 KB at a time and sends a chunk
  when it has ≥16 KB or after 4–8 ms, whichever comes first. This keeps `dir /s` or
  `cat bigfile` from flooding IPC. `term.write(Uint8Array)` handles UTF-8 sequences
  split across chunks.
- **Backpressure:** if the UI falls behind (window hidden, huge output), use xterm's
  `write(data, callback)` to track pending bytes. Over a high-water mark, the UI sends
  `pty_pause(id)` and the reader thread stops reading, so ConPTY blocks the child.
- **Orphan protection:** put every child in a Job Object with
  `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`, so shells die if qterm crashes.
- **Newer ConPTY:** the ConPTY built into Windows lags behind Windows Terminal's. Microsoft
  now publishes `conpty.dll` + `OpenConsole.exe` as the NuGet package
  `Microsoft.Windows.Console.ConPTY`. Shipping them next to the exe (as WezTerm does)
  gives Windows Terminal-level behaviour. *Verify in S2 that `portable-pty` loads the
  local `conpty.dll` before falling back to kernel32.*
- **Profiles:** auto-detect pwsh 7, Windows PowerShell, cmd, Git Bash, and WSL distros
  (`wsl.exe -l -q`), like Windows Terminal does. Each profile has `commandline`,
  `startingDirectory`, `env`, `icon`.

### 4.5 App shell
- `tauri-plugin-single-instance`: a second launch only toggles the existing window.
- `tauri-plugin-autostart`: HKCU `Run` key, no admin needed. Launched with
  `--background` so nothing is shown at login. Release builds only (see §15).
- Tray (Tauri `tray-icon` feature): Show/Hide, New tab, Settings (opens `config.json`),
  Start with Windows ✓, Quit.
- `ConfigService`: `%APPDATA%\qterm\config.json`, validated with serde, watched with the
  `notify` crate, and a `config-changed` event pushes changes to the UI. JSON schema
  shipped for editor autocomplete.

---

## 5. Frontend (TypeScript) design

### 5.1 State model

```ts
type PaneId = string; type SessionId = string;

type LayoutNode =
  | { kind: 'leaf';  pane: PaneId }
  | { kind: 'split'; dir: 'row' | 'column'; children: LayoutNode[]; sizes: number[] }; // sizes sum to 1

interface Pane { id: PaneId; sessionId: SessionId; profileId: string; title: string }
interface Tab  { id: string; title?: string; root: LayoutNode; focusedPane: PaneId }
interface AppState { tabs: Tab[]; activeTab: string; panes: Record<PaneId, Pane> }
```

**N-ary splits, not binary:** splitting in the same direction as the parent adds a
sibling and re-divides space evenly. Three vertical splits therefore give three equal
columns (R5), not 50/25/25. Splitting across directions nests a new split node.

### 5.2 Layout operations: pure functions, unit-tested first
`split(tree, pane, dir, newPane)`, `close(tree, pane)` (collapse single-child splits),
`resize(tree, path, delta)`, `equalize(tree)`, `neighbor(tree, pane, 'left'|'right'|'up'|'down', rects)`
(geometric: pick the pane whose rect is adjacent and overlaps most). They have no DOM
and no IPC, so they are the TDD core.

### 5.3 Terminal registry (the critical rule)
xterm.js instances live in a **registry outside React**: `Map<PaneId, {term, fit, webgl, el}>`.
A `<TerminalPane id>` component only **moves** the existing `term.element` into its
container on mount and calls `fit()`. Re-rendering, re-parenting during a split, or
switching tabs never disposes a terminal. Only `closePane` disposes it. Without this rule,
every split would wipe the scrollback of its siblings.

Per terminal: `@xterm/xterm` + `@xterm/addon-webgl` (DOM renderer fallback on
`onContextLoss`), `addon-fit`, `addon-unicode11`, `addon-web-links` (open http(s) only),
`addon-search`. Resize: `ResizeObserver` → `fit()` → debounced `pty_resize`.

### 5.4 Keybindings
`term.attachCustomKeyEventHandler` checks a binding table **before** keys reach the PTY,
so app shortcuts never leak into the shell. Defaults follow Windows Terminal so they
feel familiar:

| Action | Default |
|---|---|
| New tab / close pane | Ctrl+Shift+T / Ctrl+Shift+W |
| Next / prev tab, go to tab N | Ctrl+Tab / Ctrl+Shift+Tab, Ctrl+Alt+1..9 |
| Split right / down | Alt+Shift+= / Alt+Shift+- |
| Move focus | Alt+Arrow |
| Resize pane | Alt+Shift+Arrow |
| Equalize panes | Alt+Shift+0 |
| Copy / paste | Ctrl+Shift+C / Ctrl+Shift+V (Ctrl+C stays SIGINT) |

UI chrome: a slim tab bar (visible, unlike Windows Terminal's quake mode), split
dividers 4 px wide that you drag to resize, and a focused-pane outline.

---

## 6. Risks and spikes (do these before building features)

| # | Spike | Pass criterion | If it fails |
|---|---|---|---|
| **S1** | Transparent Tauri window + xterm.js **WebGL** with an rgba background | Desktop visible through the background, text crisp, no artifacts | DOM renderer with transparency (slower), or a solid background with whole-window alpha via `SetLayeredWindowAttributes` |
| **S2** | PTY throughput: `Get-ChildItem C:\Windows -Recurse` through Channel → xterm | UI stays responsive, Ctrl+C stops it promptly | Larger batches, lower frame-rate flush, binary framing |
| **S3** | Hotkey → show + **keyboard focus** from many foreground apps (Explorer, browser, elevated admin window, full-screen game) | Typing goes to qterm immediately, every time | Foreground-lock workarounds (§4.1) |
| **S4** | Slide animation at 60 Hz, with and without acrylic, on 100 %/150 % DPI | No visible stutter | Animate the content with CSS (`transform`) inside a window that is already in place, or no animation |
| **S5** | `tilde` double-tap hook | No dropped or reordered characters while typing normally | Keep `combo` only |

Other risks:
- **IME / dead keys** (e.g. Polish `AltGr` letters, `~` as a dead key on some layouts):
  xterm.js handles composition, but test it on your layout early.
- **WebView2 runtime:** built into Windows 11. The installer bootstrapper covers edge
  cases.
- **Security:** Tauri capabilities allow only our commands, strict CSP, no remote
  content. Link clicks go through the opener plugin with an `http(s)` allowlist.

---

## 7. Repository layout

```
qterm/
├─ src-tauri/
│  ├─ src/
│  │  ├─ main.rs, lib.rs          # builder, plugins, setup
│  │  ├─ commands.rs              # #[tauri::command] wrappers only
│  │  ├─ pty/{mod,session,manager,profiles,job}.rs
│  │  ├─ window/{quake,animation,monitor,effects}.rs
│  │  ├─ hotkey/{mod,combo,llhook}.rs
│  │  ├─ config/{mod,schema,watch}.rs
│  │  └─ tray.rs
│  ├─ capabilities/default.json
│  └─ tauri.conf.json
├─ src/
│  ├─ main.tsx, App.tsx
│  ├─ ipc.ts                      # typed wrappers for every command/event (single IPC seam)
│  ├─ store.ts                    # tabs, panes, focus
│  ├─ layout/{tree.ts, tree.test.ts, SplitView.tsx, Divider.tsx}
│  ├─ terminal/{registry.ts, TerminalPane.tsx, theme.ts}
│  ├─ tabs/TabBar.tsx
│  └─ keybindings.ts
├─ e2e/                           # Playwright over CDP (see §8)
└─ docs/foundation.md
```

---

## 8. Testing strategy

| Layer | Tool | What |
|---|---|---|
| Layout tree, keybinding resolution | Vitest | Pure functions. Write these test-first. |
| SessionManager | `cargo test` | spawn `cmd /c echo hi` → read output; resize; kill; exit-code event; Job Object kills children |
| UI flows (tabs, splits, focus, typing → output) | Playwright `chromium.connectOverCDP` against the real app, started with `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222` | Role/label locators, wait on state, unique tab names per test (per project CLAUDE.md rules) |
| Hotkey, focus stealing, animation, transparency | Manual checklist per release (+ a Win32 `SendInput` smoke script) | Things you can't see in the DOM |

---

## 9. Milestones

| M | Scope | Done when |
|---|---|---|
| **M0** | Scaffold (`create-tauri-app`, React-TS) + spikes S1–S4 | Every spike passes or has a chosen fallback |
| **M1** | One terminal, hotkey toggle, slide, transparency, tray, autostart, single instance | Daily-drivable as a single drop-down shell |
| **M2** | Tabs + profiles (pwsh/cmd/WSL/Git Bash) + tab bar | Open/close/switch/rename tabs by keyboard |
| **M3** | Split tree: N-way splits, focus nav, drag resize, equalize | 3 shells side by side in one tab, all resizable |
| **M4** | Config file + hot reload, keybinding overrides, multi-monitor/DPI, hide-on-blur, fonts/themes | No rebuild needed to customize |
| **M5a** | Bundled ConPTY, backpressure, portable single-exe build | One exe that runs anywhere on Windows 11 |
| **M6** | Job Objects, NSIS installer, auto-update, E2E suite | Installable release |

All done. M6: shells ending with qterm needed no Job Object, as ConPTY already
guarantees it (§19); E2E suite §23; installer and updates §25. The feature rounds chosen
with the user since then are in [roadmap-archive.md](roadmap-archive.md) (§16–29 here).

Rough effort for one developer with AI assistance: M0–M1 about 1 week, M2–M3 about
1–2 weeks, M4–M5 about 2 weeks.

---

## 10. References

- Tauri 2: [calling Rust & Channels](https://tauri.app/develop/calling-rust), [calling the frontend](https://tauri.app/develop/calling-frontend)
- Plugins: [plugins-workspace](https://github.com/tauri-apps/plugins-workspace) (global-shortcut, autostart, single-instance, opener)
- [window-vibrancy](https://github.com/tauri-apps/window-vibrancy): acrylic/mica/blur and their perf caveats
- [xterm.js](https://github.com/xtermjs/xterm.js) + `@xterm/addon-webgl`, `addon-fit`, `addon-unicode11`, `addon-search`, `addon-web-links`
- [portable-pty](https://docs.rs/portable-pty) (from WezTerm)
- [Microsoft.Windows.Console.ConPTY](https://www.nuget.org/packages/Microsoft.Windows.Console.ConPTY/): redistributable ConPTY
- [EasyWindowsTerminalControl](https://www.nuget.org/packages/EasyWindowsTerminalControl): rejected WPF option (no transparency)
- Windows Terminal [actions / globalSummon](https://learn.microsoft.com/en-us/windows/terminal/customize-settings/actions): behaviour reference for hotkey and summon semantics

---

## 11. M0 results (2026-10-11)

What exists: Tauri 2 + React-TS scaffold. One quake window running the default shell
(pwsh 7 if installed), Ctrl+` hotkey, CSS slide, translucent background, tray
(Show/Hide, Quit), single instance, and `--background` to start hidden.

| Check | Result | Evidence |
|---|---|---|
| S1 transparency + WebGL | ✅ Pass, after one fix | xterm 6's `xterm.css` hard-codes `.xterm-viewport { background: #000 }`, and the theme background no longer overrides it. Cleared in `App.css`. Measured pixel over `#b4b4bb` content: `#2c2d34`, which matches the 82 % tint. |
| S2 PTY layer | ✅ `cargo test`: 4 tests (output, input, exit code, kill) | ConPTY opens with a cursor-position query (`ESC[6n`) and holds output until a terminal answers. xterm.js answers it; the tests answer it themselves. |
| S2 throughput (UI) | ⏳ Run manually | `scripts/bench.ps1` inside qterm, then in Windows Terminal for comparison |
| S2 sideloaded ConPTY | ✅ Confirmed from source | `portable-pty` 0.9 `psuedocon.rs` loads a sideloaded `conpty.dll` before falling back to kernel32 |
| S3 hotkey + focus | ✅ `scripts/smoke.ps1` passes | Hidden → shown and focused (from another foreground app); visible but behind → focused; focused → hidden. Typed input reaches the shell. |
| S4 slide smoothness | ⏳ Judge by eye | CSS transform approach; 150 ms |
| S5 tilde double-tap | Not started | M5 |

Lessons:
- **Never automate keystrokes without first checking that qterm is in the foreground.**
  In M0, SendKeys input went to another app after the user clicked away. The smoke
  script only presses the hotkey; typing benchmarks are run by hand.
- The window does not take focus when launched at login. That's expected, because Windows'
  foreground lock blocks it; the first hotkey press focuses it.

## 12. M1 + M2 results (2026-10-11)

- **M1:** "Start with Windows" tray checkbox (HKCU `Run` key via `tauri-plugin-autostart`,
  launched with `--background`). It's off by default, so dev builds don't register
  `target\debug\qterm.exe`. Turning it on by default belongs with the M4 settings or the
  M5 installer.
- **M2:** profiles detected in Rust (`pwsh`, Windows PowerShell, cmd, Git Bash, WSL distros
  via `wsl --list --quiet`, which prints UTF-16LE; `docker-desktop*` is skipped). The tab
  bar sits at the bottom edge, with `+` and a ▾ profile menu. Shortcuts follow Windows
  Terminal; Ctrl+Alt+N is skipped when AltGr is held, since AltGr arrives as Ctrl+Alt.
  A clean exit closes the tab (a failed one stays open so the error is readable), and
  closing the last tab opens a fresh one and hides the console.
- **Terminal registry** (§5.3) is in place. Inactive tabs stay mounted but `hidden`, and
  `fit` skips zero-size panes.
- **Verified** over CDP with Playwright driving the real WebView
  (`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222`). Input goes into
  the page only, never to the OS. Checked: new tab, profile menu, cmd output, Ctrl+Tab
  wrap, Ctrl+Alt+N, Ctrl+Shift+W, `exit`, and last-tab close → respawn + hide.
- **Autostart:** the toggle and a reboot were confirmed by hand on 2026-10-12, after the
  fix that keeps dev builds out of the Run key (§15).
- **Testability gap for E2E:** the WebGL renderer draws to a canvas, so terminal text
  isn't in the DOM. Real E2E assertions on output need a test hook (e.g. reading
  `term.buffer`) or a screen-reader mode toggle.

## 13. M3 results (2026-10-11)

- `workspace/layout.ts`: pure tree operations, all unit-tested. `insertSplit` (same
  direction adds a sibling, so equal thirds), `removePane` (collapses single-child splits
  and flattens same-direction nesting, giving the freed space to siblings in proportion),
  `layoutRects` + `neighbor` (geometric focus moves in unit space, no DOM), `resizeAt` /
  `resizeToward` (min share 0.1, sizes rounded to avoid float drift), `equalized`.
- A split opens the **same profile** as the pane being split (a WSL pane splits into WSL).
- `LayoutView` renders the tree with flex shares and 5 px draggable dividers. Children are
  keyed by content, so the registry re-parents a pane's terminal when the tree changes
  around it.
- **Verified over CDP:** Split right ×2 gives three 1698 px columns on the 5120 px screen,
  each running its own shell. Also checked: Alt+Arrow focus, Alt+Shift+- nested split,
  divider drag, Alt+Shift+0 equalize, Ctrl+Shift+W collapse back to three equal columns.
- **Fix:** xterm 6 leaves its legacy `.xterm-viewport` (`overflow-y: scroll`) under the
  themed scrollbar layer. A see-through terminal shows its native scrollbar, so it's
  hidden with `scrollbar-width: none`.

## 14. M4 results (2026-10-11)

- **Settings file:** `%APPDATA%\dev.qterm.app\config.toml` (Tauri's app config dir).
  I chose TOML over the JSON in §4.5 so the file written on first run can carry a comment
  for every option. Parsing uses `deny_unknown_fields` (typos are reported, not ignored)
  plus range checks. A unit test asserts the commented default file parses to exactly
  `Config::default()`.
- **Hot reload:** `notify` watches the directory (editors save by replacing the file) and
  reloads after 150 ms of quiet. An invalid file never replaces the last good config: the
  UI shows a "Settings problem" banner until it's fixed. Changes to the hotkey re-register
  it, changes to height/width/monitor re-place a visible console, and everything else is
  pushed to the UI as `config-changed`.
- **Hotkey:** one bare key, default `Backquote` (the `~` key left of 1). Modifiers are
  rejected by design. `RegisterHotKey` matches modifiers exactly, so Shift+that key still
  types `~` everywhere; only the bare key is taken. Tray: **"Hotkey ~"** checkbox switches
  it off/on (not persisted, so it's on again after a restart). The tooltip says whether the
  key is on, off, or taken by another app. F12 is rejected because Windows reserves it for
  the debugger (found by probing, see below).
- **Window:** `height`, `width` (centered), `monitor = cursor|primary`, `slide_ms`,
  `hide_on_blur`.
- **UI:** `opacity`, `font.family/size` (applied to open terminals, which re-fit),
  `default_profile` (an unknown id is reported with the valid ones), and `[keybindings]`
  overrides by action name. Overrides are parsed and checked in TS: unknown actions or
  keys, chords without Ctrl/Alt (F-keys excepted), and clashes are reported, and the
  affected action keeps its default.
- **Verified:** `smoke.ps1` presses the bare `~`, but only after checking qterm owns the
  key (otherwise the press would type into another app). The config was edited live while
  observing over CDP: opacity, a `new_tab = "ctrl+t"` override, an out-of-range banner,
  a bad keybinding banner, font 14 → 22 (screenshots), and height 0.5 → 0.4 (window
  720 → 576 px). Key-ownership probes confirmed the registration moves when `hotkey`
  changes.
- **Not verified:** clicking the tray "Hotkey ~" item. It can't be automated here, but it
  runs the same unregister/register path that was checked.

## 15. M5a results (2026-10-11)

- **Bundled ConPTY 1.25.260930003** (`Microsoft.Windows.Console.ConPTY`, MIT, see
  `THIRD_PARTY_NOTICES.md`). `scripts/fetch-conpty.ps1` downloads the pinned package,
  checks its SHA-256 and both binaries' Microsoft Authenticode signatures, and drops the
  x64 `conpty.dll` + `OpenConsole.exe` into `src-tauri/vendor/` (gitignored). `build.rs`
  embeds them when present (cfg `bundled_conpty`); without them it warns and uses Windows'
  built-in ConPTY.
  At startup `pty::conpty::install` extracts them to
  `%LOCALAPPDATA%\dev.qterm.app\conpty\<version>\`, rewriting any file that differs
  from the embedded copy, and preloads the DLL by full path. portable-pty's bare-name
  `LoadLibrary("conpty.dll")` then gets that module, so the process-wide DLL search path
  stays untouched. Verified by process inspection: `conpty.dll` comes from the cache, and
  the session host is that folder's `OpenConsole.exe`, not `conhost.exe`.
- **Backpressure** (`pty/flow.rs`): the flusher counts bytes sent; the UI acknowledges
  them after `term.write` has processed them (batched at 64 KB or 20 ms). The reader stops
  reading at 512 KB outstanding and resumes at 128 KB, so a flood blocks the shell instead
  of growing webview memory. On close, the flow stops pausing so the reader drains to EOF,
  because closing a pseudoconsole can hang on a full pipe. Integration test: about 6 MB of
  unacknowledged output pauses near the high-water mark with the shell still running, and
  acknowledging lets it finish.
- **Hidden console at full speed:** with flow control, a throttled hidden webview would
  throttle the shell too. `additionalBrowserArgs` disables background timer throttling,
  renderer backgrounding and occluded-window backgrounding, and keeps wry's default
  `--disable-features` set. Measured on 100k lines: 5.77 s visible vs 5.56 s hidden;
  release build 5.63 s.
- **Ctrl+C fix (found while testing):** Windows passes "ignore Ctrl+C" from parent to
  child process. Launched from a terminal or pnpm/node, every shell inherited it and Ctrl+C
  did nothing. `allow_ctrl_c_in_children` clears it once before the first spawn. The
  regression test fails without the fix. After the fix, Ctrl+C stops an endless flood and
  the prompt is back in well under a second.
- **Launch race fix (found on the release build):** showing the window from setup could
  be lost while the webview was still being created, and the console stayed hidden. The UI
  now calls `ui_ready` once its listeners are attached, and Rust shows the console then;
  only the first call counts. 3 of 3 release launches visible; `--background` stays hidden.
- **Portable build:** `pnpm build:portable` runs `tauri build --no-bundle` and gives
  `dist-portable/qterm-<version>-portable-x64.exe`, about 6 MB. `dumpbin /dependents`
  lists only Windows system DLLs (WebView2 loader and C runtime are static). Run from an
  empty folder it leaves nothing beside itself: settings go to `%APPDATA%`, ConPTY and
  WebView2 data to `%LOCALAPPDATA%\dev.qterm.app`. The tab, split and throughput checks
  pass on it.
- **Portable and autostart:** "Start with Windows" registers the exe's current path. On
  every launch a release exe re-points an enabled entry at itself, so a moved or
  replaced exe takes over once it has been run. Dev builds refuse to register: they
  need the Vite server and open a console window, and an entry naming one showed an
  error page at logon (2026-10-11).

## 16. Feature round (2026-10-11)

| Feature | How | Verified |
|---|---|---|
| Copy/paste | `tauri-plugin-clipboard-manager`. Right-click copies the selection or pastes (WT behaviour). Ctrl+Shift+C/V; optional `copy_on_select`. Paste goes through `term.paste` (bracketed paste). | CDP: right-click copy, both paste paths ran the pasted command, copy on select |
| Search | `@xterm/addon-search` with decorations. Bar with match count, case and regex toggles, Enter/Shift+Enter, Esc. | CDP: "1 of 4", case-sensitive "No results", Esc closes |
| Rename / reorder tabs | `renameTab` (blank clears) and `moveTab`, pure and tested. Double-click edits the title in place; dragging uses pointer events, because Tauri's native file-drop swallows HTML5 drag-and-drop on Windows. | CDP |
| Themes | `terminal/themes.ts`: 9 palettes. The theme drives xterm colours plus the CSS vars the chrome derives from (`color-mix`). | CDP: accent changed live; a test keeps `default.toml` in sync with the theme list |
| Folder tracking | Shells report OSC 9;9 (or OSC 7). `shell_integration` (default on) adds it: PowerShell gets a prompt wrapper via `-EncodedCommand` that keeps the user's own prompt, cmd a `PROMPT` prefix, Git Bash a `PROMPT_COMMAND`. Not WSL yet. | Rust probe: OSC 9;9 passes through both ConPTYs. CDP: `cd` updates the pane, splits open there, reload restores there |
| Session restore | `saveWorkspace`/`restoreWorkspace` (versioned JSON; damaged or outdated sessions are rejected whole; vanished profiles map to the default). Saved 400 ms after layout changes to `%APPDATA%\dev.qterm.app\session.json`; shell titles excluded so they don't trigger saves. | Unit tests + CDP reload |
| Claude sessions | Off by default (`claude_sessions`). The registry scans new lines (`onLineFeed`, debounced) for `claude --resume <uuid>`. Rust finds `<claude home>/projects/*/<id>.jsonl` (`CLAUDE_CONFIG_DIR` or `~/.claude`) and takes the first `cwd` (the launch folder, where `--resume` must run) and the latest `aiTitle`. Falls back to the pane's folder. The id is validated as a UUID before being used in a path. Kept in `claude-sessions.json` (newest first, max 50). Resume opens a tab in that folder and types the command once the shell is up. | Rust tests on fixture transcripts. CDP: this conversation's real transcript gave its title and folder; resume opened a cmd tab in the remembered folder and ran `claude --resume <id>` |
| Settings panel | `settings/draft.ts` (tested) turns edits into minimal TOML changes. Rust `ConfigState::update` applies them with `toml_edit`, keeping key comments (on the key) and trailing comments (on the value), validates, then writes; the watcher reloads. "Start with Windows" applies right away and keeps the tray check in sync. | Rust tests: comments and layout survive, invalid edits leave the file untouched. CDP: theme + toggle saved |

Notes:
- **Testing caveat:** the resume check was meant to hit a stub `claude.cmd`, but the
  environment had `NoDefaultCurrentDirectoryInExePath=1`, so cmd ran the real Claude Code.
  It stopped at its folder-trust prompt; the tab was closed and nothing was accepted.
  Future resume tests must not rely on current-folder lookup.
- **Encoding pitfall:** Python's `open()` defaults to the ANSI code page on Windows. One
  edit wrote "…" as byte 0x85 into a `.rs` file. Always pass `encoding="utf-8"`.
- **Not verified by automation:** tray → "Settings…" (needs a real tray click).

## 17. Links and Claude alerts (2026-10-11)

**Links (roadmap #4).**
- `@xterm/addon-unicode11` is active, so emoji and symbols get the widths shells expect.
- Web links come from `@xterm/addon-web-links`.
- File references are found by `terminal/links.ts` (tested): `path:line:col`,
  `path(line,col)`, Windows and relative paths, skipping URLs. Rust's `resolve_files`
  checks each candidate against the pane's folder (tracked via OSC 9;9), so only existing
  files are underlined.
- Links open on Ctrl+click only, as in Windows Terminal and VS Code. Files open through
  the `editor` setting (default `code --goto {file}:{line}:{col}`). The program is looked
  up on PATH × PATHEXT so `code.cmd` works; without it, the file goes to Explorer's
  default app.
- Verified over CDP: Unicode 11 active; pointer cursor over a file reference and a URL but
  not over plain text; a plain click does nothing; Ctrl+click passed
  `C:\Users\...\qterm\src\App.tsx:10:3` to a test editor command.

**Claude alerts (roadmap #1).** By default Claude Code notifies only in iTerm2, Ghostty
and Kitty. The terminal-independent route is its Notification hook, whose JSON input
includes `message`, `title`, `notification_type` and `session_id`.
- Every shell qterm starts gets `QTERM_PANE`, the pane's id.
- The hook command is qterm's own exe with `--claude-notify`. `main` handles that mode
  before Tauri starts: it reads stdin and drops `{paneId, title, message, kind,
  sessionId}` into `%LOCALAPPDATA%\dev.qterm.app\alerts\` (write, then rename). Without
  `QTERM_PANE`, meaning Claude is running in another terminal, it does nothing.
- The running qterm watches that folder (`notify`) and emits `claude-attention`.
  Leftovers from before the start are dropped.
- The UI decides what to show:
  - looking at that pane → nothing;
  - console focused but on another tab → ✳ tab marker only;
  - otherwise → marker + a Windows notification (`tauri-winrt-notification`, app id
    `dev.qterm.app` registered in HKCU with name and icon).
  Clicking the notification shows the console and emits `focus-pane`. Looking at the
  pane clears its marker, and the tray tooltip counts waiting panes.
- Setup (Settings → Claude Code) edits `~/.claude/settings.json` (`claude_hook.rs`,
  tested). It adds or re-points a `hooks.Notification` entry, keeps everything else in
  its original key order (serde_json `preserve_order`), refuses invalid JSON, backs up to
  `settings.json.qterm-backup`, and can remove its entry again, cleaning up empty parts.
- Verified by running the real hook command, with Claude-style JSON, inside a qterm pane:
  - looking at the pane → no marker;
  - console hidden → marker plus a delivered notification ("Permission needed | Claude
    needs your permission to use Bash" in Windows' notification history for
    `dev.qterm.app`);
  - console up on another tab → marker, no notification;
  - `focus-pane` (what a click sends) → switched to that tab and cleared the marker.
- Deliberately **not** done during testing: installing the hook into the user's real
  Claude settings (the user's choice, via the button), and physically clicking a
  notification.
- The hook points at the exe that installed it. With the portable exe, set it up from the
  copy you keep. If the exe moves, Settings shows "set up for another qterm location"
  with an Update button.

## 18. Feature batch: roadmap #2, #3, #5–#9 (2026-10-11)

- **Pane tools (#9).** `toggleZoom`, `swapPane` (`layout.swapLeaves`) and
  `toggleBroadcast` are pure functions; zoom and broadcast are transient (not saved).
  - Moving focus, splitting, or closing the zoomed pane leaves zoom.
  - A broadcasting tab's panes get an outline. The registry maps each pane to its whole
    group, so one keystroke is written to every shell.
  - Swapping has no default keys (good combos are scarce): bind it, or use the palette.
- **Fix found while testing:** moving a terminal's element (zoom, split, swap) dropped
  keyboard focus, and focus was only restored when the focused *pane* changed. It's now
  restored on any layout change of the active tab. As a safety net, app shortcuts also
  work while focus is outside every terminal and field.
- **Activity / bell (#6).** The registry is told which panes are in background tabs. Each
  reports its first output once (no event per write). Bells are throttled to one a
  second. Looking at the tab clears both markers.
- **Command palette (#5).** Fuzzy ranking over actions (with shortcuts), tabs, new-tab
  profiles, layouts, themes, remembered Claude sessions and the settings file.
  - The matcher started greedy and missed "layout test" in "Layout: test-layout" (it
    jumped a `t` ahead to a word start). It now finds the best alignment by dynamic
    programming, and that case is a regression test.
- **Custom profiles (#8).**
  - `[[profiles]]` takes a quote-aware `command`, plus `cwd`, `env`, `theme` and
    `font_size`. The kind follows the program, so `pwsh`/`cmd`/`bash` keep shell
    integration.
  - An `id` equal to a detected profile restyles that profile.
  - The UI applies a profile's theme and font size to its own panes only.
- **Layouts (#7).** `[[layouts]]` are nestable row/column splits whose panes have a
  profile (id or name), `cwd` and start `command`. `layouts.ts`
  (`buildLayout`/`layoutFromTab`, tested) converts both ways.
  - "Save this tab as a layout" writes a `[[layouts]]` table through `toml_edit`: comments
    kept, same name replaced, deletable from the ▾ menu.
  - Unknown profile references show in the settings banner.
- **All Claude sessions (#2).** `TranscriptIndex` summarizes each
  `projects/*/<uuid>.jsonl`, cached by mtime and size:
  - start folder, AI title, latest git branch, last prompt;
  - prompt count = user records with plain-text content, not meta. Measured on the
    current session: 15, against 575 user records and 170 last-prompt records.
  - On this PC that's 53 transcripts / 72 MB; a plain read of all of them takes about
    0.1 s.
  - The ✳ menu has "Remembered | All on this PC", and each folder has a + that starts
    `claude` there.
- **Claude status (#3).** Sessions remember their shell's pid. `claude_running` walks a
  ToolHelp process snapshot (`procs.rs`, tested) to find `claude.exe` below each shell.
  The UI polls every 2 s while Claude features are on.
  - Status: busy when the pane printed in the last 2.5 s (Claude's spinner animates while
    it works), else idle; waiting comes from the alert hook. The tab shows a spinning or
    dim ✳.
  - Limitation: detection matches `claude.exe` (the native install). An npm install runs
    under `node.exe` and is not recognised yet.
- **Verified over CDP** on the running app:
  - zoom, swap (via the palette), broadcast (one `echo` ran in both panes), activity dot
    and bell;
  - palette theme switch, and layout search after the matcher fix;
  - custom profile (command ran, own theme and 18 pt font, starting folder);
  - layout tab (title, 2 panes, start command ran in its folder), save and delete;
  - "All on this PC" listing 53 sessions in 10 folders, with this session's title,
    branch and 15 prompts;
  - the status chip going working → idle → gone, using a renamed `cmd.exe` as a stand-in
    `claude.exe`. Real Claude was never launched.

## 19. Scrollback across restarts (#10) and crash cleanup (#12) (2026-10-11)

**#12: shells after a crash.** Measured before building anything. With qterm
force-killed, as in a crash or Task Manager:
- the shell (`pwsh`) and its console host (`OpenConsole.exe`) were gone within 3 s;
- so was a `ping` running inside the shell, because Windows ends every process attached
  to a console when that console's host exits;
- a GUI program started from the shell was not affected.

A Job Object with kill-on-close would add nothing here, and it would also kill programs
the user deliberately started from a shell (`code .`, a browser). So there is no Job
Object. Instead, the guarantee is locked in by `a_crash_takes_the_shell_and_its_programs_with_it`:
- the test binary starts itself as a helper that owns a PTY session running `ping`;
- the test terminates the helper with TerminateProcess and asserts that the shell and
  `ping` are gone.
- Pitfall found writing it: the test harness prints `test <name> ... ` without a newline,
  so the helper's `SHELL_PID=` shares that line.

**#10: scrollback.**
- `@xterm/addon-serialize` saves the normal screen (colours included, alternate screen
  and modes excluded, last `scrollback.lines` rows). Files go to
  `%LOCALAPPDATA%\dev.qterm.app\scrollback\<pane>.txt`; pane ids are validated before
  becoming file names.
- **When it saves:**
  - every 30 s, for panes that printed since their last save;
  - when the console is hidden;
  - on tray → Quit, which now asks the UI to save first and exits on `quit_now`, with a
    3 s fallback if the UI doesn't answer.
  - Each save cycle prunes files of closed panes and of switched-off shells.
- **Restoring:** on session restore the files are loaded before the panes mount.
  - The registry writes the old output, then a dim "──── restored <time> ────" line, then
    ED2 with `scrollOnEraseInDisplay` on.
  - That pushes everything into the scrollback, so ConPTY's cursor-home lands on a clean
    screen and the new prompt starts at the top.
- **Per shell:** `[scrollback] restore / lines / profiles = { id = bool }`. The settings
  panel has a checkbox per shell, storing only exceptions to the general switch.
- **TOML pitfalls found:**
  - `[scrollback]` must come after all top-level keys. Placed earlier, it swallowed
    `shell_integration` and friends; the documented-defaults test caught that.
  - The editor now handles inline tables (`profiles = {}`) through `TableLike`.
- **Verified live:**
  - output saved on hide, with its magenta colour;
  - after a UI restart, the old output plus the divider above a fresh prompt at row 0;
  - Command Prompt switched off → not saved, while PowerShell was;
  - Quit → the latest output saved, then exited by itself after 1.7 s, inside the 3 s
    grace.

## 20. Dropping files on a pane (2026-10-11)

- **What it does:** files dragged from Explorer onto a pane are typed at its prompt, like
  Windows Terminal does it. Paths are separated by spaces, followed by a trailing space,
  and Enter is not pressed. The pane under the cursor gets an outline while dragging. On
  drop that pane and the window take focus, even if another pane had it.
- **How:**
  - Tauri's own drop handler (on by default) reports `onDragDropEvent` with physical
    pixels. `ipc.onFileDrag` converts them to CSS pixels, and `elementFromPoint` finds the
    `[data-pane-id]` under them. Overlays (settings, palette) cover the panes, so they
    take no drops.
  - The paths go through `term.paste`: they are broadcast like typing, and bracketed when
    the shell asked for it.
  - The profile's shell kind (`Profile.kind`: powershell, cmd, bash, wsl, other) is now
    sent to the UI and picks the spelling.
- **Quoting** (`terminal/drop.ts`): a path made only of letters, digits and `_ - . : \ / +`
  stays bare, so a dropped `.exe` still runs. Otherwise:
  - PowerShell: `'…'` with `'` doubled (curly quotes too).
  - cmd and other: `"…"`.
  - Git Bash: `/c/…`, in `'…'`.
  - WSL: `/mnt/c/…` (`\wsl$\Distro\…` becomes the Linux path), in `'…'`.
- **Limits:**
  - With "hide on blur" on, clicking into Explorer hides the console first.
  - An elevated qterm gets no drops from a normal Explorer (Windows' UIPI).
  - A custom profile running `wsl.exe` counts as "other" and gets Windows paths.
- **Verified:**
  - Unit tests cover the quoting and path translation.
  - In a dev instance with its own identifier, events were emitted the way Tauri emits an
    OS drop. The outline followed the cursor between two split panes and cleared on
    leave. A drop on the right pane while the left had focus typed
    `'C:\My Files\it''s a.txt' C:\tools\x.exe` there and focused it, and the left pane
    stayed clean.
  - A real drag from Explorer was confirmed by hand on 2026-10-12.

### 20a. Restored output stays in view (2026-10-11)

- **Problem:** restoring worked, but ED2 pushed the old output, divider included, into
  the scrollback. The console opened on a blank screen with a fresh prompt, and with
  the scrollbar hidden it looked as if nothing had been restored.
- **Now:**
  - The old output is written and the cursor goes to the line after its last text. A
    saved screen can end with the cursor mid-screen, e.g. in Claude Code's input box.
  - Then the divider is written, and only then the shell starts.
  - portable-pty creates ConPTY with `PSEUDOCONSOLE_INHERIT_CURSOR`, so ConPTY asks
    where the cursor is and the prompt appears right under the divider, with the old
    output still on screen.
  - Input produced before the session id is known, such as the reply to that cursor
    query, is queued instead of dropped.
- **Hidden tabs:** a restored pane in a tab that isn't showing waits for its first real
  fit before restoring and starting its shell. Started at the 80x24 placeholder, the
  jump to the real size let ConPTY repaint over the restored lines.
- **Verified** with copies of real saved files in a test instance:
  - The active tab shows Claude Code's last screen, the divider and a new prompt.
  - The background tab, once shown, shows the same.
  - Changing rows or columns afterwards keeps the restored lines.

### 20b. Prompt-only panes aren't kept (2026-10-11)

- **Saving:** a pane is saved only if something was run in it since its shell started,
  or it brought back earlier output. Running something means Enter, a pasted line, or
  startup input such as a Claude resume. Even then the screen must hold more than blank
  lines, bare prompts and startup banners (`terminal/content.ts`). Those are the cmd
  banner, the PowerShell profile timing line, and bare PowerShell, cmd, Git Bash and
  bash/WSL prompts, plus qterm's own divider and exit notes.
- **Prompt-only panes** get no file, and an older one is pruned. A restored tab not
  shown yet (shell not started) keeps its file untouched.
- **Restoring** skips a file whose plain text is only noise, e.g. one saved before this
  change.
- **Verified live:** an untouched pane and an `echo` pane. Only the `echo` pane got a
  file, a planted prompt-only file was pruned, and after a reload only the `echo` pane
  came back (a re-planted prompt-only file was skipped).

### 20c. Clearing saved output (2026-10-12)

- **One pane:** "Clear pane history" (command palette; unbound, bindable in Settings)
  works like Windows Terminal's "Clear buffer". It clears the pane's scrollback and
  screen, keeping the cursor line, and deletes its saved file.
- **Everything:** Settings → Scrollback → Saved output shows how many panes have saved
  output and its size. "Clear all saved output…" then "Clear everything" deletes every
  file and clears every open pane.
- **Why open panes are cleared too:** otherwise the next save, at most 30 s later,
  writes the same output back.
- **Rust side:** `delete_scrollback(pane_ids?)` and `scrollback_usage()`, with a unit
  test.
- **Verified live:**
  - two panes with `echo` were saved;
  - the palette action cleared the second and deleted its file at once, and the next
    save kept only the first;
  - Settings showed "1 pane, 85 B", the two-step clear left no files, and the next save
    wrote none.

## 21. Roadmap round 2: #17–#21, #23, #28, #31 (2026-10-12)

| # | What | How | Verified |
|---|---|---|---|
| 20 | Snippets | `[[snippets]] name/command/run`; palette group "Snippet". Pasted (multi-line ones aren't run line by line), then Enter as its own keystroke when `run`, since a bracketed paste never runs. | Live: the `run` one ran, the other waited at the prompt. Config test. |
| 31 | Settings export/import | `tauri-plugin-dialog` pickers. Export copies config.toml (comments kept). Import validates first, keeps `config.toml.bak`, writes atomically; the watcher applies it. | Rust test: export, rejected import leaves the file alone, good import with backup. |
| 18 | Command marks | Shell integration emits OSC 133 A (prompt), B (typing), D;code (ended). PowerShell reads `$?`/`$LASTEXITCODE` first; Git Bash adds B to PS1 once; cmd's PROMPT can't see the exit code. The registry keeps a mark per command (markers, max 500): a 3 px bar at the prompt's edge (green/red/grey, tooltip = command), Ctrl+↑/↓ scroll between prompts, "Copy last command's output" (wrapped lines joined). | Live: exit 0/3 in PowerShell, 0/1 in Git Bash, none in cmd; bars on screen; jumps; copied `copy-me-1\ncopy-me-2`. |
| 19 | Long-command alerts | Duration from the Enter that ran it to D. `long_command_alert` seconds (default 30, 0 = off, also in Settings). Same path as Claude alerts: ✓/✗ on the tab, Windows notification unless you're in the console. | Live: `Start-Sleep 3; exit 4` with the threshold at 2 s, console hidden → ✗ "Command failed (exit 4) · 3s". |
| 21 | Search all panes | Alt+Shift+F: palette-style dialog, case/regex toggles, results "tab · line". Started panes: their normal buffer. A restored tab not shown yet: its saved output (plain text). Picking a result focuses the pane, waits for its restored output (`ready`), scrolls and selects. | Live: 4 matches across 2 tabs, pick selected `needle`; case 2→0; regex 4; unopened restored tab found and revealed after it started. |
| 23 | Images, ligatures | `@xterm/addon-image` (sixel, iTerm, Kitty), `inline_images` default on. `@xterm/addon-ligatures` falls back to a built-in ligature list in a webview (no font files): `[font] ligatures`, default off, needs a font that has them. Loaded before WebGL; the renderer is reloaded when switched. | Live: a sixel through ConPTY was stored (60×12 px) and drawn; ligatures drawn with Cascadia Code; both switch at runtime. |
| 17 | Claude context and cost | The hook also handles SessionStart (pane → session + transcript); Settings shows "Update" for a Notification-only setup. Fallback: the newest transcript of the pane's folder. Transcripts are read incrementally; a request counts once (latest line); context = the main thread's latest request; cost at API list prices per model (5 m/1 h cache writes, reads, Haiku 5.5 long-prompt tier, fast mode); unknown models make it partial. Polled every 5 s for panes running Claude. | Rust tests (cost maths, de-dup, incremental, path checks). Live: folder fallback read this session (56%, ≈ $103, 740 requests); a SessionStart event switched it to the mapped transcript; "Running now" row in the ✳ menu. |
| 28 | Admin tabs | No home-made elevation bridge: Windows' sudo with `--inline -E -D <folder>` (full path to sudo.exe), only when sudo is set to Inline (registry, capped by policy); the backend refuses otherwise. Other modes: ShellExecute "runas" opens the shell in its own window, with a notice. Admin panes are marked and not saved as admin. | Live: status "disabled", elevated spawn refused, palette entries, Settings status. Tests: mode reading, sudo argv, command-line quoting. Not done: an actual elevation (sudo is off here; a UAC prompt can't be automated). |

Notes:
- **Ctrl+Alt chords** are AltGr on Windows (and type characters on many layouts), so the
  key matcher ignores them. Search all panes uses Alt+Shift+F instead.
- **Vite's watcher** sometimes missed files rewritten by scripts during development; a
  touch (or restart) fixed it. Comments are stripped from served modules, so checking
  served code for a comment proves nothing.

## 22. Claude here and on start, SSH, tab colours, backdrop (2026-10-12)

| What | How | Verified |
|---|---|---|
| Resume here | ✳ menu "here" / palette "Resume Claude here": the focused pane gets `cd <folder>; claude --resume <id>` spelled for its shell (`claude/resume.ts`). A new tab plus a notice when Claude or another command runs there (`commandRunning` from the command marks) or the shell can't reach the folder (WSL vs Windows, custom programs). | Unit tests per shell. Live: idle pane typed in place; busy pane (stand-in claude running) → new tab and the notice. |
| #15 Claude on start | The saved tabs carry pane → session (from the usage poll: the SessionStart mapping, else the folder's newest transcript). With `claude_restore` (off by default) restored panes get `claude --resume <id>` as startup input. Ids must look like ids. | Unit tests (round trip, rejecting `x; rm -rf /`). Live: a saved session was typed on restore; a pane running the stand-in was saved with its session id. |
| #22 SSH | `ssh_profiles` (on): `Host` names from `~/.ssh/config` → "SSH <host>" profiles (`ssh:<host>`, Windows OpenSSH or ssh on PATH), re-read on every listing. Patterns, `Include` and `Match` are skipped. | Unit test. Live: the dev machine's config has only a wildcard Host, so none, as intended. |
| #24 Tab colours, icons | Right-click a tab: 8 colours, quick icons or any short text, Reset; saved with the tabs. `[[profiles]] tab_color / icon` give defaults (validated). The menu flips up/left to fit (the tab bar is at the bottom). | Unit tests. Live: profile teal + 🧪 shown; right-click purple + 🚀 applied and saved. |
| #26 Backdrop | `background_effect` none / acrylic / mica via Tauri window effects, cleared before each change (DWM otherwise keeps the old backdrop). No "blur": Tauri documents it for Windows 11 22H1 and older. | DWM `SYSTEMBACKDROP_TYPE` read from the window: 1 none, 3 acrylic, 2 mica, back to 1. |

**Testing Claude features without Claude:** a test profile puts a renamed `ping.exe`
first on PATH as `claude.exe`. It is detected as Claude and typed `claude --resume`
commands run it harmlessly, so the real Claude Code is never started.

**A background colour per shell (research, roadmap #32).** Not possible today:
- Every terminal is drawn on a transparent background (`xtermTheme` sets it to
  `rgba(0,0,0,0)`), and `.console` paints one background for all of them: the global
  theme's colour at `opacity`.
- A profile's `theme` therefore changes text and ANSI colours, not the background.
- Painting a second translucent colour on a pane doesn't work: layers compound. With
  opacity 0.82, a pane layer over the console layer lets only 3% of the desktop through
  instead of 18%.
- The way to do it: the console stops painting behind the tab panels, each pane paints
  its own background (its profile's theme, or a new `background` colour, at the same
  opacity), and the gaps (dividers, the console's padding, the tab bar) keep the
  console's.

## 23. End-to-end tests in CI (#11, 2026-10-12)

**How it works.**
- Playwright (`@playwright/test`) drives a debug build of the real app.
- The debug build is made with `TAURI_CONFIG={"identifier":"dev.qterm.e2e"}` in
  `src-tauri/target/e2e`. It has its own settings, data, single-instance key and alert
  inbox, so it never touches an installed qterm or the `pnpm tauri dev` build.
- It loads the UI from the Vite dev server (Playwright starts it), which keeps the
  dev-only test hook (`window.__qterm`) for reading terminal text off the canvas.
- Playwright attaches over CDP: `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=
  --remote-debugging-port=9333`.
- `e2e/qterm.ts` gives every test a fresh instance: state wiped, settings written, the
  app started, and at the end killed with its shells. `restart()` quits the way the tray
  does.

**Conventions.** `e2e/RULES.md` and `e2e/seed.spec.ts`; one spec per risk (R1–R5 in
`e2e/README.md`). Each was checked with a deliberate break:

| Spec | Break |
|---|---|
| seed | typed input dropped |
| split | typing sent to every pane |
| restore | saved output not shown |
| long command | no alert raised |
| settings | font change not applied |

**Bugs it found, fixed:**
- **An extra tab at start, and the console hiding itself.** The start-up effect re-ran
  while the session was loading: StrictMode in development, or any dependency change.
  Start-up now has three states.
- **Quitting lost the latest tabs and folders.** The tabs are saved 400 ms after a
  change, and quit didn't flush them. It does now.
- **Any second instance watched the installed qterm's alert inbox** and dropped its
  pending alerts on start. The inbox is now per identifier; shells get `QTERM_INBOX`.

**A test lesson.** The split test first asserted only that the left pane didn't show
the right pane's *result*. Leaked keystrokes arrived garbled by a terminal reply, so the
command failed and no result appeared, and the test stayed green. It now also asserts
the typed text never shows up.

**CI** (`.github/workflows/ci.yml`, windows-latest): TypeScript checks, Vitest, clippy
`-D warnings`, `cargo test`, then `pnpm e2e`. The Playwright report and traces are
uploaded on failure. Locally the five specs take ~17 s after the build.

**Getting it green on the runner** (Windows Server 2025, WebView2 153 preinstalled, no
Edge policies). It took four runs:
- **The debugging port never opened.** `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` alone
  doesn't reach WebView2 there, though it does on a desktop. The e2e build now carries
  `--remote-debugging-port` in its window's own `additionalBrowserArgs`, through
  `TAURI_CONFIG` in `global-setup.ts`.
- **TEMP is an 8.3 short path** (`C:\Users\RUNNER~1\...`) while shells report full
  ones; the restore test resolves its folder with `fs.realpathSync.native`.
- **Diagnostics stay in:** the app's output goes to `test-results/qterm-app.log`; if the
  port stays shut, the WebView2 processes and their command lines are added to it. The
  Rust cache is kept on failure (`cache-on-failure`).

The first run (cold cache) took 27 minutes; with the cache a run takes about 5½ minutes,
1.1 minutes of it the E2E specs.

## 24. A background per shell (#32, 2026-10-12)

**Setting:** `[[profiles]] background = "#rrggbb"`, or a profile `theme`, which brings
its background. The panes of that shell are painted in it, at the console's `opacity`.

**How it avoids stacking:**
- `.console` no longer paints a background itself. `.console::before` paints
  `--console-bg` everywhere except the terminal area: a CSS mask with an excluded
  rectangle (`mask-composite: exclude`) at `--hole-x/y/w/h`. A ResizeObserver in
  `App.tsx` measures `.tab-panels` against the console and sets those.
- Inside the hole each `.pane` paints `var(--pane-bg, var(--console-bg))`, and
  `.divider` paints `--console-bg`. Panes are square now: rounded corners would let the
  desktop through.
- Overlays (palette, settings, search) keep their own backgrounds.

**Verified:**
- E2E R6 (`pane-background.spec.ts`): a "Deep" profile's pane computes to
  `rgba(32, 48, 64, 0.82)` while the first pane keeps the theme's. Deliberate break:
  not passing the pane's background → red.
- Visual check: a screenshot with transparency kept read alpha 209 (= 0.82) on both
  panes, the divider between them and the console edge. Two stacked layers would read
  about 247.

**Per pane (added the same day).** A pane can have its own background chosen:
- Shift+right-click on it (plain right-click stays copy/paste), or "Pane background…" in
  the palette (bindable as `pane_background`).
- Eight dark tints, Default, a custom colour box and Reset.
- Precedence: the pane's own colour, then its shell's `background` or theme, then the
  console's.
- Saved with the tabs (`background` per pane, `#rrggbb` only); a new split starts with
  the default.
- E2E R7 (`pane-background-picker.spec.ts`): navy on the right pane only, still there
  after a restart. Both deliberate breaks (colour ignored, colour not saved) were
  caught.

## 25. Releases, installer and updates (#13, 2026-10-12)

**Publishing.** `scripts/release.ps1 <version>` sets the version in package.json,
Cargo.toml (and Cargo.lock) and tauri.conf.json, commits and tags `v<version>`. Pushing
the tag runs `.github/workflows/release.yml`:
1. checks the tag matches tauri.conf.json and the signing secret is there; unit tests;
2. `tauri build --no-bundle` → `qterm-<v>-portable-x64.exe` (built before bundling,
   which marks the exe it packs as the installer's);
3. `tauri build` → `qterm_<v>_x64-setup.exe` (NSIS, `installMode: currentUser`) and its
   `.sig` (`createUpdaterArtifacts`);
4. `tauri signer sign` on the portable exe; `scripts/release-manifest.mjs` writes
   `latest.json`; `SHA256SUMS`;
5. `gh release create --draft`, then publish, so the feed never points at missing files.

**Signing.** A minisign key pair made with `tauri signer generate`. The private key and
its password are the repo secrets `TAURI_SIGNING_PRIVATE_KEY(_PASSWORD)` (a copy is kept
outside the repo); the public key is `plugins.updater.pubkey` in tauri.conf.json. Not
Authenticode: SmartScreen still warns on first run (documented in the README).

**Feed.** `https://github.com/stobjasz/qterm/releases/latest/download/latest.json`, so it
works once the repo (or its releases) is public. Entries: `windows-x86_64-nsis` and
`windows-x86_64` → the installer; `windows-x86_64-portable` → the bare exe.

**In the app** (`updater.rs`):
- Installed or portable: `uninstall.exe` next to the exe means installed. Portable
  copies ask the feed for the `windows-x86_64-portable` target.
- `check_updates` (default on): first check 30 s after start, then every 24 h. A found
  update is kept in `UpdateState`, the tray item becomes "Update to qterm X…", and the
  UI gets `update-available` (banner with Update and restart).
- Installing: the UI saves tabs and output (the same `flushSession` + `saveScrollbacks`
  as Quit), then `install_update`. `Update::download` verifies the signature.
  Installed: `Update::install` runs the installer (`/P /UPDATE /R`) and exits; the
  installer restarts qterm with the same arguments, so a `show-after-update` file in the
  local data folder makes the console show even after an autostart's `--background`. Portable: write `<exe>.new`, rename the running exe to
  `<exe>.old` (Windows allows renaming a running exe), rename `.new` into place (put
  back on failure), start it with `--after-update <pid>`, exit. `main` waits up to 15 s
  for that pid before the single-instance check, and setup deletes `<exe>.old`.
- Dev builds don't check unless `QTERM_UPDATE_ENDPOINT` points at a test feed (http
  allowed in debug only); release builds always use the configured https endpoint.

**Verified:**
- Unit: the exe swap (and a second swap over a leftover `.old`), a failed swap leaving
  things as they were; the manifest generator.
- Locally end to end, isolated (identifier `dev.qterm.updtest`, own product name so the
  real autostart entry isn't touched): a 0.1.0 debug exe with the feed on a local http
  server found 0.1.1 (a release build signed with the real key) after 30 s; clicking
  the banner's Update and restart exited it (code 0), the same path then ran 0.1.1,
  and `.old`/`.new` were gone. With one flipped byte in the served exe the banner said
  "could not download the update: The signature verification failed", qterm kept
  running and the exe was unchanged.
- `tauri build` with the key set produced the per-user installer and its `.sig`.

## 26. Roadmap round 3: #29, #33, #36, #37, #39, #42–#45, #47, #50 (2026-10-14)

**Which copy owns shared integrations (#33, `install.rs`).** The autostart entry and
the Explorer item have one name for every copy. An installed qterm (an
`uninstall.exe` next to it) always points them at itself on start; a portable one only
when they don't already point at an existing installed qterm. Settings are shared
between copies (same identifier), so an explicit change in either copy applies to all.

**Log and diagnostics (#29, #37, `log.rs`, `diagnostics.rs`).** `qlog!` replaces every
`eprintln!`: local-time lines in `%LOCALAPPDATA%\<id>\logs\qterm.log`, rotated to
`.log.1` past 1 MB; lines logged before setup knows the folder are buffered. A panic
hook logs panics (release builds abort right after). UI `error` /
`unhandledrejection` events are forwarded (at most 50 a session). "Copy diagnostics"
builds a plain-text report (version, install kind, Windows name/build — ProductName
still says Windows 10 on 11, so the build number decides — WebView2, console host,
settings path and error, hotkey, autostart target, shells, last 40 log lines).

**Open in qterm (#36, `explorer.rs`).** `explorer_menu` writes
`HKCU\Software\Classes\{Directory,Directory\Background,Drive}\shell\qterm` with
`"<exe>" --open-here "%V"`. Test builds use their identifier as the key name, so they
never replace the real one; dev builds with the real identifier refuse. A second
start hands its arguments to the running qterm through single-instance, which shows
the console and emits `open-here`; a first start keeps the folder until the UI takes
it after restoring tabs. `%V` of a drive root ends in a backslash, which escapes the
closing quote, so a stray trailing `"` is dropped. The uninstaller hook
(`windows/hooks.nsh`, NSIS_HOOK_POSTUNINSTALL) removes the keys if their command
starts with the install folder. Note: Tauri's per-user NSIS installs to
`%LOCALAPPDATA%\qterm` (the docs said `...\Programs\qterm` until this round).

**Tab names from Claude (#39).** Claude Code already titles the terminal while it
runs (unless `CLAUDE_CODE_DISABLE_TERMINAL_TITLE`). The usage reader now also takes the
transcript's `aiTitle` (else the first typed prompt) and the pane keeps it as
`claudeTitle`, saved with the tabs; `tabTitle` = custom > Claude title > shell title >
profile.

**Waiting list (#42).** From the existing attention map: ✳ menu section, palette
group, `next_waiting` (Alt+Shift+W) cycling in tab order (`claude/waiting.ts`). The ✳
menu only exists with "Remember Claude Code sessions" on; the shortcut and palette
work regardless.

**Recent commands and folders (#43, #44, `terminal/history.ts`).** From the
`onCommandFinished` and `onCwd` events; MRU, unique (folders compared ignoring case and
a trailing backslash), 100 / 30; `history.json` via Rust like the session, saved
shortly after a change and on quit / update. A recent command is typed without Enter.

**Quick select (#45, `terminal/quickSelect.ts`).** `registry.screen()` returns the
viewport as logical lines (wrapped rows joined, wide characters' second halves
skipped) with each UTF-16 unit's row/column, and the cell grid's page geometry.
Targets: URLs (sentence punctuation trimmed, a `)` closing a `(` inside kept), file
references (the link finder's pattern, with line/column), Windows folders, hashes
(7–40 hex with a digit and a letter), IPv4 with port; overlaps go to the earliest,
longest. Labels: home-row letters, pairs past 26, shortest at the bottom. While the
overlay shows, a capture-phase keydown listener takes every key (preventDefault +
stopPropagation, so xterm never sees it).

**Save output (#47).** `registry.plainText` (normal buffer, wrapped lines joined,
trailing blank lines dropped, CRLF) or the SerializeAddon's HTML; `save_output` writes
to the chosen path, or a temp file that the editor opens at the last line.

**Named workspaces (#50, `workspace/named.ts`).** Entries hold `saveWorkspace` text;
opening restores it and `appendWorkspace` re-ids every tab and pane (so it can be
opened twice), drops `claudeSession` (resume is a restart feature) and activates its
first tab.

**Verified:**
- Unit: install ownership and command-line parsing, Explorer argument parsing,
  transcript titles, history, waiting order, workspaces (append with fresh ids, round
  trip), quick select targets and labels: 175 vitest, 84 cargo tests.
- E2E (each with a deliberate break that turned it red): R8 open-here (break: the
  running copy ignores the folder), R9 recent command after a restart (break: commands
  not remembered), R10 named workspace after a restart (break: folders dropped), R11
  quick select (breaks: a label picking its neighbour; letters reaching the shell —
  the first version of the spec missed the second, so it now runs a command afterwards
  instead of reading the prompt line).
- Live, against the test build: the diagnostics report, plain-text/HTML export (a
  300-column line comes out whole) and the temp file; the log file's contents.
- `tauri build` with the hook: the installer includes `hooks.nsh` and its
  POSTUNINSTALL macro.

## 27. Pin, What's new, winget (#25, #35, #30; 2026-10-14)

**Pin (#25).** `QuakeState.pinned`, set from the UI's 📌 (`set_pinned`). The blur
handler skips `dismiss` while pinned, and the hotkey's decision is a pure function
(`hotkey_action(visible, focused, pinned)`, unit-tested): pinned, "hide" becomes
"focus". Tray → Show / Hide (`flip`) still hides. Not saved.

**What's new (#35, `whats_new.rs`, `updates/`).** `last-version` in the config folder
holds the version that ran last; `take_version_change` rewrites it and returns
from/to only when the new one is newer (numeric comparison), so an older copy running
next to a newer one stays quiet. The UI fetches
`api.github.com/repos/stobjasz/qterm/releases/tags/v<version>` (public, no token) and
renders the body with a small Markdown subset (headings, list items, paragraphs,
bold, code, https links) as React elements, never as HTML. Offline: a link to the
release page.

**winget (#30).** Package `stobjasz.qterm`: the per-user NSIS installer (nullsoft,
scope user, silent `/S`). `scripts/winget-manifests.mjs` writes the version,
installer and default-locale manifests (schema 1.10.0) from the release's
`SHA256SUMS`; `winget validate` accepts them. Later releases: a `winget` job after
the release job runs `vedantmgoyal9/winget-releaser@v2` (Komac), which copies the
previous manifests with the new URL and checksum and opens the pull request, if the
`WINGET_TOKEN` secret exists. It has to be a job in release.yml, not a workflow on
`release: published`: a release published with `GITHUB_TOKEN` triggers no workflows.

**Verified:**
- Unit: hotkey decision when pinned; version comparison; release-notes parser
  (lists with continuation lines, links only for https); winget manifests. 179
  vitest, 86 cargo tests.
- E2E R12 (`whats-new.spec.ts`): with `last-version` = 0.1.0 the panel shows this
  version and "Updated from 0.1.0."; the next start shows nothing. Deliberate break
  (the version never recorded): red. The harness gained `settings.files` for files in
  the config folder. Two buttons named "Close" in the panel were made distinct.
- Live: with `last-version` = 0.2.0, the real 0.2.1 notes load from GitHub and render
  (heading, list items, link).
- `winget validate` on the 0.2.1 manifests: succeeded.

## 28. Plan limits, stop alerts, Windows Terminal import, command blocks (#51, #52, #60, #57; 2026-10-14)

**Status line relay (#51, `claude_statusline.rs`).** Claude Code runs `statusLine.command`
with the session's JSON on stdin (context window, cost, `rate_limits.five_hour/seven_day`
with `used_percentage` and `resets_at`, prompt cache). qterm's setup sets it to
`<exe> --claude-statusline`; with a status line of the user's own, to
`<exe> --claude-statusline --pass | <own command>`, where qterm forwards stdin unchanged;
removing it restores the own command (other `statusLine` fields untouched). The exe is
quoted only with a space in its path: Claude Code uses PowerShell when Git Bash is
missing, and a quoted program doesn't start a PowerShell command line. The process
drops a `usage` message in the pane's qterm inbox (same as the hooks; outside qterm it
only prints). The UI merges Claude Code's context and cost into the tab's usage over the
transcript estimate, keeps the latest plan usage (✳ menu, tray tooltip via
`set_plan_summary`) and warns at 80% / 95% once per window (keyed by `resets_at`).

**StopFailure (#52).** Added to the installed hook events (so older setups show
"Update"). Input `error` (`rate_limit`, `overloaded`, `billing_error`, ...),
`error_details`, `last_assistant_message`; it becomes an alert with kind
`stop_failure:<error>` and the title "Claude stopped: <reason>", shown on the tab as
"!".

**Windows Terminal import (#60, `wt_import.rs`).** Sources: `settings.json` of the Store,
Preview and unpackaged builds and `Fragments\<app>\*.json` (JSON with comments and
trailing commas: a string-aware stripper; the naive regex breaks on `"https://..."`),
with `profiles.defaults` applied, hidden and command-less (dynamic) profiles skipped;
plus the Visual Studio developer shells WT generates, from `vswhere -format json`
(`Import-Module <DevShell.dll>; Enter-VsDevShell <instanceId> -SkipAutomaticLocation`,
written with single quotes so qterm's splitter keeps the script whole, and
`cmd /k VsDevCmd.bat`). Anything matching an existing profile by program file name and
arguments, or by name, isn't offered. Colours: the scheme's background (the file's or
WT's built-in schemes), the nearest tab colour by hue. `Config::add_profiles` appends
`[[profiles]]` with toml_edit.

**PowerShell integration fix.** qterm appended `-NoExit -EncodedCommand <b64>` after a
profile's own arguments; after a `-Command`, PowerShell takes everything as the script,
so the integration's arguments became the script's (a VS developer shell failed). Now
with `-Command` the integration is dot-sourced in front of the script
(`. ([scriptblock]::Create(...FromBase64String('<b64>')))`; `-NoExit` added if missing);
with `-File` it's left out.

**Command blocks (#57).** The mark decoration takes clicks (the whole cell, the bar drawn
by `::before`; mousedown stopped so xterm doesn't start a selection) and reports the
command's prompt-marker id; `blockOutput` / `selectBlock` find the mark by that id
(output = below the command line's wrapped rows, above the end mark, trailing blank
lines dropped), shared with "Copy last command's output".

**Verified:**
- Unit: status line parsing, install / chain / restore, quoting; StopFailure alert;
  JSONC, WT profile mapping, command keys, env expansion, VS dev shells, hue matching;
  PowerShell integration with -Command / -c / -File; plan summary, warnings, usage merge.
  184 vitest, 98 cargo tests.
- E2E with Claude Code's documented JSON piped into the real commands: R13 status line →
  ✳ menu (and qterm's printed line), R14 StopFailure → background tab's "!" marker; R15
  command blocks. Each turned red under a deliberate break (usage not emitted;
  StopFailure handled as a plain notification; the latest command selected instead of
  the clicked one).
- Live: importing from this PC's Windows Terminal, Visual Studio 2022's Developer
  PowerShell opened with `VSINSTALLDIR` set, `cl.exe` found and folder tracking working;
  before the fix the same profile came up without the VS environment.

## 29. Settings search, output triggers, settings in a folder (#59, #46, #63; 2026-10-14)

**Settings search (#59, `settings/filter.ts`).** A search box in the panel's header; after
every render a layout effect walks `.settings-group` children and sets `hidden` on those
whose text (labels, hints, `<select>` option texts; shortcut rows one by one) doesn't
contain every query word, accents and case folded; a group whose title matches keeps all
its items. React never sets `hidden` on these elements, so nothing fights it. Esc in the
box clears it (`preventDefault`, which the panel's window-level Esc handler checks).

**Output triggers (#46, `terminal/triggers.ts`).** `[[triggers]]` (Rust: `Trigger`,
`TriggerAction` notify/mark/highlight, colour validated) compiled in the UI (JS RegExp;
compile errors join the settings problems). The registry checks on `onLineFeed`: the line
above the cursor, wrapped rows joined, normal buffer only, and only once the shell
session exists (not restored output). highlight: a marker plus a full-width decoration
with `backgroundColor` on the bottom layer; mark / notify: `onTrigger`, throttled to one
per trigger and pane per 3 s, becoming an alert (kind `trigger`, ⚑ on the tab; notify
also shows the Windows notification when you aren't looking).

**Settings in a folder (#63).** `ConfigState` keeps its home (the app's config folder)
and a lockable path. `relocate(Some(folder))`: an existing `config.toml` there must parse
(then it's used), otherwise the current one is copied; `settings-folder` in the home
names the folder. `relocate(None)`: the current file is copied home (the old local one to
`.bak`) and the pointer removed. `load` follows the pointer; a missing file there means
the local one plus a problem message. The config watcher lives in its own slot
(`ConfigWatcher`) and is replaced after a move; `on_config_file_changed` then applies the
differences (hotkey, size, effect) at once. The UI resets the panel's draft when the
path changes.

**Verified:**
- Unit: search matching; triggers (text/regex, labels, compile errors), config parsing
  of `[[triggers]]`; relocation (move, use existing, back home with .bak, refusing
  invalid settings, falling back when the folder is gone). 189 vitest, 101 cargo tests.
- E2E, each red under a deliberate break: R16 settings search (break: everything
  matches), R17 a mark trigger in a background tab (break: lines never checked), R18 the
  folder's settings apply live and after a restart (break: the watcher left on the old
  file).
- Live: a highlight trigger decorates exactly the matching line, full width.
- On the way: a commented example in default.toml used `"error TS\d+"`, an invalid escape
  in a TOML basic string; it uses a literal string now.

## 30. The settings panel's layout (2026-10-14)

**Problem:** the groups sat in a CSS grid (`repeat(auto-fit, minmax(300px, 1fr))`), which
stretches every group in a row to the tallest one; short groups were mostly empty, and on
a wide, short console (5120x720) the tall ones scrolled while two thirds of the width
stayed unused. Plain CSS columns fixed the heights but couldn't use the width either:
groups don't split, so 8 groups filled 6 of 15 possible columns and the tallest still
scrolled.

**Now (`settings/masonry.ts`):** as many columns as fit (300px or more, stretched to the
width). Each group is measured at growing spans (its settings in a
`.settings-group-body` flowing in that many inner columns; the shortcuts group, a grid
that arranges itself by width, without inner columns) and takes the narrowest span at
which it fits the panel's height, else the widest. Groups are then placed in order where
they start highest (`pack`), absolutely positioned (`box-sizing: border-box`, or padding
and border overlap the next column). It runs after every render (after the search
filter, which now looks inside `.settings-group-body`) and on resize.

**Verified:** packing and span choice unit-tested; measured in the test app at 5102x591
(all 9 groups side by side, no scrolling; Appearance, Terminal and Claude Code at 2
columns, the shortcuts at 4) and at 1508x1167 (4 columns, scrolls a little); the
screenshots checked by eye. The E2E suite (Settings save, search) passes.
