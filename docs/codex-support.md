# Codex CLI support

qterm runs the normal interactive Codex CLI in terminal panes. It does not require
an API key of its own or replace Codex's approval controls. The CLI interface was
checked against Codex CLI 0.164.0.

## Setup

1. Install and sign in to Codex CLI separately.
2. Open **Settings → Codex CLI** and enable **Remember Codex sessions** for the ⬡ menu.
3. Optionally choose **Set up Codex hooks** for session identification, permission
   alerts, activity events and last replies. qterm writes its entries into
   `$CODEX_HOME/hooks.json` (default `~/.codex/hooks.json`), preserving other entries
   and backing up the previous file as `hooks.json.qterm-backup`.
4. Review and trust these hooks using **`/hooks` inside Codex**, then start a new
   session. qterm does not bypass Codex's hook trust checks. Repeat this review after
   updating the hook definitions or moving qterm and updating the configured paths.
5. Sessions launched from qterm's menu and workspace restore use `--no-daemon` to
   keep hook processes associated with the correct pane. Use `codex --no-daemon`
   when launching manually. A shared server may have inherited another terminal's
   environment and cannot reliably identify the current qterm pane.

## Feature mapping

| Existing Claude feature | Codex equivalent |
| --- | --- |
| Remember printed resume IDs | Detect `codex resume <UUID>` and remember hook-identified sessions when enabled |
| Grouped session browser and search | Remembered sessions and active local rollouts, grouped by folder; title, branch and prompt count |
| New session in a folder | New Codex CLI tab in that folder |
| Resume in new/current tab | `codex --no-daemon resume <UUID>`; a busy or incompatible current pane falls back to a new tab |
| Command palette entries | Resume Codex and Resume Codex here |
| Restore sessions with workspace | Independent `codex_restore` setting; identified running sessions persist per pane |
| Running/idle tab indicator | Process detection plus optional lifecycle hooks; recent output is the fallback |
| Session titles on tabs | First user prompt from the rollout, retained with the workspace |
| Context/model usage | Reported model, latest request token count, context window and cumulative output tokens |
| Permission alerts | Optional `PermissionRequest` hook; tab marker and Windows notification |
| Last reply | Optional `Stop` hook; tab tooltip and completion alert |
| Waiting menu and navigation | Codex menu waiting list; shared Alt+Shift+W and tray attention count |
| Plan usage and warnings | Reported primary/secondary limits in the menu and tray; 80%/95% warnings |
| Install/remove hooks | Optional settings actions; preserve other hooks and back up changed JSON |
| Cache-expiry countdown | Unavailable: Codex does not report a corresponding expiry |
| Session cost | Unavailable: token counts do not establish subscription billing |
| Claude `StopFailure` API-error alert | No corresponding documented Codex hook; qterm does not synthesize an error reason |

## Data and limits

- The native Windows Codex home is selected through `CODEX_HOME`, falling back to
  `%USERPROFILE%/.codex`. WSL installations have their own session data and are not
  included in this native session index.
- The session browser reads active `sessions/**/*.jsonl` rollouts. Archived
  sessions are excluded. Forgetting a remembered session removes only qterm's
  entry, leaving Codex's data intact.
- User prompts are read from `event_msg.user_message` or, when those events are
  absent, `response_item` user messages. Known injected environment/instruction
  messages are excluded, and dual-format rollouts are not counted twice.
- On Windows, generated hook commands explicitly invoke PowerShell with an
  encoded, literal executable call so the parent shell cannot reinterpret the
  executable path. Older hook definitions need updating and renewed `/hooks` trust.
- qterm caches summaries until a rollout's modification time or size changes.
  Unknown records and malformed lines are skipped. Rollouts are an unstable
  implementation format; unavailable fields are not a guarantee of zero usage.
- Session IDs are UUID-validated before persistence and shell resume. Usage is
  resolved by session ID, avoiding ambiguous matches when two panes share a folder.
- Hooks outside qterm have no effect. Notification preference switches do not
  install hooks, change Codex approval policy or authorize tool calls.

Official references: [Codex hooks](https://learn.chatgpt.com/docs/hooks) and
[CLI reference](https://learn.chatgpt.com/docs/cli/reference).

## Verification

Unit tests cover rollout parsing, usage snapshots, malformed records, UUIDs,
workspace persistence, safe resume commands, and preserving existing hooks.
Desktop tests use an isolated `CODEX_HOME`, synthetic rollouts and a stand-in
`codex.exe` to exercise real PTYs, the inbox, event delivery, menus and tab markers.
They do not call a live model or exercise Codex's interactive hook trust screen.
