# Layouts and everyday feature samples

These examples complement the [developer workflow cookbook](developer-workflows.md).
Each linked TOML file is a copyable configuration fragment. qterm does not load
files from this documentation folder automatically.

## Apply a sample

1. Open Settings → **Open settings file** to find your actual global `config.toml`.
2. Choose a sample below, replace example paths, host names and distribution names,
   and confirm the required shells and project tools are installed.
3. Merge the fragment into the indicated file. Keep root settings before the first
   table header. Merge `[keybindings]` and `[scrollback]` into existing tables;
   append `[[profiles]]`, `[[layouts]]` and other array entries as separate entries.
   Give profiles unique IDs and layouts unique names when combining samples.
4. Save and check qterm's configuration error banner. An invalid update leaves the
   last good configuration active. Open the palette with Ctrl+Shift+P and search
   for the new layout, profile or snippet.

Global fragments go in `config.toml`. The project fragment goes in the checkout's
`.qterm.toml`. Layouts are global settings; `.qterm.toml` supports project appearance,
snippets, triggers and workflow recipes, rather than a `[[layouts]]` table.

| Sample | Where to merge it | Useful for |
|---|---|---|
| [Two-checkout layout](samples/layout-review.toml) | Global config | Compare a working branch and an independent fix |
| [Nested full-stack layout](samples/layout-full-stack.toml) | Global config | Agent shell beside a server and verification shell |
| [Windows and WSL layout](samples/layout-windows-wsl.toml) | Global config | Reproduce platform-specific behavior |
| [Distinct local and SSH profiles](samples/profiles.toml) | Global config | Recognize environments and set development variables |
| [Git snippets](samples/snippets.toml) | Global config | Repeat commands or insert an editable command template |
| [Project appearance, snippets and triggers](samples/project.qterm.toml) | Project `.qterm.toml` | Share project conventions and notice relevant output |
| [Navigation and output retention](samples/navigation-and-history.toml) | Global config | Move among panes, inspect output and tune retention |

## Compare two checkouts in one tab

**Useful when:** a parser fix is being developed in a worktree while the original
checkout contains unrelated changes. You want two shells visible at once without
switching branches in either checkout.

Use [layout-review.toml](samples/layout-review.toml). Create both checkouts first,
for example through the [Worktrees workflow](developer-workflows.md#5-work-on-a-second-fix-without-disturbing-your-checkout).
The sample only opens existing folders.

Open **Layout: Review two checkouts** in the palette. The original checkout appears
on the left and the fix on the right. Run `git status --short --branch` in each to
confirm the folders and branches, then run the same project check separately in
each pane. Keep broadcast input off when the panes require different commands.
Use **Problems** to compare saved results, and repository tracking when you need
evidence tied to each checkout's source state.

`split = "row"` means side by side; `split = "column"` means stacked. Set `profile`
and `cwd` on every leaf pane: parent settings are not inherited by nested panes.
Profile references match an exact ID or a case-insensitive display name. A missing
profile falls back to the default shell and produces a configuration warning;
check that warning before using shell-specific commands.

## Keep an agent, server and check shell together

**Useful when:** you want a large shell for a coding agent and two smaller shells
for server logs and checks, without hiding the logs behind another tab.

Use [layout-full-stack.toml](samples/layout-full-stack.toml). It creates this tree:

```text
+-------------------+-------------------+
|                   | npm run dev       |
| agent shell       +-------------------+
|                   | check shell       |
+-------------------+-------------------+
```

The root is a `row`; its right child is a `column`. The left and lower-right panes
open empty shells. Start your installed agent manually in the left pane and run
checks in the lower-right pane. The upper-right pane types and submits `npm run dev`
once its shell starts. The project must already contain that script and have its
dependencies installed. Remove the `command` field to open a server shell without
starting it automatically. Opening the layout again starts another set of shells
and submits its commands again, which can cause a server port conflict.

Layouts do not order commands or wait for a service to become ready. If checks
must wait for the server, use a [reviewed recipe](developer-workflows.md#6-start-a-development-stack-with-explicit-readiness).
Layout `row`/`column` values differ from recipe `columns`/`rows`/`tabs` values.

Drag dividers after opening to give the agent more room. **Save this tab as a
layout** keeps profiles, folders and split structure, but does not preserve custom
divider sizes or running commands. Re-saving a command-bearing layout through
that action produces a shell arrangement; retain startup commands in the TOML
definition if you want them in your reusable layout.

## Check Windows and Linux behavior side by side

**Useful when:** a path, line-ending or shell issue reproduces only on one platform.

Use [layout-windows-wsl.toml](samples/layout-windows-wsl.toml). Replace `Ubuntu` with
the exact installed distribution name and `/home/alex/work/shop` with an existing
Linux checkout. The sample includes a custom Bash profile with an explicit
distribution, then references it in the right pane. PowerShell uses the Windows
checkout on the left. Install dependencies independently in both environments.

Open **Layout: Windows and Linux checks**, confirm the directories and run the
same project task in both panes. A difference in results is easier to investigate
when the shell, platform and checkout are visible together. These are independent
source trees; opening the layout does not copy edits or align their commits.

This layout does not enable WSL transcript discovery or grant agent access. Those
are separate, explicit settings and grants described in the
[WSL workflow](developer-workflows.md#9-use-the-same-workflows-inside-a-specific-wsl-distribution).
To use a built-in profile instead, select its exact `wsl:<distribution>` ID.

## Save a whole investigation as a workspace

**Useful when:** one investigation uses a comparison tab, a server tab and an SSH
inspection tab, and you want the complete arrangement available by name.

1. Open your layouts and additional profiles, rename tabs for their purpose and
   set their colors. Close unrelated tabs if you do not want them in the snapshot.
2. Choose **Save all tabs as a workspace…** from the palette and enter
   `Shop parser investigation`.
3. Later choose **Workspace: Shop parser investigation**. Its tabs are appended
   beside your current tabs; it does not replace them. Opening it twice creates
   two copies of the arrangement.
4. To update the snapshot, save all tabs under the same name again. To remove it,
   use **Delete workspace: Shop parser investigation**.

A layout describes one new tab; a named workspace captures all open tabs. A
workspace is a snapshot of shells, folders, splits and tab appearance, rather than
a job runner. It does not replay a layout's startup commands or automatically
resume the saved agent conversations. Resume a particular conversation from
**Sessions**, and launch a recipe explicitly when you want programs running again.
Named workspaces are managed through the UI and stored in `workspaces.json`;
there is no `[[workspaces]]` TOML setting.

## Make environments visually distinct

**Useful when:** local development and remote inspection look similar enough that
you keep checking which shell has focus.

Use [profiles.toml](samples/profiles.toml). **Shop development** starts PowerShell
in the local checkout with a green tab, `DEV` icon and development environment
variables. A program reads those variables only if it supports them; adapt
`SHOP_API_URL` to your application's actual configuration.

**Staging inspection** starts `ssh shop-staging`, using your existing SSH client
configuration and authentication. Replace the alias before opening it. The orange
tab, `STG` icon and distinct background identify that profile visually; they do not
restrict remote commands or grant read-only permissions. Environment variables in
a local profile are not automatically forwarded to an SSH server. If SSH host
discovery is enabled, the same alias can also appear as **SSH shop-staging**;
choose the custom profile to use this appearance.

Profile `command` launches a program; a layout leaf's `command` is text submitted
to the shell after startup. A profile's optional `cwd` is a local shell start
folder, rather than a way to choose an SSH server's working directory. Keep
credentials in your normal authentication setup instead of these sample files.

## Turn repeated commands into snippets

**Useful when:** you repeatedly inspect diffs and history, or want a command
template you can edit before running.

Use [snippets.toml](samples/snippets.toml). At an empty shell prompt inside a Git
checkout, open the palette and choose **Review current diff** or **Recent commit
graph**. `run = true` types the command and submits it immediately. **Compare with
a branch** uses `run = false`: replace `main` if necessary and press Enter yourself.

Snippets type into the focused pane, so select an idle shell rather than an editor
or an agent's input prompt. They do not choose a new folder or open an isolated
task pane. For commands discovered from a project's manifest, use **Project task**
in the palette; those open a new pane in the manifest's folder. Use recipes for
ordered tasks, or Access for explicit session-only task authority for an agent.

## Share project conventions and watch important output

**Useful when:** the same team repeatedly runs type checks, watches a smoke check
and searches logs for TypeScript errors.

Merge [project.qterm.toml](samples/project.qterm.toml) into the project's
`.qterm.toml`. Tabs inside that project get the `Shop` name, green color and `SHOP`
icon unless an explicit tab name takes precedence. Project snippets appear while
the relevant pane is focused. The examples insert npm commands for review; they
require the existing scripts from the [developer cookbook](developer-workflows.md#3-turn-a-build-failure-into-a-reviewed-agent-brief).

The three triggers demonstrate different outcomes:

| Output | Match | Effect |
|---|---|---|
| `SMOKE_OK` | Case-insensitive text | Mark the tab and notify when you are not looking at the pane |
| `Build failed` | Case-insensitive text | Mark the tab without a Windows pop-up |
| `src/app.ts:12: error TS2322: ...` | Regular expression | Highlight the matching line |

Adapt the literal markers to your actual tools. Triggers react to terminal output;
they do not establish successful verification or decide whether an agent needs a
human answer. Use recorded exit codes, tracked checks and provider lifecycle
events for those decisions. Full-screen program output and restored historical
output do not fire triggers. Each trigger fires at most once every three seconds
per pane. The project file can be reviewed and committed with your project.

## Navigate logs and control saved output

**Useful when:** several panes contain relevant errors, an HTTP result needs
inspection, or a remote pane's output should not be retained across restarts.

Use [navigation-and-history.toml](samples/navigation-and-history.toml). The sample
moves Quick select to Alt+Shift+Q so Alt+Shift+S can split down. It also disables
the broadcast shortcut; broadcast remains available from the palette.

1. Press Alt+Shift+F to search output across panes. Search for a concrete error or
   request ID and jump to its pane for context.
2. Press Alt+Shift+Q to select a visible file path or URL by its label. File links
   can open in your configured editor; a server's detected local URL also appears
   on the tab as a port link.
3. After a command prints JSON, press Ctrl+Shift+J to inspect its output. Select a
   JSON portion first if the command mixed data and logs. This opens a viewer,
   without rerunning the command.
4. Press Ctrl+Shift+O to copy the last command's output. Use **Save pane output…**
   or **Open pane output in editor** from the palette for a longer investigation.

The `[scrollback]` table retains up to 3000 lines per pane while opting both SSH
profile IDs out of output restoration. Use exact profile IDs, especially for
custom profiles. This setting controls saved terminal output, rather than remote
logs, provider transcripts, the agent inbox or command-result records. Disabling
scrollback restoration does not erase those separate records. A 60-second
`long_command_alert` threshold enables completion notifications for long commands
when you are not looking; it does not terminate a slow command.
