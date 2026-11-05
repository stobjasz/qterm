# Running-agent follow-ups: product decision

**Decision, 5 November 2026:** the user answered “1 defer.” Automatic delivery to
running agents and opt-in managed agent sessions are explicitly deferred from
this delivery. Normal CLI agents remain primary; reviewed new/idle-shell handoffs
and Copy brief remain implemented. The design below is retained for future work.

The existing reviewed brief workflow supports a new agent tab or a confirmed idle
shell. It does not deliver structured input to an already running provider. That
was an explicit outstanding requirement before this deferral. No managed
conversation/approval integration is enabled today.

## Protocol evidence

Codex App Server documents structured turn creation and active-turn steering.
Steering includes the expected live turn ID and rejects an absent or mismatched
turn. Its client protocol also includes execution/file/permission approvals and
questions requiring user input. A hosted integration must account for those
requests. The documentation also describes connecting the CLI terminal interface
to a server; that does not establish that an arbitrary existing qterm terminal has
a compatible reachable control endpoint. Source: [official App Server documentation](https://learn.chatgpt.com/docs/app-server).

No Codex CLI was found on this tool session's PATH. The local supported version,
transport, remote-terminal behavior and provider approval routing still require
an isolated feasibility check. No model call, live transcript read, server launch
or provider-configuration change has been made for this proposal.

## Recommended implementation

Add an explicit opt-in managed-agent session type, retaining normal terminal
agents as the default. A managed session would expose conversation progress,
provider approval questions and reviewed follow-ups through qterm. Begin with
an isolated provider capability adapter; verify a specific installed version
before exposing delivery. Preserve a provider-neutral interface for the second
provider, with unsupported capabilities reported honestly.

Each reviewed delivery binds provider/session/environment/project and, for
steering, the active turn ID. Queue behind a running turn by default; make steering
a separate explicit action. Send bounded brief text as protocol data, never as a
shell command. Require the user's Send action after preview. Keep a delivery
receipt and stable request ID; an uncertain/disconnected send must not replay
automatically. A changed target requires a fresh review.

Display genuine provider approval/input requests with their content and current
resolution state. Preserve provider sandbox and permission settings. Existing
named-task grants do not authorize provider approvals or arbitrary execution.
Keep provider retention preferences, selected source context and explicit
cross-provider handoff consent separate. Do not convert existing terminal sessions
or attach to unverified endpoints automatically.

## Alternative requiring an explicit scope decision

Defer managed sessions and automatic running-agent delivery. Keep the implemented
new/idle-shell handoffs plus Copy brief for manual use in an existing agent. This
would be a user-approved deferral of the outstanding feature, not evidence that
automatic delivery has been implemented.

## Acceptance before shipping

Verify the actual CLI/protocol version in isolated homes without model calls,
then prove review/target changes, active-turn fencing, cancellation, restart,
unknown send outcomes, real questions versus status notifications, and unchanged
approval policy. Test native and WSL environment separation. Model-backed manual
validation requires its own explicit authorization. Keep all current terminal,
handoff, inbox and scoped-task regressions passing.
