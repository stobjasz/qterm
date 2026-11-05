# WSL ownership and privileged descendants

**Decision, 5 November 2026:** the user clarified “limits,” accepting the current
unprivileged Linux cleanup boundary for this delivery. The root supervisor is
not approved or implemented. Native Windows and same-user Linux ownership remain
as tested; descendants that gain Linux privilege may survive user-level cleanup.
The proposal below is retained for separately authorized future work.

The user selected ending every descendant when qterm exits. Windows Job Objects
cover native descendants. The WSL lifetime-file/subreaper implementation currently
covers same-user Linux descendants, including double forks, on pane close, app
exit and Windows crashes. Real-app tests preserve unrelated Linux processes and
verify stdin, interrupts and resize behavior.

A remaining boundary is Linux privilege: an unprivileged supervisor cannot signal
a child that changes identity through `sudo`. PID file descriptors prevent PID
reuse errors but do not grant signal permission. Therefore same-user cleanup
alone does not enforce the original unrestricted descendant policy. The user
explicitly accepted this privilege limitation for the delivered scope.

## Proposed complete ownership boundary

- Start only the fixed embedded supervisor using the selected distribution's
  `wsl.exe --user root --exec /usr/bin/python3 -I -S ...` path. No arbitrary
  root command endpoint, root terminal or project-supplied Python is exposed.
- Sanitize the privileged launch environment before starting its executable.
  In particular, profile/Windows `LD_PRELOAD`, `LD_LIBRARY_PATH`, Python startup
  variables and WSLENV forwarding must not reach the root dynamic loader.
  Transfer the user's profile environment as bounded literal data and apply it
  only after dropping privileges. Python isolated mode alone does not protect
  an executable from dynamic-loader environment injection.
- Resolve the distribution's normal user's UID, GID, groups and home using a
  separate fixed read-only operation. Bind that identity to the exact distribution.
  Explicit-user and ambiguous profiles remain unsupported for automatic launch.
- The supervisor retains root only to monitor and signal its own descendants.
  Fork the interactive shell with the original user's supplementary groups,
  GID and UID; preserve user HOME/USER/SHELL and profile environment. The shell,
  provider CLI and project commands run as the normal user. Existing `sudo`
  behavior stays under the user's control.
- Establish subreaping before any user process. Keep the private, immutable,
  non-inheritable Windows lifetime file. Cleanup uses pinned process handles for
  the supervisor's own kernel-reported children, repeatedly reaping orphans.
  No whole-distribution termination or unrelated process scan/kill is allowed.
- Validate the target identity and terminal ownership before exec. On missing
  Python/kernel/root-launch support or failed privilege drop, start no user shell
  and report the failure. Do not silently claim full ownership after fallback.

This is a major security/product decision because qterm would hold a root Linux
supervisor even though its terminal remains unprivileged. It requires user
approval before implementation or root execution. No root supervisor has been
started by the current work. Current work is unreleased; installed qterm is unchanged.

## Required evidence after approval

Real installed-distribution tests must prove normal shell identity/groups/home,
interactive input/job control/resize, unprivileged and sudo descendants cleaned
after pane close/normal exit/Windows crash, and unrelated user/root processes
preserved. Hostile loader/Python startup configuration must not execute as root.
Deliberately break cleanup, identity drop and ownership scope, restore,
then pass the relevant tests. Windows interoperability descendants need a separate
ownership check before claiming the entire WSL process boundary complete.

Reference: [Linux PID-file-descriptor signal permission checks](https://www.man7.org/linux/man-pages/man2/pidfd_send_signal.2.html).
