# WSL worktree implementation

The fixed data bridge now implements distro-side `worktree_preview`,
`worktree_create` and `worktree_details`. These are internal operations, with no
generic Git/shell argument endpoint. Checkpoint 27 connects these operations to
the durable task store and worktree UI; all 134 desktop cases pass in checkpoint
27, including six focused GUI-subsystem cases and three deliberate regressions
caught and restored. WSL
verification, recipes and grants retain their separate parity requirements.

Preview resolves the Linux repository, shared Git directory, literal branch,
exact base commit and canonical new destination. It records device/inode identity
for the source directory, shared metadata and destination parent. It makes no
checkout. Creation revalidates these values before exclusively reserving the new
directory through a pinned parent descriptor. Existing paths, dangling symlinks,
source-contained paths and Git-metadata-contained paths are rejected. Git uses
the reviewed commit; partial state is preserved on failure. Durable metadata must
be saved by the Rust store before invoking creation.

Inspection checks the recorded directory and shared Git metadata identity. Git
hooks, fsmonitor, submodule recursion, checkout/clean/process filters and external
diff/textconv are disabled as appropriate. Symlinks are checked out as text;
inspection uses the same policy without modifying shared repository config.
No dependencies are installed. Fixed bridge/Git deadlines and output bounds
remain in force; failures cannot be presented as successful task creation.

Run the opt-in real Linux/Git test from the repository root:

```powershell
$env:QTERM_E2E_WSL_DISTRIBUTION='Ubuntu'
node --test scripts/wsl-worktree-bridge.integration.mjs
```

Without a distribution the test explicitly skips and supplies no WSL evidence.
It creates a unique `/tmp/qterm-wsl-worktree-*` fixture and validates its canonical
cleanup target. It covers dirty/untracked source preservation, commit and branch
binding, replaced source and parent identities, invalid destinations, dangling
symlinks, text checkout, change inspection, repeat-creation refusal and hostile
repository hook/filter/fsmonitor programs. Deliberately removing the hook guard
executes the forbidden fixture program and fails the intended assertion; restored
source passes. Evidence: `.tools.local/checkpoint26-{missing-hook-guard,restored-bridge}.log`.

Task/Draft/Pending data now retain explicit environment and Linux identities,
preserving existing native records. Exact profile launch configuration is hashed
without storing environment secrets. Revalidate the profile before creation,
again after any admission wait, before opening shell/agent panes and at the
agent's empty prompt. Never substitute native Git or another distro. Pending
previews retain parent/source identities; saved WSL tasks retain shared metadata
identity. Save history before mutation and preserve failed creation state.
Previews/details show environment. WSL agent requests use literal Linux briefs;
the actual spawned session is bound to the reviewed profile and checked at the
prompt. Saved runs match environment and Linux case-sensitive path. Existing
native automation grants do not gain WSL execution authority from this separate
launch binding.

Real restart coverage exposed immediate rejection when four WSL data operations
were active. Admission now allows four active and at most sixteen waiting, with a
five-second maximum wait before execution. It never retries an executed mutation.
A native concurrency test covers released slots, expiry and the queue bound;
queued worktree creation revalidates the profile after admission. R101–R103 cover
the integrated lifecycle, exact profile edits and delayed prompt validation.

WSL verification still requires Linux repository content evidence and continuous
change coverage during checks; endpoint snapshots alone cannot establish that a
file was not changed and restored while a check ran. Recipes and scoped grants
retain their separate full-parity requirements.
