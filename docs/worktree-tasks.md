# Worktree tasks

Open **Worktrees** in the tab bar or the `worktrees` palette action. Choose **New
worktree task**, then enter the source folder, title, request, base revision, new
branch and a new directory with an existing parent. Choose a native shell and
Codex, Claude Code or **Shell only**.

**Preview worktree task** resolves the source repository and exact base commit.
It creates no checkout and launches no process in a terminal. Dirty source changes
stay in the source checkout; they are not copied to the task. Review the branch,
directory, commit, shell and request, then choose **Create reviewed worktree**.
The destination must not already exist, be inside the source checkout, or be
inside that repository's shared Git metadata. A moved base or changed destination
parent requires a new preview. Previews expire after ten minutes.

Creation saves task metadata first, reserves the new directory, creates a new
branch at the reviewed commit, then checks out its files. Git hooks, filesystem
monitor helpers, checkout filters and recursive submodule checkout are disabled.
Symlinks are checked out as text. Filter-managed files such as LFS objects may
remain pointers; dependencies and submodules are not installed. Inspection also
disables clean/process filters, so its raw comparisons may differ from a normal
filtered Git status. This behavior avoids executing repository programs as part
of opening or creating a task.

Choose **Open task agent** to launch the selected provider in a new tab after its
shell reaches an empty prompt in the task directory. The request is passed in a
local brief file, not shell source. **Open worktree shell** opens a tab without
launching a provider. Creating a task alone does neither. The provider's normal
permissions and approval controls apply. No existing agent pane is typed into.

Task details show the current branch/HEAD, changed and untracked counts, commits
after the task base and a bounded tracked diff summary. **Refresh worktree** reads
the state again. Saved command runs in the task folder or its subfolders, from
after task creation, link to their captured output and diagnostics. They use the
normal rolling command-history retention; differently spelled path aliases are
not automatically associated. A successful exit still requires repository
evidence to establish the checked source state; see
[verification records](verification-records.md).

**Mark task completed** changes metadata only. Branches, dirty files and running
programs remain. **Reopen task** restores the active label. There is no automatic
merge, branch deletion, worktree removal or dependency installation.

Task history persists locally in `worktree-tasks.json`, up to 200 tasks and 8 MiB.
Failed saves show **Save problem** and retry. Creation requires a successful
initial metadata save. Unreadable history stays untouched until explicit backup
recovery. If qterm stops or checkout fails after creation starts, the record says
so and preserves any branch/directory for inspection; it never tries destructive
rollback. A missing or replaced checkout reports unavailable inspection and
cannot silently open an unrelated repository. WSL worktree tasks remain planned.

Git behavior references: [worktrees](https://git-scm.com/docs/git-worktree),
[hooks](https://git-scm.com/docs/githooks),
[filters](https://git-scm.com/docs/gitattributes).
