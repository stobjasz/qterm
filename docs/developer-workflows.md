# Developer and coding-agent workflow cookbook

These scenarios combine the current qterm developer features into practical
workflows. Start with the [user guide](user-guide.md) for terminal basics. If a
named button is missing, your installed build may predate these features.

For additional layout, profile, snippet, trigger and output-retention examples,
see [layouts and everyday feature samples](feature-samples.md).

Examples use an existing Git checkout at `C:/work/shop`, PowerShell 7 on Windows,
and an optional Ubuntu checkout at `/home/alex/work/shop`. Replace those paths,
the distribution name and account name with your own. Project tools such as Node,
TypeScript and Vite must already be available in the selected shell. qterm does
not install a project's dependencies when you open it or create a worktree.

- [1. Configure a developer workspace](#1-configure-a-developer-workspace)
- [2. Understand agent status and handle attention](#2-understand-agent-status-and-handle-attention)
- [3. Turn a build failure into a reviewed agent brief](#3-turn-a-build-failure-into-a-reviewed-agent-brief)
- [4. Record a check that becomes stale after edits](#4-record-a-check-that-becomes-stale-after-edits)
- [5. Work on a second fix without disturbing your checkout](#5-work-on-a-second-fix-without-disturbing-your-checkout)
- [6. Start a development stack with explicit readiness](#6-start-a-development-stack-with-explicit-readiness)
- [7. Give a local agent selected project capabilities](#7-give-a-local-agent-selected-project-capabilities)
- [8. Resume or hand off a session with reviewed context](#8-resume-or-hand-off-a-session-with-reviewed-context)
- [9. Use the same workflows inside a specific WSL distribution](#9-use-the-same-workflows-inside-a-specific-wsl-distribution)
- [10. Recover from save failures and restarts](#10-recover-from-save-failures-and-restarts)
- [Configuration locations and feature boundaries](#configuration-locations-and-feature-boundaries)

## 1. Configure a developer workspace

**Useful when:** you switch among a build terminal, tests and agent sessions, and
want their layout and output back after restarting qterm.

Open Settings → **Open settings file**. Merge the settings below into
`config.toml`; edit existing tables rather than adding duplicate `[scrollback]`
or `[keybindings]` tables. Keep top-level keys before the first table header.

```toml
restore_session = true
shell_integration = true
long_command_alert = 60

# Enable history only for providers whose sessions you want to discover.
claude_sessions = true
codex_sessions = true
claude_alerts = true
codex_alerts = true

# Reopen shells and output, but resume agent sessions explicitly from Sessions.
claude_restore = false
codex_restore = false

# Requires VS Code's `code` command to be available.
editor = 'code --goto "{file}:{line}:{col}"'

[scrollback]
restore = true
lines = 3000

[keybindings]
ask_agent = "ctrl+shift+f5"
agent_inbox = "ctrl+shift+f6"
problems = "ctrl+shift+f7"
worktrees = "ctrl+shift+f8"
agent_access = "ctrl+shift+f9"
recipes = "ctrl+shift+f10"
session_library = "ctrl+shift+f11"
```

Optionally add a project-oriented shell profile in the same file:

```toml
[[profiles]]
id = "custom:Shop PowerShell"
name = "Shop PowerShell"
command = "pwsh.exe -NoLogo -NoProfile"
cwd = 'C:\work\shop'
tab_color = "green"
```

Select **Shop PowerShell** from the new-tab menu. Split it for a test terminal,
then use **Save all tabs as a workspace…** to name the arrangement. For a reusable
single-tab split arrangement, use **Save this tab as a layout** instead.

**Expected outcome:** tabs, folders, splits and retained output return after a
restart. These settings do not replay recipe steps or restore agent grants.
Per-provider automatic session resume is a separate option, left off above.

## 2. Understand agent status and handle attention

**Useful when:** several agents are open, a session is quiet, or qterm appears to
be asking for an answer that you cannot find.

1. In Settings → Claude Code or Codex CLI, inspect **Local delivery health**.
   Check the resolved data folder, last event, time and receiving pane/session.
2. Choose **Test Claude local delivery** or **Test Codex local delivery**. This
   tests qterm's executable, inbox and watcher without contacting a model. It
   does not establish that the provider has enabled or trusted its hooks.
3. If local delivery passes but no real events arrive, check hook setup in the
   provider's Settings section and follow the provider's trust instructions.
   Start a new provider session after setup when required by that provider.
4. Open **Inbox**, filter by provider/type or search for the project folder.
   View an event, use **Go to pane** if its original pane is still open, and
   resolve it after handling it.

Hover a provider marker for its evidence source and timestamp. **Status unknown**
means qterm lacks current lifecycle evidence; silence alone does not establish
idle. **Turn completed** reports a provider event, not a passing build.

Codex **approval activity** is informational. An approval-routing hook can be
handled by the provider's own hooks or automatic review without presenting a
human question. qterm does not turn that event into a needs-input toast. Actual
permission/input requests remain separate, and provider approval decisions stay
in the provider UI. Duplicate identical completion notifications are deduplicated.

Use the alert switches in scenario 1 to control provider pop-ups. Turning pop-ups
off does not uninstall hooks or remove the local inbox. Viewing an event marks
it read; **Resolve event** is a separate action. Prior-run events remain historical
and cannot jump to an unrelated new pane.

## 3. Turn a build failure into a reviewed agent brief

**Useful when:** a compiler fails in a large output buffer and you want an agent
to explain it with the correct command, folder, exit status and selected output.

For the examples below, merge these scripts into an existing web project's
`package.json`, keeping its dependencies and other fields:

```json
{
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "build": "vite build",
    "dev": "vite --host 127.0.0.1 --port 5173 --strictPort",
    "smoke": "node scripts/smoke.mjs"
  }
}
```

1. In the project shell, run `npm run typecheck` and let it finish.
2. Open **Problems and command runs**. Inspect that run, select a diagnostic and
   open its file/line in your configured editor. File links use the run's original
   folder even if the terminal has since moved elsewhere.
3. Return to the command output. Select the relevant lines, or open the command's
   menu, and choose **Ask an agent about this**. The palette also has that action.
4. Edit the request, for example: “Explain this type error. Propose a minimal fix
   and identify a test that would catch it. Ask before editing files.”
5. Review the brief, choose Claude or Codex and the matching shell/environment,
   then choose **Open agent with brief**. A new tab is the default.

The new shell waits for an empty prompt in the original folder. Request/output
text goes into a brief file; only its reference enters the launch command.
Selecting **Source shell pane, if idle** requires the same profile and original
folder, an empty prompt and no broadcast mode. A busy program is rejected.

**Expected outcome:** the destination receives the reviewed failure context.
Output is bounded to 16000 characters and the request to 8000; truncation is
labelled. Use **Copy brief** for manual follow-up in an already running agent.
Automatic running-agent delivery and managed conversation/approval UI are deferred.

After the fix, rerun the same check. The latest Problems view supersedes only that
command's previous results in the same folder/profile/environment. Earlier runs
remain available with **Show superseded runs**. Unsupported diagnostic formats
remain available under **Captured output**.

## 4. Record a check that becomes stale after edits

**Useful when:** an agent says a change is verified, but you need to know whether
its successful test still describes the checkout you are reviewing now.

1. Run `npm run test` once so it appears in **Problems and command runs**.
2. Inspect the run and choose **Run with repository tracking**.
3. Review the exact command, original folder, environment and shell. Choose
   **Run reviewed command** to start it in a new tab.
4. Inspect the completed result. Look at both the exit code and **Verification
   freshness**. A matching repository comparison cannot turn exit 1 into success.
5. Edit a tracked source file and refresh verification. The earlier result becomes
   stale. An edit observed during a check also invalidates it if its original
   bytes are restored before the command finishes.

**Expected outcome:** you can distinguish a passing command against unchanged
source from an old success against earlier code. An ordinary captured run has no
before-run evidence; it cannot retroactively become a tracked check.

Evidence excludes ignored files, dependencies, environment and external services.
Failed coverage is **unknown**, not a verified match. WSL tracking requires a
supported local Linux filesystem for source and shared Git metadata; a repository
on a Windows mount can retain command history but cannot acquire Linux-only
watch coverage. See [verification records](verification-records.md).

## 5. Work on a second fix without disturbing your checkout

**Useful when:** your current branch has unfinished edits and another bug needs
an independent checkout, agent and validation history.

1. Open **Worktrees** → **New worktree task**.
2. Choose the source checkout and fill in a title and request. For example:

   | Field | Example |
   |---|---|
   | Source | `C:/work/shop` |
   | Title | `Fix parser regression` |
   | Base revision | `HEAD` |
   | New branch | `qterm/parser-fix` |
   | New directory | `C:/work/shop-parser-fix` |
   | Agent | Codex, Claude Code or Shell only |

3. Choose **Preview worktree task**. Confirm the resolved commit, new branch,
   destination, environment and shell. Preview creates no checkout.
4. Choose **Create reviewed worktree**. The destination must not exist, and its
   parent must already exist. Dirty source edits remain in the source checkout;
   the new worktree starts from the reviewed commit.
5. Choose **Open worktree shell** to inspect it, or **Open task agent** to open
   the selected provider with the request in a new prompt-gated tab.
6. Install dependencies manually if needed, using the project's own instructions.
   For the npm example with a lockfile, that might be `npm ci` in the new checkout.
   qterm does not run dependency installation or checkout hooks for you.
7. Run checks in the task folder. Its details show changes and associated saved
   runs; open a result to inspect output, diagnostics and repository evidence.

**Expected outcome:** the original dirty checkout is preserved, and the task has
its own branch, agent/shell and check history. **Mark task completed** changes
metadata only. Merge, branch deletion and worktree removal remain explicit manual
operations. The [worktree reference](worktree-tasks.md) describes checkout filters,
submodules and recovery.

## 6. Start a development stack with explicit readiness

**Useful when:** you repeatedly type a build, start a service and run a smoke
check, or want a second pane to wait until a service reports readiness.

Use the scripts from scenario 3. Save this small smoke check as
`scripts/smoke.mjs` in that project, using the project's supported Node version:

```javascript
const response = await fetch("http://127.0.0.1:5173/", {
  signal: AbortSignal.timeout(5000),
});
if (!response.ok) throw new Error(`HTTP ${response.status}`);
console.log("SMOKE_OK");
```

Put the workflow below in the project's **`.qterm.toml`**, not global
`config.toml`. Merge it with existing project appearance/snippet settings:

```toml
name = "Shop"
tab_color = "green"

[workflows]
version = 1

[[workflows.recipes]]
name = "dev_stack"
layout = "columns"

[[workflows.recipes.steps]]
name = "typecheck"
command = "npm run typecheck"
timeout_seconds = 120

[[workflows.recipes.steps]]
name = "build"
command = "npm run build"
depends_on = ["typecheck"]
timeout_seconds = 180

[[workflows.recipes.steps]]
name = "server"
command = "npm run dev"
depends_on = ["build"]
ready_output = "Local:"
timeout_seconds = 60

[[workflows.recipes.steps]]
name = "smoke"
command = "npm run smoke"
depends_on = ["server"]
timeout_seconds = 30
```

1. Open **Recipes**, choose the project and a supported PowerShell, Git Bash or
   WSL Bash profile. Use a shell that reports exit status for dependent checks;
   Cmd's normal completion cannot establish exit-zero success.
2. Review the source digest, commands, directories, dependency graph and layout,
   check consent and choose **Launch reviewed workflow**.
3. `typecheck` must succeed before `build`. The server starts after the build;
   its literal, case-sensitive `Local:` output unlocks `smoke`.
4. Inspect each step's output and state. In this example the HTTP request in
   `smoke` provides an extra check; the server's marker alone is its own readiness
   claim. Adapt the marker to the actual output of your server.
5. Use **Cancel pending steps** to prevent later steps while leaving accepted
   running programs alone. Use **Stop workflow** to end this run's programs.

**Expected outcome:** a repeatable, explicitly launched workflow in separate panes.
A failed/unknown check blocks its dependents. A timeout also blocks dependents
but can leave its process running; use Stop when you intend to terminate it.
Restart does not replay the workflow. A changed source, shell or directory needs
another review. Use `layout = "rows"` for stacked panes or `"tabs"` for separate tabs.

For a monorepo, add `cwd = "apps/web"` to a step whose commands belong there.
That existing directory must stay within the `.qterm.toml` project folder.
Do not add `cwd` blindly to the example: the scripts must exist in that subproject.
See [recipe format and limits](workflow-recipes.md).

## 7. Give a local agent selected project capabilities

**Useful when:** an agent should inspect build results and request a known check
in a visible task tab, without receiving arbitrary terminal input authority.

### Create the grant in qterm

1. Open **Access**. Select **Windows** or the exact `wsl:<distribution>`
   environment, enter the Git project folder and a client label such as
   `Parser repair agent`.
2. For result inspection only, choose **Review project access**, check read
   consent and choose **Create session read grant**.
3. To allow checks, select **Review named-task execution too** before review.
   Choose the shell, inspect each command and manifest preview, then select only
   `typecheck` and `test` from `package.json`. Check the separate execution consent
   and choose **Create session task grant**.
4. Copy the connection-file path. Use the executable path shown in Access for the
   CLI calls below. Give the client that path, keeping normal provider sandbox
   and approval controls in force.

Grants cannot be enabled in TOML or restored after a restart. Read grants do not
authorize `tasks.run`; selected-task grants do not authorize recipe execution or
arbitrary commands. They do not require provider transcript indexing.

### Use the grant from PowerShell 7

Replace the executable and connection paths with those shown in Access. Use
PowerShell 7.3 or later for these native JSON-argument examples:

```powershell
$qterm = 'C:\path\qterm.exe'
$connection = 'C:\path\copied-connection-file.json'

$listed = & $qterm --agent-client $connection tasks.list '{}' | ConvertFrom-Json
if ($listed.error) { throw $listed.error.message }
$task = $listed.result.tasks | Where-Object {
    $_.name -eq 'typecheck' -and $_.source -eq 'package.json'
} | Select-Object -First 1
if (-not $task) { throw 'The selected typecheck task is not on this page.' }

$request = @{ taskId = $task.id; requestId = 'parser-repair-check-001' } |
    ConvertTo-Json -Compress
$run = & $qterm --agent-client $connection tasks.run $request | ConvertFrom-Json
if ($run.error) { throw $run.error.message }
$run.result

$statusRequest = @{ runId = $run.result.id } | ConvertTo-Json -Compress
& $qterm --agent-client $connection tasks.status $statusRequest | ConvertFrom-Json
```

Repeat `tasks.status` to inspect progress. Once the completed result is retained:

```powershell
$resultRequest = @{ commandId = $run.result.id; offset = 0; limit = 65536 } |
    ConvertTo-Json -Compress
& $qterm --agent-client $connection commands.result $resultRequest | ConvertFrom-Json
```

Piping stdout makes PowerShell wait for a Windows GUI executable. A client can
also spawn it directly and parse stdout. Responses contain `result` or `error`;
an error also returns a nonzero process exit code.

Reuse `parser-repair-check-001` when retrying the **same intended invocation**:
qterm returns that run instead of executing again, including concurrent retries.
Use a new ID only when you deliberately want another run. A changed manifest,
resolved command, shell or folder invalidates execution until restored or reviewed
again. Start a fresh task-list page using `after` when `next` is returned.

**Expected outcome:** the task opens in a new named tab, leaving the agent's source
program alone. Access shows requester, state and **Stop task**; saved results keep
requester attribution. **Revoke access** immediately blocks further API access and
cancels pending launches, while an already accepted running task remains available
for explicit Stop. On qterm exit, all grants and connection files expire.

### Use the same interface from WSL

Keep the connection path in Windows spelling because the Windows executable opens
it; convert only the executable path to its Linux spelling:

```bash
exe="$(wslpath -u 'C:\path\qterm.exe')"
connection='C:\path\copied-connection-file.json'
"$exe" --agent-client "$connection" tasks.list '{}'
"$exe" --agent-client "$connection" commands.list '{"limit":10}'
```

This uses Windows interop and the same private named pipe. The grant must match
the project environment; a Windows grant cannot authorize a Linux task. Reading a
result returns historical repository evidence, not a fresh validation. Output and
task lists are paginated; see [the protocol reference](local-agent-interface.md).

## 8. Resume or hand off a session with reviewed context

**Useful when:** you return to an older task, compare work from two providers, or
want to hand off a bounded summary without automatically sharing transcripts.

1. Enable the desired provider's session history, then open **Sessions**.
2. Choose **Discover / refresh enabled sources**. Opening the library alone does
   not scan transcripts. Inspect the source paths, observation times and errors.
3. Filter by provider, environment, project and reported branch. Pin useful
   sessions; pins retain references rather than copies of transcript context.
4. Resume a verified source when you want its existing conversation. qterm opens
   a new compatible tab and waits for the correct folder/prompt.
5. For a transfer, select **Review session handoff**. Write goals, findings, files
   and next steps. Include the source prompt excerpt only if you intend to share
   it, and optionally attach up to five displayed saved checks.
6. Review the entire preview. Copy/export it, or choose a destination provider and
   matching shell, check sharing consent and explicitly open the agent.

**Expected outcome:** the new agent receives the reviewed text as brief-file data.
Saved checks are labelled historical; exporting does not revalidate them. Choosing
a different provider shares only the reviewed content, rather than starting
ongoing synchronization. Provider permissions remain in that provider's UI.

Disabling provider history removes its cached library context across environments;
explicit pins can remain as references. A missing source is labelled unavailable.
Refreshing is needed to observe files changed/deleted since discovery. Exported
cache files are temporary: copy the artifact elsewhere for permanent retention.
See [session library and handoffs](session-library.md).

## 9. Use the same workflows inside a specific WSL distribution

**Useful when:** tools, dependencies and source live in Linux, or Windows and Linux
have similarly named folders/sessions that must remain separate.

Merge this into global `config.toml`. Each distribution can have one source entry;
edit an existing entry rather than duplicating it:

```toml
shell_integration = true
claude_sessions = true
codex_sessions = true

[[wsl_sources]]
distribution = "Ubuntu"
enabled = true
claude_home = "/home/alex/.claude"
codex_home = "/home/alex/.codex"

[[profiles]]
id = "custom:Shop Linux"
name = "Shop Linux"
command = 'wsl.exe --distribution Ubuntu --exec /bin/bash -i'
cwd = "/home/alex/work/shop"
tab_color = "blue"
```

The home overrides are optional: use empty strings to resolve the distro process's
configured provider homes/defaults during explicit discovery. qterm does not
source shell startup files to find homes, so specify overrides for homes set only
by those files. Disable a source with `enabled = false` when you no longer want it
discovered. Provider history is an additional consent gate.

1. Open **Shop Linux** and confirm its actual Linux folder. Recognized profiles
   need an explicit distribution and supported `--exec` command, without selecting
   another Linux user. Ubuntu needs `/usr/bin/python3` 3.9+, `/usr/bin/git` for
   project inspection and the required Linux ownership capabilities.
2. Put project manifests and `.qterm.toml` inside the Linux checkout. Open Problems,
   Worktrees or Recipes and choose that distribution's profile. In Access select
   the exact WSL environment and use `/home/alex/work/shop` as the project folder.
3. Use **Discover / refresh enabled sources** in Sessions for the configured
   transcript source. Opening or granting a project does not enable transcript
   discovery by itself.
4. Inspect diagnostics and checks in their original environment. A Linux path is
   case-sensitive; `/home/alex/Shop` and `/home/alex/shop` are separate paths.

**Expected outcome:** project commands, handoff briefs, worktrees and task results
stay in the selected distribution. Removing/editing its profile or making the
distro unavailable produces an error instead of substituting Windows or another
distro. Restored panes retain their original identity; startup commands and grants
do not replay. A Bash profile that replaces `PROMPT_COMMAND` can prevent telemetry;
check integration before expecting automatic prompt-gated launches.

Place tracked checks on a supported local Linux filesystem. Windows-mounted or
remote source/shared Git metadata cannot receive Linux-only verification coverage.
Normal command history can still be used there. qterm's Linux supervisor runs as
the normal user: descendants gaining privilege through `sudo` may survive cleanup.
This is the accepted ownership limit; no root supervisor is enabled. See
[WSL support](wsl-support.md).

## 10. Recover from save failures and restarts

**Useful when:** a redirected settings/data location becomes unavailable, a save
fails, or saved workflow history cannot be read after an interrupted write.

1. Leave the current app open and inspect **Save problem**. Restore access to the
   affected directory, then use **Retry**. Failed pending writes also retry
   automatically without requiring another layout edit.
2. For unreadable inbox, command, worktree or pin history, use that panel's explicit
   recovery action. It preserves the original as a backup before starting fresh.
   Do not expect an unreadable file to be silently replaced.
3. After recovery, verify the saved state and restart normally. Restored output
   is historical scrollback above a fresh shell prompt.

**Expected outcome:** a failed write remains visible until it succeeds; an older
in-flight output save cannot undo **Clear all saved output**. Workspace output,
saved command results, worktree metadata, inbox history and pin references retain
their respective recovery/retention behavior.

Live recipe runs, pending task-launch permissions and Access grants are session-only.
Create a new grant or review/launch a workflow again after restart. Historical
records and an earlier exit zero do not prove the current checkout is verified.

## Configuration locations and feature boundaries

| Location | Configure here | Activated by |
|---|---|---|
| Global `config.toml` | Shell integration, history/alerts, output retention, keybindings, profiles and opt-in WSL transcript sources | Saving valid settings; some shell integration changes need a fresh pane |
| Project `.qterm.toml` | Project appearance/snippets and versioned recipes | Folder discovery is read-only; recipes need review and explicit launch |
| Project manifests | Named tasks in package/Cargo/Make/Just/Composer/Python formats | Manual project-task selection, or a separately reviewed Access task grant |
| Access panel | Session-only read and selected-task capabilities | Explicit consent; there is no persistent-grant TOML key |
| Sessions handoff preview | Selected findings, excerpts and saved check context | Explicit export/share consent |

qterm preserves normal provider approval controls. It does not expose arbitrary
terminal typing through the local agent interface, auto-merge worktrees, install
dependencies or automatically send follow-ups into running agents. Quitting qterm
ends owned descendants, including detached Windows tools; privileged Linux
descendants remain subject to the limit above.
