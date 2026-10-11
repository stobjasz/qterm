# qterm — technical foundation

A quake-style drop-down terminal for Windows 11: a hotkey slides a semi-transparent
console down from the top of the screen. It starts with Windows, lives in the tray,
supports tabs, and splits each tab into panes (e.g. 3 shells side by side).

Status: M0–M4 done; M5 (hardening) next (see §11–14). Date: 2026-10-11.

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
  `--background` so nothing is shown at login.
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
| **M5** | Hardening: Job Objects, bundled ConPTY, backpressure, `tilde` mode (S5), NSIS installer, updater, E2E suite | Installable release |

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
- **Not yet verified:** the autostart toggle (needs a tray click) and a reboot test.
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
