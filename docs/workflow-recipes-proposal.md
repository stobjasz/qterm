# Workflow recipe implementation slice

Implemented after the scoped local interface; the full regression checkpoint is
recorded in the [implementation plan](developer-agent-plan.md). The user-facing
format is in [workflow recipes](workflow-recipes.md). Reading a project file
does not enable execution.

## User workflow

Open Recipes for the focused project's `.qterm.toml`, select a workflow and
review its canonical root, complete commands, per-step folders, chosen shell,
dependencies, readiness conditions and pane layout. Launch explicitly once.
Opening a repository, refreshing settings or restoring a workspace never starts
or restarts a workflow. Agent grants do not acquire recipe execution authority.

The first version uses a versioned workflow section alongside existing project
appearance, snippets and triggers. A workflow has a stable name and a bounded
list of named steps. Each step has one single-line command, a project-relative
folder, dependencies and readiness. Supported layouts are separate tabs or a
single tab split into rows or columns. Shell selection is explicit in the
review; project text cannot choose an elevated interpreter or silently replace
the user's configured environment.

## Readiness and failure

Default readiness means a reported successful command completion. Missing exit
status cannot establish success. A long-running service can instead name a
literal output marker and a bounded readiness deadline. A marker is observed
only in that step's current command output, not echoed input, restored output or
another pane. It indicates the application's own assertion of readiness, not an
independent health check. A service exiting after readiness visibly invalidates
that readiness; completed dependent commands retain their original results.

Dependencies form a directed acyclic graph. Validate duplicate names, unknown
dependencies, cycles, empty/control-containing commands, unknown versions and
limits before launch. Reject folders escaping the project through `..`, absolute
paths or junctions. Recheck the source digest, canonical folders and configured
shell before each initial command write. Changed definitions require a fresh
review, never a silent reread or substitution.

Failure or readiness timeout blocks pending dependents and exposes the cause.
Independent running steps remain visible. Cancel prevents pending commands from
launching. Stop is explicit and scoped to this run's panes; reuse qterm's process
ownership rather than killing matching executable names globally. Never retry a
command with an uncertain write outcome. A new launch creates a new run.

## Integration and validation

Reuse native shell bindings, prompt/folder guards, reserved startup input,
bounded output capture, command records and explicit stop controls from the
local task interface. Keep launch authority in the native backend and expose
only reviewed run/step identifiers to the UI. Persist normal terminal workspace
and command results, while live launch permissions and pending actions expire
at exit. Restarted panes must not replay commands.

Add real desktop risks before specs: dependency ordering and computed output;
literal service readiness with downstream launch; failed/unknown completion
blocking dependents; changed definitions before a delayed step; cancellation and
restart without replay. Use temporary repositories and real shell processes.
Prove protected assertions fail under deliberate regressions, restore source,
then pass the relevant native, frontend and desktop checks. Do not alter live
provider settings or the installed qterm application.
