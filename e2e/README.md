# End-to-end tests

These drive the real app: a debug build of qterm (own identifier `dev.qterm.e2e`, so it
never touches an installed qterm) is started for every test, Playwright attaches to its
WebView2 over the remote debugging port, and the tests type into real shells.

```
pnpm e2e                         # builds the test app (incremental), runs every spec
pnpm e2e e2e/seed.spec.ts        # one spec
QTERM_E2E_SKIP_BUILD=1 pnpm e2e  # skip the build when nothing in src-tauri changed
QTERM_E2E_DEBUG=1 pnpm e2e       # log the app's startup steps
```

Needs Windows with WebView2 and PowerShell 7 (`pwsh`). The Vite dev server is started
for you on port 1420 (or reused if it's already running). CI runs the same on GitHub
Actions (`.github/workflows/ci.yml`).

Writing a spec: read [RULES.md](RULES.md) and start from [seed.spec.ts](seed.spec.ts).
The harness is [qterm.ts](qterm.ts).

## Risks covered

Each risk crosses the app's boundaries (UI → Rust → ConPTY → shell → files) in a way
unit tests can't reproduce. One spec per risk.

| # | Risk | Spec |
|---|---|---|
| R1 | What you type in the console runs in its shell and the result shows up. | `seed.spec.ts` |
| R2 | After a split, input goes to the pane you typed in only, and closing it leaves the other working. | `split-panes.spec.ts` |
| R3 | A restart brings back the tab, the folder it was in and its earlier output. | `restore-session.spec.ts` |
| R4 | A long command that fails in a tab you aren't looking at marks that tab. | `long-command-alert.spec.ts` |
| R5 | A setting saved in the Settings panel reaches config.toml and applies to open terminals. | `settings.spec.ts` |
| R6 | A shell with its own background shows it in its panes, at the console's opacity; others keep the theme's. | `pane-background.spec.ts` |

Not covered here (unit tests or manual): the global hotkey and tray (OS input), Windows
notifications, Claude Code itself, administrator tabs (UAC can't be automated).
