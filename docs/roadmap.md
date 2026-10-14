# qterm roadmap

What's still to do. Finished items, with what each delivered, are in
[roadmap-archive.md](roadmap-archive.md); the original milestones (M0 to M6) and the
design notes are in [foundation.md](foundation.md). New ideas get the next number.

Status: ⬜ open, 🚧 in progress. Effort: S = small, M = medium, L = large.

## Claude Code

| # | Feature | Effort | Status |
|---|---|---|---|
| 16 | **"Ask Claude about this"**: select an error, then a palette action opens a pane in that folder with `claude "<selection>"`. | S | ⬜ |
| 40 | **New Claude session in a git worktree**: `git worktree add` on a new branch, then a pane there running `claude`, for parallel tasks in one repo. | M | ⬜ |
| 41 | **Usage overview**: tokens and estimated cost per day and per project across all sessions (the per-tab figures from #17, summed). | M | ⬜ |
| 53 | **Answer permission prompts from the notification** (PermissionRequest hook): Allow / Deny on the Windows notification. Off by default; needs a careful security design. | M–L | ⬜ |
| 54 | **Claude's last reply on hover** (Stop hook's last message): in the tab tooltip and the waiting list; no notification. | S | ⬜ |
| 55 | **Tasks and subagents per tab** ("3/7 tasks", "2 agents") from the task and subagent hooks, and a marker while compacting. | S–M | ⬜ |
| 56 | **Cache-cold countdown** on idle Claude tabs (status line's prompt cache data): resuming after the cache expires costs more. | S | ⬜ |

## Projects and tools

| # | Feature | Effort | Status |
|---|---|---|---|
| 64 | **Project tasks in the palette**: the scripts of the pane's project (package.json, Cargo, Makefile, justfile, composer.json, pyproject), run in a new split beside it. | M | ⬜ |
| 65 | **Git status per tab**: branch, uncommitted changes, ahead/behind for the pane's folder, in the tab tooltip and the palette; refreshed after each command. | S–M | ⬜ |
| 66 | **Project settings** (`.qterm.toml` in a repo): tab name, colour and icon, snippets and triggers that apply in panes inside that project. | M | ⬜ |
| 67 | **Containers as shells**: running Docker / Podman containers in the ▾ menu and palette, opened with `exec -it` (like the SSH hosts). | S–M | ⬜ |

## Output and processes

| # | Feature | Effort | Status |
|---|---|---|---|
| 68 | **Problems list**: compiler and test errors (tsc, eslint, rustc/cargo, go, pytest, dotnet) collected from every pane's output into one list; click to open the file at its line. | M | ⬜ |
| 69 | **Dev server links**: a "Local: http://localhost:5173" in the output becomes an "Open" button on the tab while the server runs. | S | ⬜ |
| 70 | **Stop what runs in a pane**: end the running program and everything it started (when Ctrl+C isn't enough), keeping the shell. | S | ⬜ |
| 71 | **Who uses this port?**: the palette names the process listening on a port, with its pane if it's one of qterm's, and can end it. | S | ⬜ |
| 72 | **Run on change**: re-run a pane's last command whenever files in its folder change (a quick watch mode for tests and builds). | M | ⬜ |
| 73 | **Command timestamps and durations**: when each command ran and how long it took, on its ✓/✗ bar and in recent commands. | S | ⬜ |

## Terminal

| # | Feature | Effort | Status |
|---|---|---|---|
| 48 | **Accessibility**: screen reader mode (xterm.js) and a minimum-contrast setting. | S | ⬜ |
| 58 | **Sticky command header**: while scrolling long output, the command that produced it stays at the top. | M | ⬜ |

## Safety and convenience

| # | Feature | Effort | Status |
|---|---|---|---|
| 74 | **Multi-line paste warning**: pasting several lines into a shell asks first (they would run one by one); off for Claude Code panes, where multi-line input is normal. | S | ⬜ |
| 75 | **Paste an image as a file**: an image on the clipboard is saved to a temp file and its path typed, for Claude Code and other tools that read images from paths. | S | ⬜ |
| 76 | **JSON viewer**: select JSON in the output (or a command's whole output) and see it formatted and foldable, with copy of any value. | M | ⬜ |
| 77 | **Notes per workspace**: a plain text scratch pane kept with the workspace, for commands, TODOs and findings. | M | ⬜ |

## The console window

| # | Feature | Effort | Status |
|---|---|---|---|
| 27 | **A second console on its own hotkey** (scratch console, or docked bottom/side). | M | ⬜ |
| 49 | **Size toggle**: a key that switches the console between its height and full screen. | S | ⬜ |

## Install, release and setup

| # | Feature | Effort | Status |
|---|---|---|---|
| 30 | **Publish to winget** (after #13). | S | 🚧 manifests for 0.2.1 validated (`winget/`, `stobjasz.qterm`); later releases submitted by `release.yml` once `WINGET_TOKEN` is set; first submission pending |
| 34 | **Code signing** (e.g. Azure Trusted Signing) in `release.yml`, so SmartScreen stops warning on first run. | S + cost | ⬜ |
| 38 | **ARM64 build** next to x64 (Windows on Snapdragon). | S–M | ⬜ |
| 61 | **Fully portable mode**: a marker file next to the exe keeps settings and data in that folder (USB stick). | M | ⬜ |
| 62 | **Start menu jump list** (installed copy): recent folders and workspaces. | M | ⬜ |

## Suggested next

- Small Claude Code wins: #54 (Claude's last reply on hover) and #56 (cache-cold
  countdown, from #51's status line data).
- For developers, the most for little effort: #64 (project tasks in the palette), #74
  (multi-line paste warning) and #69 (dev server links).
- #30 (winget): the 0.2.1 manifests are ready; it needs the first submission and the
  `WINGET_TOKEN` secret.
