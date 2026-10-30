# Proposed local interface for coding agents

Status: the user approved named-task execution with explicit, session-only project
grants on 29 October 2026. Authenticated scoped reads are implemented and verified;
see [the current interface](local-agent-interface.md). Separately granted named-task
execution and status are implemented, including native PowerShell, Cmd and Git Bash validation.
This document itself enables no grant or listener.

## User outcome

An agent can inspect a failed build and request a named project check through
qterm, receiving a stable command ID and a structured result. The developer can
see which agent requested it, what ran, and where its output lives.

## Initial operations

| Operation | Input | Result | Capability |
| --- | --- | --- | --- |
| `panes.list` | workspace/project ID | Scoped pane IDs, labels, cwd, environment | Inspect workspace |
| `commands.list` | pane ID, cursor | Recent command IDs, command, exit status, timestamps | Read command results |
| `commands.result` | command ID, output cursor, byte limit | Exit status, bounded output, next cursor, truncation/staleness | Read command results |
| `tasks.list` | project ID | Discovered named commands and manifest source | Inspect workspace |
| `tasks.run` | project ID, task ID | Run ID and visible pane ID | Run named tasks |
| `tasks.status` | run ID | Running/finished/failed, exit code and result reference | Read command results |

No endpoint accepts shell source, keystrokes, a provider approval response, a
secret-bearing environment override, or an arbitrary executable path. Initial
output pages are capped at 64 KiB and explicitly identify omitted/expired output.
Keep command metadata after the terminal buffer evicts output, but report that
the output is unavailable rather than returning unrelated current scrollback.

## Transport and identity

- CLI first, optional MCP adapter over the same service later.
- Windows named pipe scoped to the current OS user and app instance; no TCP
  listener. Use explicit pipe ACLs and reject remote pipe clients.
- A random per-connection capability token identifies the grant. Scope and expiry
  are checked on every operation, not just at connection time. Tokens never enter
  diagnostic logs or command history.
- A local caller using the same OS account is not isolated from that account's
  other processes by this design. Capability controls make integrations explicit;
  they are not a sandbox against malware running as the user.

## Grant UI and execution rules

An **Agent access** panel shows the client, canonical project directory, permitted
operations, expiry and active runs. A revoke action immediately rejects new
operations. Revocation does not silently kill an already-running task; the UI
offers an explicit stop action.

Even read access needs an explicit project grant because command output can
contain source code or secrets. Default grants expire with qterm. Persisting
grants would be a separate, visible opt-in.

Task execution needs a separate capability. Bind it to the canonical repository
root, chosen shell/environment and a reviewed task definition. A changed command,
manifest or execution directory invalidates the grant. Reject traversal and
out-of-scope canonical paths; do not assume a matching textual prefix is safe.
Do not run installation/bootstrap tasks merely because an agent connected.

Every invocation creates a visible, named command run, with its requester and
result available for inspection. Never type into an existing interactive agent
or editor pane. Apply concurrency and output limits and preserve existing close
confirmation behavior.

## Decision before implementation

Approved: implement inspection and bounded command results, then named-task
execution disabled until the developer grants it per project. Grants expire with
the qterm process. No further approval is needed to implement this policy;
persistent grants or broader execution authority would require another decision.

## Required checks

Reject unknown/expired/revoked tokens, remote clients, wrong-project pane IDs,
changed task definitions, traversal and symlink/junction escapes. Verify output
limits, cancellation, multiple concurrent clients, process crashes and cleanup.
An MCP adapter must obey exactly the same grants and cannot expand authority.

## Implementation sequence after worktree tasks

1. Implement the native grant model and read operations over the existing durable
   command-record store. Canonical project identity gates every command/pane;
   unknown folders remain inaccessible. Keep grants and requester identity in
   memory only. Return structured denied/expired/revoked/unavailable responses.
2. Add an opt-in **Agent access** panel with a separately reviewed native shell
   and named task definitions. Bind execution to task command, manifest contents,
   canonical execution folder and shell configuration. Store connection credentials
   in a current-user-only local file; copy its path, not the token, into terminal
   instructions. Revocation removes credentials and rejects subsequent operations.
3. Add the Windows pipe transport and CLI mode. Use explicit current-user pipe
   ACLs, remote-client rejection, cryptographically random names/tokens, bounded
   framing, concurrency and operation deadlines. Keep the listener disabled until
   a grant exists. Do not rely on the default pipe security descriptor: it can
   grant read access to Everyone/anonymous. Use cancellable overlapped I/O rather
   than an indefinitely blocked worker or legacy nonblocking pipe polling.
4. Add named-task execution through a new visible tab and the existing prompt
   gate. Assign its stable request/run ID before launch; retain requester and
   queued/running/finished/error state. No input goes to an existing program.
   A revoked grant blocks new requests; stopping an accepted run remains explicit.
5. Exercise the actual pipe and CLI through temporary Git projects and the real
   desktop app. Verify scoped reads, bounded Unicode output, manifest/profile
   changes, reconnects, multiple clients, cancellation, revocation and crashes.
   Prove no listener or credentials survive the session. The optional MCP adapter
   follows only after these invariants pass.

Transport references: [named-pipe security](https://learn.microsoft.com/en-us/windows/win32/ipc/named-pipe-security-and-access-rights),
[CreateNamedPipe flags and I/O modes](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-createnamedpipea).
