# Remaining Windows interoperability ownership

R97 proves normal qterm quit and a direct app-process crash end a Windows program
launched from WSL and its detached Windows child, while unrelated Windows programs
remain alive. Test cleanup pins exact executable/script/tag identities and never
supplies tree termination as evidence of app cleanup.

R98 and R99 originally exposed detached Windows children surviving pane close and
shell-preserving Stop. Creation-time ownership fixes close, and transport-aware
Stop now passes repeated Windows launch/Stop cycles, subsequent Linux input and
input reservation/recovery. The 12-case focused suite and all 130 full desktop
scenarios pass; app-wide cleanup alone is insufficient.

A per-pane qterm helper established a nested job before launching wsl.exe and made
the close test pass in the console-subsystem debug build. It failed all five
focused cases when built with the GUI subsystem used for releases: the WSL pane
exited before a prompt. That approach has been removed from production source.
The rejected prototype and logs remain only in ignored `.tools.local/` evidence.

Creation-time ownership is implemented for pane close/app exit. Session retains
the job; bounded in-flight operations clone its handle and observe cancellation.
Current implementation and acceptance:

- Implemented: narrowly scoped Windows job-list creation-attribute support in a
  licensed local portable-pty 0.9.0 patch (three source files). Do not
  assign an already-running WSL PID: early descendants can otherwise escape.
- Implemented: a private, non-inheritable kill-on-close job before spawning the client.
  Keep the handle alive across process creation and retain it in Session. It must
  be released before potentially blocking console teardown. Only recognized WSL
  profiles need this additional per-pane boundary.
- Implemented: inspect actual job membership for shell-preserving Stop. Preserve the original
  WSL client by pinned process identity; end only verified Windows program members
  of this pane's job, including detached children after their parent ends. Check
  membership after opening handles, fail on incomplete inspection, respect expiry
  and avoid targeting programs entered after a delayed Stop. Add no arbitrary-PID
  IPC endpoint or unrelated-tree termination.
- Capture original transport handles while the authenticated Linux bootstrap
  holds user/profile code. Return the PTY identity before the frontend flushes
  early protocol replies; `pty_ready` captures transport and releases the shell.
  Stop verifies a shell, ends Windows programs before console hosts, then ends
  remaining Linux programs. Backend and frontend reserve user input while
  retaining device replies; all waits and member inspection are bounded.
- R97/R98/R99, terminal controls and input reservation pass the GUI-subsystem
  suite (six cases). Removing Windows Stop cleanup reproduces the surviving
  `owned-child`; removing both input guards executes the forbidden command.
  Both fail for their intended assertions. Sources and the normal artifact were
  restored; both Stop cases pass again. Script/logs:
  `.tools.local/verify-checkpoint25-stop.mjs`,
  `.tools.local/checkpoint25-{missing-windows-stop,missing-input-reservation,stop-gui,stop-restored}.log`.
  Earlier creation-attribute removal reproduced R98 before the bootstrap guard
  was added; with the guard, missing assignment fails before user code launches.
  Full desktop acceptance passes: 130 scenarios, no skips/failures/flaky results,
  13.1 minutes. Report/log: `.tools.local/checkpoint25-full-desktop.{json,log}`.
  Final cleanup found no isolated WebViews, supervisors, fixture programs or
  lifetime files. This completes this ownership slice, not full WSL workflow parity.

This uses the normal Windows user's token. The user accepted unprivileged Linux
cleanup limits on 5 November 2026; the root-supervisor proposal is deferred and
no privileged Linux execution is authorized. Windows job creation and nesting behavior is documented in
[Microsoft's job-object documentation](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects).
