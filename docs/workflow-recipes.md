# Workflow recipes

Open **Recipes** in the tab bar or the `recipes` palette action. Enter a project
folder and choose a native PowerShell, Cmd or Git Bash profile. Review the source
digest, commands, canonical folders, dependencies and layout, then check consent
and choose **Launch reviewed workflow**. Reviewing and opening folders run nothing.

Add a versioned section to the project's `.qterm.toml` alongside its appearance,
snippets and triggers:

```toml
[workflows]
version = 1

[[workflows.recipes]]
name = "dev"
layout = "columns"

[[workflows.recipes.steps]]
name = "build"
command = "npm run build"

[[workflows.recipes.steps]]
name = "server"
command = "npm run dev"
cwd = "."
depends_on = ["build"]
ready_output = "Local:"
timeout_seconds = 60

[[workflows.recipes.steps]]
name = "check"
command = "npm run check"
depends_on = ["server"]
```

Names use 1–64 ASCII letters, digits, underscores or hyphens. Each source can
define 1–16 recipes, each with 1–16 uniquely named steps. Dependencies must name
steps in that recipe without duplicates or cycles. Unknown fields and versions
are errors. The source limit is 256 KiB. `layout` is `tabs` (default), `rows`
(stacked panes) or `columns` (side by side). `cwd` defaults to `.` and must stay
inside the source file's project folder, including after resolving junctions.
Commands are complete single lines, at most 15000 UTF-16 units, with no control
characters except tabs.

Default readiness requires a reported exit code of zero. Cmd integration cannot
report exit status, so a normal Cmd completion cannot establish success for a
dependent step. Missing exit status remains unknown success, not zero.
For a long-running service, `ready_output` is a case-sensitive literal string of
1–512 characters on one line. It is matched only against the running command's
recent captured output, excluding echoed input and restored output. It is the
program's own readiness claim, not an independent health probe. Terminal changes
or lost scrollback can make a marker unavailable; missing observation never
unlocks a dependency. A service exiting invalidates its readiness. Already
launched dependents are not automatically killed.

`timeout_seconds` defaults to 300 and accepts 1–3600. The deadline starts when
the command is written. A timeout blocks pending dependents and reports that its
process can still be running. Use **Stop workflow** to interrupt and end this
run's descendant programs. **Cancel pending steps** leaves accepted running steps
alone. Failed or cancelled dependencies block pending steps transitively;
independent branches can continue. Uncertain PTY writes remain unknown and are
never automatically retried.

Every step gets a new reserved pane. qterm waits for an empty shell prompt,
checks its actual pane/profile binding and canonical folder, then validates the
reviewed source digest and configured shell/environment again before writing.
Changing a definition or folder requires a fresh review. Shell startup programs
can delay launch; cancelling releases the pane for manual use. Cmd commands show
their child-interpreter wrapper in the review so stopping batch files preserves
the parent shell. WSL execution remains separate from native recipes.

Runs and pending launch permissions are session-only. Restarted panes retain
ordinary workspace/output but never replay commands. Completed command records
retain workflow/step attribution, original folder, output, exit and supported
repository evidence in the normal bounded command history. Repository evidence
failures are shown without inventing verification or preventing launch. Up to
four workflows and sixteen executing steps can be active. The current session
retains 32 recent runs; pending reviews expire after ten minutes.

Recipe launch is an explicit local UI action. Existing agent read/task grants
do not gain recipe execution or arbitrary command authority.
