# Codex CLI support

qterm runs the normal interactive Codex CLI in terminal panes. It does not require
an API key of its own or replace Codex's approval controls. The CLI interface was
checked against Codex CLI 0.164.0.

## Setup

1. Install and sign in to Codex CLI separately.
2. Open **Settings → Codex CLI** and enable **Remember Codex sessions** for the ⬡ menu.
3. Optionally choose **Set up Codex hooks** for session identification, approval
   activity and last replies. qterm writes its entries into
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
| Activity tab indicator | Optional lifecycle hooks report working/idle; process detection with recent output is an activity hint, otherwise status is unknown |
| Lifecycle details | Approval checks are explicitly unconfirmed input, Stop shows completed, interruption shows idle; new submitted input invalidates the previous event, with source/time on hover |
| Session titles on tabs | First user prompt from the rollout, retained with the workspace |
| Context/model usage | Reported model, latest request token count, context window and cumulative output tokens |
| Approval activity | Optional `PermissionRequest` hook; informational tab/inbox entry, without a false question or Windows toast |
| Last reply | Optional `Stop` hook; tab tooltip and completion alert |
| Waiting menu and navigation | Only confirmed input requests belong in waiting lists, Alt+Shift+W and tray counts; approval-routing hooks are excluded |
| Plan usage and warnings | Reported primary/secondary limits in the menu and tray; 80%/95% warnings |
| Install/remove hooks | Optional settings actions; preserve other hooks and back up changed JSON |
| Cache-expiry countdown | Unavailable: Codex does not report a corresponding expiry |
| Session cost | Unavailable: token counts do not establish subscription billing |
| Claude `StopFailure` API-error alert | No corresponding documented Codex hook; qterm does not synthesize an error reason |

`PermissionRequest` happens before approval is resolved. Another hook or automatic
review may approve it without showing a question. qterm therefore records it as
**Approval check (input not confirmed)**, includes the tool/reason/command when
provided, and does not send an answer-required notification. Actual approval
questions remain in Codex's UI. See the [official hook behavior](https://learn.chatgpt.com/docs/hooks#permissionrequest).
Old inbox entries that incorrectly treated this hook as a question are migrated
to informational history, without claiming qterm approved anything.

Completed-reply alerts are titled **Codex turn completed**, not task completed.
Empty replies produce no toast, and identical notifications in the same pane and
session are deduplicated for 30 seconds. Desktop test builds never deliver toasts
or register the production notification ID; they record delivery attempts locally.

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
- **Native Windows** shows the resolved native Windows Codex home, rollout-file
  counts, unrecognized files, missing sessions folders and bounded read errors.
  **Refresh** rescans without closing the menu; **Copy Codex home** copies the path.
  A failed refresh retains the previous results and labels them as a previous scan.
- Active panes share one batched usage scan per poll, performed outside the async
  runtime's worker threads. Unsupported unchanged files are cached until they change;
  failed reads remain retryable.
- Settings shows the last received event and its receiving pane. **Test Codex local
  delivery** exercises qterm's own executable/inbox/watcher; it does not test Codex's
  `/hooks` trust screen or execute provider hooks from your configuration.
- **Ask an agent about this** sends a reviewed local brief as a file reference in a
  normal initial CLI prompt. It opens a new tab or reuses an idle shell pane; it
  does not type into a running Codex session or answer its permission prompts.
  Copying the brief supports manual follow-ups. Automatic follow-ups to running
  sessions remain planned and require a structured provider transport.
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
