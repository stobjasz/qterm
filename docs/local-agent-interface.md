# Local agent access

The interface supports explicitly granted project reads and separately selected
named tasks. All authority expires with the qterm session; see
[the design](local-agent-interface-proposal.md).

## Create a session grant

Open **Access** in the tab bar or the `agent_access` palette action. Select Windows
or an explicit WSL distribution, enter its Git project folder and a client label,
then choose **Review project access**. Review the environment and canonical
repository root, select the read-access checkbox, and choose
**Create session read grant**. Reviewing alone opens no listener or credentials.

A read grant permits pane metadata, retained completed command results and
named task definitions for that project. It includes output that can contain
source code or secrets. It does not grant terminal input or execution authority.
The client label identifies the grant you created; it is not a verified provider
identity. Programs running as your Windows user can read the connection file.

Command metadata includes the captured environment when available (older records
can report null). WSL and unknown-environment results are excluded from native
grants even if their shell label or reported cwd looks native. Editing a shell
profile does not change an existing WSL pane's eligibility. A Linux grant requires
the matching captured distribution and WSL shell kind; canonical, case-sensitive
Linux containment excludes other projects and escaping symlinks. Linux grants
also bind the current user and project/Git filesystem identities. They do not
require provider transcript indexing to be enabled.

For execution, select **Review named-task execution too** and choose a supported
shell in that environment before reviewing. Inspect each command, original directory, source manifest
preview and SHA-256. Select the individual tasks, then explicitly allow them for
this session and choose **Create session task grant**. Leaving all tasks unselected
creates a read grant. Manifest previews are bounded and labelled if truncated;
inspect the full file before authorizing a truncated definition. No task runs
while reviewing or creating the grant.

Use **Copy connection path** to give the client the path to its private connection
file. Tokens are not shown in the UI or put in a shell command. **Revoke access**
invalidates that grant immediately and removes its credentials. Grants are kept
in memory only and are not restored. Windows deletes connection files when their
qterm-owned handle closes, including after a crash. The last revocation stops the
listener; qterm starts with access off next time.

## CLI

Use the actual executable path shown in the panel. The CLI mode exits without
starting a window or toggling the running app:

```powershell
$connection = 'C:\path\copied-connection-file.json'
& 'C:\path\qterm.exe' --agent-client $connection commands.list '{}' | ConvertFrom-Json
& 'C:\path\qterm.exe' --agent-client $connection commands.result '{"commandId":"RUN_ID","offset":0,"limit":65536}' | ConvertFrom-Json
```

Piping stdout makes PowerShell wait for a Windows GUI executable. A coding agent
can spawn the executable directly and capture stdout. Responses are one JSON
object with `version`, optional request `id`, and either `result` or an `error`
containing `code` and `message`. Errors use a nonzero process exit code. An expired
connection file requires a new grant; no command automatically recreates one.

From WSL, invoke the same executable through Windows interop. Convert the
executable path to Linux spelling and retain the copied connection path in
Windows spelling because the Windows executable opens it:

```bash
exe="$(wslpath -u 'C:\path\qterm.exe')"
"$exe" --agent-client 'C:\path\copied-connection-file.json' tasks.list '{}'
```

The real Linux-client route is covered by the desktop test with provider indexing
disabled. It uses the same private Windows named pipe; there is no Linux TCP
listener. WSL interop must be enabled for this invocation.

| Method | Parameters | Result |
| --- | --- | --- |
| `panes.list` | `{}` | Scoped pane IDs, labels, cwd/profile/kind/environment and observation time |
| `commands.list` | Optional `paneId`, `after` command ID, `limit` (1–25) | Completed command metadata/previews and next cursor |
| `commands.result` | `commandId`, optional UTF-8 byte `offset` and `limit` | Full recorded command, bounded output, next byte offset, incomplete-capture flag and historical repository comparison |
| `tasks.list` | Optional `after` task ID and `limit` (1–25) | Read grants discover root tasks; execution grants list their selected tasks, source/directory and bounded command previews |
| `tasks.run` | Granted `taskId` and stable client `requestId` | Stable invocation ID, requester, launch state and eventual visible pane ID |
| `tasks.status` | `runId` | Project-scoped invocation state, timing, reported exit code, errors and result ID |

Only known parameters are accepted. No method accepts shell source, keystrokes,
an executable, environment overrides or another project root. Foreign or expired
command/pane IDs return no data. Task IDs are derived from manifest source and
task name; a command preview marked truncated is not the full task definition.

## Run a granted task

Take a task ID from `tasks.list` and use a new request ID for each intended run:

```powershell
& 'C:\path\qterm.exe' --agent-client $connection tasks.run '{"taskId":"TASK_ID","requestId":"check-after-parser-fix"}' | ConvertFrom-Json
& 'C:\path\qterm.exe' --agent-client $connection tasks.status '{"runId":"RETURNED_RUN_ID"}' | ConvertFrom-Json
```

Retrying the same request ID and task within a grant returns the existing run;
it does not execute again, including concurrent retries. Reusing a request ID for
another task is rejected. A new request ID deliberately starts a new run.
Read-only grants cannot execute, and unselected tasks cannot be requested.

Execution is bound to the exact configured shell program/arguments/environment,
reviewed manifest contents, resolved launch command and canonical directory.
Those definitions are rechecked on request, claim and launch. Changes require
restoring the reviewed definition or issuing a new grant. A task cannot supply
different arguments, commands, executables or environment overrides through the
API. Source-code changes are allowed; the launch definition remains bound.

Every accepted invocation opens a new named tab. Its input is reserved while the
shell starts and qterm waits for an empty prompt in the reviewed folder. Rust
checks the actual shell binding and canonical reported folder before writing the
reviewed command. It never types into an existing pane/program. Choose a profile
that reaches a prompt without interactive startup; a blocked startup can be
cancelled from Access, after which its tab is available for manual use.

PowerShell, Command Prompt and native Git Bash profiles are supported. The Cmd
review shows a child-interpreter wrapper around the named command, which keeps
batch-file cancellation from trapping the interactive shell in a confirmation
prompt. Git Bash reports native Windows folders, including its `/tmp` mount, and
its launcher/interpreter pair remains owned by the pane. WSL execution is not
enabled by these native grants.

States include `queued`, `launching`, `running`, `stopping`, `finished`, `cancelled`
and `unknown`. `finished` means the shell reported completion; inspect its exit
code and captured output. Command Prompt can omit the exit code, which remains
unknown. A failed/uncertain PTY write stays unknown and is never automatically
retried. If the shell exits before reaching its startup prompt, qterm clears the
input reservation and cancels the task; a failed shell remains visible. Retrying
that request ID returns the cancelled invocation and does not replay it.
The stable invocation ID is also the completed command-record ID.
Saved results retain the environment, requester label, task and request ID across
restarts, subject to command-history retention. Live invocation state is session-only.

The Access panel lists requested tasks, links their panes/results, and provides
an explicit **Stop task** action. Revocation cancels queued or waiting launches;
it does not kill an already accepted running task. Stop sends an interrupt and
ends that task pane's descendant programs. Other panes are preserved. A late
completion report can still retain the actual exit/output after stopping.

Up to four agent invocations can be active, with at most 1024 invocation IDs per
app session. Recent history and every active invocation stay visible. The result
store independently retains its normal rolling limit. Repository evidence is
prepared before launch when supported; an evidence failure is shown and does not
pretend to verify the task or prevent its execution in a large/unsupported repo.

Command results use the normal durable history and retention limits. A byte page
contains at most 64 KiB of UTF-8 output and never splits a character. Supply the
returned `next` offset for the following page; an offset inside a character is
rejected. Truncated/lost captures remain explicitly incomplete. Command-list
cursors that have fallen out of retention return `cursor_expired`; start a new
list. This API never substitutes unrelated live scrollback for missing output.

Exit status and repository evidence describe the saved command and its recorded
comparison time. Reading a result does not run a new check or compare the current
repository: `lastRepositoryComparison` is historical, and
`repositoryComparedForThisRequest` is false. Consult the evidence timestamp and scope; an earlier success does
not validate later edits. See [verification records](verification-records.md).

Pane observations refresh on workspace changes and every five seconds while a
grant exists. They become unavailable after fifteen seconds without an update;
they are not proof that a process is idle. Unknown or unreachable/deleted folders
and panes from another environment remain inaccessible. Canonicalization prevents
a junction or symlink inside the project from exposing output recorded outside it.
Command history uses the folder captured when each command started. Moving a pane
outside the project leaves its earlier project records readable; commands started
outside remain excluded, including result requests with a known command ID.

## Transport and bounds

The local Windows pipe uses a cryptographically random per-listener name and a
256-bit per-grant token. Both pipe and credential file have a protected DACL that
allows only the current Windows user. Remote pipe clients are rejected. There
is no TCP listener. These controls make local integrations explicit; they do not
sandbox other programs already running as the same user.

Each connection carries one request and one response, framed as a four-byte
little-endian byte length followed by UTF-8 JSON. Requests contain `version: 1`,
optional string `id`, `token`, `method` and `params`. The CLI reads the token from
the connection file. Request frames are capped at 64 KiB, response frames at
512 KiB, with eight simultaneous handlers and I/O deadlines. Use smaller page
limits after `response_too_large`. The server rechecks the active project grant
before returning a domain result. Persistent grants and an MCP adapter are not
enabled by this implementation.
