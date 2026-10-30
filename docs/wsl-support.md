# WSL project and diagnostic support

WSL project, path and explicit session discovery support is implemented. Full agent/session parity remains
in progress; see [the remaining plan](wsl-parity-proposal.md).

Detected distribution profiles carry their distribution explicitly. Custom
`wsl.exe` profiles participate when their command names `-d`/`--distribution`
before `--exec` and does not select another Linux user. Ambiguous commands keep
their generic profile behavior. Recognized WSL profiles require `/usr/bin/python3`
3.9+, Linux subreaper/PID-file-descriptor support and access to the Windows temp
filesystem for process ownership. Missing support produces a visible launch
error before the shell starts; qterm does not silently launch an unowned shell.
Custom Linux commands must follow `--exec`/`-e`; unsupported WSL launch options
produce an error. Project inspection additionally needs `/usr/bin/git`.

With shell integration enabled, WSL Bash can report its actual Linux folder,
command boundaries and exit code. No shell profile file is edited. User startup
files that replace `PROMPT_COMMAND`, and other shells, can prevent this telemetry;
missing telemetry remains unknown. qterm preserves Linux path case and does not
interpret `/c/...` as a Windows drive.

Project settings, manifest tasks and Git status come from the pane's distribution.
Read-only Git inspection disables configured hooks, fsmonitor and filters and
bounds output and execution time. Discovering a task does not execute it. File
links resolve in Linux first, then pass the actual distribution-specific UNC file
to the configured Windows editor with its line and column. Linux names that cannot
be represented safely by this Windows path transport produce an error.

Completed command records retain their originating environment. Opening a saved
diagnostic continues to use that distribution after a profile is edited or the
pane changes folder. An unavailable distribution produces an error; qterm does
not substitute the default distribution. Native agent grants still exclude WSL.

New panes save their captured environment alongside the profile and folder, for
both automatic recovery and named workspaces. Restoring an edited profile checks
that environment before starting any process. A different distribution, a native
replacement, or a missing captured profile leaves the pane's saved output visible
with a launch error. Use **Switch this pane to…** explicitly to recover in another
profile. Split/switch folder transfer uses the original pane identity even if its
custom profile definition has changed.

Windows/WSL folder transfers now query `/usr/bin/wslpath` in the selected
distribution instead of assuming a `/mnt/<drive>` root. Linux aliases are
resolved before conversion. Windows folders can transfer between distributions
through their actual Windows path; distro-only folders remain scoped. Cmd still
cannot start in a UNC folder. Translation errors keep the original pane intact.

Dropped files and clipboard PNG paths use the captured destination environment,
then shell quoting. A foreign distribution's UNC file is rejected, and raw Windows
paths cannot enter the WSL quoting helper. If the pane changes or a new command is
submitted while translation runs, the delayed paste is cancelled. Completed
records and file quoting also retain the shell kind captured when the pane starts.
Broadcast file delivery translates and quotes for each destination separately,
while reusing translation within the same distribution. All paths are prepared
before typing. If translation fails, any target changes session/input turn, or
the broadcast group changes during preparation, nothing is pasted. Reserved task
startup panes cannot receive these pastes. Terminal device/status replies stay
in their originating pane; user keyboard input still broadcasts normally.

Linux-to-Windows conversion rejects names that Windows cannot safely represent
and checks that the resulting Windows path is accessible. A failed conversion
keeps the original pane and reports the error rather than opening another shell
at its home folder.

Project tasks opened through a split now wait for an empty shell prompt and check
the reported folder before submitting their command. Shell integration must be
enabled; this does not type a task into a profile's startup program.

Older saved workspaces did not capture this identity. Built-in `wsl:<distro>` IDs
can recover it; an older custom profile must use its current definition once,
since the former distribution was never recorded. Future saves retain it.

The fixed JSON bridge has no caller-supplied script operation, a four-operation
concurrency bound, bounded requests/results and deadlines. Reviewed session
handoffs write literal UTF-8 briefs in the selected distribution's cache.
Control Python runs in isolated mode without site initialization, so a project's
`PYTHONPATH` or `sitecustomize.py` cannot execute through these helpers. This does
not change the environment or startup behavior of the user's actual shell/tools.
WSL environment sharing uses Microsoft's documented
[WSLENV flags](https://learn.microsoft.com/en-us/windows/wsl/interop#share-environment-variables-between-windows-and-wsl-with-wslenv):
the Bash prompt variable flows Windows to Linux; pane/inbox association retains
raw paths needed by the Windows hook executable.

**Settings → WSL session sources** adds explicit distribution/home choices. Sources
default disabled and each provider's history setting is an additional gate. Use
**Sessions → Discover / refresh enabled sources** to read transcript summaries.
Native and WSL sessions with the same UUID remain separate. Changing or disabling
a source drops its discovered context; pins retain only references. Unavailable
distros report errors without a default substitution. See [source behavior and
limits](session-library.md).

Verified WSL source sessions can resume or open a reviewed session handoff in a
matching distribution profile. Resume binds the discovered provider home even
when shell startup files set another home. Launch waits for a reported empty
prompt in the exact, case-sensitive Linux folder; `/c/...` is never a Windows
drive alias. Changed source/home, disabled history and revoked sources cancel
pending launches. A missing compatible profile produces an error.

Reviewed command output can open either provider in a new matching-distribution
tab or the confirmed idle source shell. The brief retains the command's original
folder even after the source moves. Reuse requires an actual empty prompt, the
exact original folder and broadcast mode off. qterm checks the prompt/input state
again after filesystem work and cancels if it changed; Linux availability is not
inferred from a Windows process scan.

Native process/usage lookups exclude WSL and unknown custom shells; explicit hook
reports retain their provenance.

Each recognized WSL pane has a private Windows lifetime file and a Linux
supervisor. Its file handle is non-inheritable and Windows deletes it on close or
process termination. The supervisor leaves Bash's original terminal handles and
process-group management in place. Closing a pane cleans that Linux tree; normal
qterm exit or a Windows crash cleans owned same-user Linux trees, including
detached double-forked children. Unrelated Linux processes remain running. Cleanup uses
pinned process handles and only the supervisor's own children. No distribution
is terminated, and no helper is installed in the distribution.

Still open: Linux live-process/lifecycle probes, Windows interoperability process
ownership validation, older provider-menu scoping and running-session follow-ups.
Full agent parity is not yet complete.
The current user-level supervisor cannot signal descendants that become root
through `sudo`. Full privileged-descendant ownership is pending the security
decision in [the root-supervisor proposal](wsl-ownership-proposal.md); it is not
claimed complete by the same-user cleanup tests.
