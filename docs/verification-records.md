# Command history and repository evidence

Open **Problems and command runs** to inspect saved command results. Shell
integration supplies command boundaries, folder, exit status and timing. qterm
keeps up to 100 recent records within a 32 MiB history budget in its local
`command-runs.json`. Each output is bounded to 128000 UTF-16 units; incomplete
captures and truncated commands are labelled. Truncated commands cannot be rerun.

Failed saves retain records in memory and show **Save problem** with automatic
and manual retry. Unreadable saved history is preserved until **Recover command
history** explicitly backs it up. Clearing history requires confirmation. Saved
records survive restarts; pane navigation is available only for the original app
run and an existing pane.

## Run a check with evidence

Select a previous command and choose **Run with repository tracking**. Review the
exact command, original folder, environment and shell, then choose **Run reviewed command**.
Opening this preview runs nothing. qterm captures repository state and starts the
command in a new tab using the original native or WSL shell profile. The profile
must still match the recorded environment and shell kind, with shell integration
enabled. WSL checks additionally retain the exact reviewed launch configuration
and distribution, then authorize their actual pane/session at an empty prompt in
the captured folder. A changed profile or folder cancels startup. Unclassified
shells are unsupported.

The before-run snapshot includes canonical repository root, HEAD, branch, staged
entries, tracked and nonignored untracked paths, and SHA-256 of their actual
contents. A watcher starts before capture and observes edits through completion.
An observed edit invalidates the result even if the original bytes are restored
before completion. Git inspection disables configured filesystem-monitor helpers;
opening a repository does not execute those helpers.

**Last comparison: repository matches checked state** means the last successful
comparison found the captured state unchanged. It does not change a failing exit
status into success. **Stale** means the result cannot validate the changed state.
**Freshness unknown** means evidence could not establish a match. The panel shows
the comparison time, reason and snapshot details. Opening it refreshes evidence;
it compares again every five seconds while open, or on **Refresh verification**.
Restored records start unknown until compared again. Ordinary commands have no
before-run evidence and cannot retroactively acquire it.

## Scope

Evidence excludes ignored files, external dependencies and environment. It does
not attest shell configuration or external services. Source and index/HEAD changes
are included; linked-worktree Git metadata is watched as well. Snapshot limits are
20000 files, 128 MiB of contents, bounded Git output and a ten-second capture
deadline. Non-Git folders, symbolic links, submodule directories, watcher failures,
moving snapshots and exceeded limits produce errors or unknown evidence instead
of a match. A timestamp describes a comparison, not continuous proof of freshness.

WSL tracking requires supported local Linux filesystems for both source and
shared Git metadata. Windows-mounted drvfs/9p and remote filesystems are refused:
Linux-only event observation cannot establish coverage of host or remote edits.
Ordinary command history remains available. Losing the monitor before launch
prevents automatic execution; losing it during a check produces unknown evidence
even if the check exits zero. Closing the pane, shell exit or a direct qterm crash
ends its owned monitor. See [implementation and acceptance](wsl-verification-implementation.md).
