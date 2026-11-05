# WSL recipes and scoped project tasks

WSL recipes are implemented and accepted in checkpoint 33. Scoped WSL project
grants and the Linux CLI client route are accepted in checkpoints 34–38, including
all 162 desktop cases. See [the requirement audit](wsl-scoped-grants-audit.md).
Existing authorization applies: recipes require explicit local
review, and named tasks require explicit session-only project grants. Access
stays off until granted. The user accepted unprivileged cleanup limits;
this work must not launch root processes or enlarge native grants.

## Checkpoint 32: source foundation verified, integration pending

`wsl_workflows.py` is now part of the fixed production helper bundle. Operations:

- `workflow_source {cwd}` returns canonical `project`, `source`, `text`, SHA-256
  `digest`, `projectIdentity` and `sourceIdentity` (device/inode pairs). It finds
  the nearest source without requiring Git or executing project code.
- `workflow_directories {source,paths}` revalidates the reviewed source and returns
  `{relative,directory,identity}` entries for 1–256 project-relative step folders.
- `workflow_validate {source,directories}` rechecks source and directory facts;
  any changed identity, digest, canonical path or containment produces an error.

Reads are bounded, descriptor-pinned and regular-file-only. The source limit is
256 KiB, with a ten-second inspection deadline and bounded ancestor search.
Source aliases must remain in the source's canonical parent; step aliases may
resolve inside the project. Linux case and literal backslashes remain distinct.

Nine Linux cases and two Node checks pass, alongside a real opt-in Rust case
using `wsl::call` with the actual production bundle and existing TOML validation.
Removing identities, digest comparison and directory containment causes the
corresponding assertions to fail. Sources restored; strict Clippy, 202 default
native tests (nine ignored), three GUI and four focused desktop scenarios pass.
Logs: `.tools.local/checkpoint32-*.log`. Cleanup found no test app/WebViews,
supervisors, helper programs, lifetime files or workflow/test/launch fixtures.

At checkpoint 32, recipe review/scheduling/launch were still native-only. The
required typed policy, startup/readiness/Stop and UI integration followed in
checkpoint 33 below; the source foundation alone supplied no launch authority.

## Current boundaries

Checkpoint 34 adds the named-task source foundation without enabling grants:

- `task_project {cwd}` returns `{project,directory}` with canonical Linux paths,
  UID and root/shared-Git/directory device+inode identities.
- `task_directory {project,directory}` validates that context and returns fixed
  manifest `files` facts, lock-name presence and a scoped `parent` (null at root).
  `directory` can be a path on first lookup or a captured identity on revalidation.
- `task_source {project,directory,name,expected}` reads only a known manifest,
  rejects changed facts, and returns `{file,base64}`. Reads are regular-file-only,
  bounded to 1 MiB and deadline-limited. Larger files retain presence facts with
  null digest; callers must not treat those facts as readable source evidence.

`project::tasks_from_sources`, `package_manager_from_sources` and
`package_manager_lock` now share format/selection behavior across filesystem
readers. All native format tests pass. The real Rust/WSL case discovers package,
Cargo, Make, Just, Composer and Python commands and preserves a full binary 1 MiB
manifest over the actual transport. Nine Linux cases cover UID/project/metadata/
directory/source replacement, aliases, containment, lock presence, size limits,
special files, deadlines and descriptor cleanup. Three deliberate identity,
digest and containment breaks are caught; sources restored. Strict Clippy, 204
native tests (ten ignored), four GUI and six focused desktop checks pass. Logs:
`.tools.local/checkpoint34-*.log`. All handles are terminal and cleanup is empty.

At checkpoint 34, grant integration remained work: bind an explicit distribution to these private
facts, discover the nearest task directory/ancestor manager choice using the
shared parsers, then revalidate the selected source and resolved command through
all authorization transitions. Do not bind irrelevant lockfile content hashes;
ordinary dependency updates with unchanged command selection remain allowed as
in native policy. Source parsing uses strict UTF-8; previews can use the existing
bounded lossy rendering. Preserve source limits and the 200-task discovery cap.

Recipes now select native or typed Linux policy, retain environment, exact launch
configuration and source/folder identities, and validate actual sessions before
writing. Readiness and Stop use that policy's original session binding. Native
private profile keys remain private; WSL panes use a separate frozen launch hash.
Native grants retain their Windows filesystem policy. Checkpoints 35–38 add a
separate typed Linux policy to `agent_tasks::Policy` and environment-aware scopes
to `agent_access`; WSL access requires that policy, never just an allowed shell kind.

Checkpoint 33 moves start validation and distro Stop I/O outside Store locks,
rechecking cancellation/expiry/bindings/capacity on commit. Live configuration is
checked before/after slow startup operations and at submission. Linux path
validation also applies to WSL project settings. The nine GUI and all 153 desktop
cases pass, alongside strict Clippy, 204 native and 355 frontend tests, both
TypeScript checks and production bundling. Eight deliberate regressions catch
mutex blocking, Windows path interpretation, native result coercion, missing
definition/profile checks, timeout permission, missing Stop and command replay.
All sources restored; cleanup is empty. Logs/report:
`.tools.local/checkpoint33-*.log`, `.tools.local/checkpoint33-full-desktop.json`.

The fixed WSL bridge currently discovers Git status and file links. `wsl::project`
already reads project settings and named tasks through an explicit-distribution
UNC path, then converts returned paths to Linux spelling. Preserve that project
view; it does not supply the pinned policy/source identity required for grants
or delayed workflow launch. Add the authorization-oriented reads/revalidation
through bounded stdin transport and fixed bundled operations. Reuse the exact launch binding and filesystem
identity checks introduced for worktrees and verification. Preserve the existing
native-only automation binding until each caller has an environment-aware policy.

## Implementation order

1. **Implemented (checkpoints 32–33):** bounded Linux workflow-source discovery and revalidation. Recipes find
   the nearest `.qterm.toml`, including non-Git projects as native recipes do.
   Return canonical source/project/step directories, actual file bytes and
   filesystem identities. Parse TOML and validate dependency graphs in Rust using
   the existing definitions. Preserve the 256 KiB recipe-source limit. Resolve
   symlinks with the existing containment semantics, pin opened objects and reject
   source/folder replacement or escape; never apply Windows path normalization.
2. **Implemented (checkpoint 33):** explicit native/Linux policy context in recipe review and runtime.
   Capture environment, exact profile launch hash, source digest and directory
   identities. Revalidate each delayed step immediately before submission. Use
   captured session/environment and case-sensitive canonical cwd for launch,
   readiness observations, cancellation and Stop. Keep tabs/rows/columns layouts,
   dependency/readiness/timeout semantics, bounded concurrency and uncertain-write
   handling. A restarted workspace never restores launch authority or replays a
   step. Completed records retain environment and workflow attribution.
3. **Implemented (checkpoint 33):** use the WSL verification backend when preparing recipe evidence. Authorize the
   actual pane/session before the backend writes its reviewed command; a ticket
   may not bypass authorization merely because its requester is a workflow.
   Unsupported filesystems or monitoring failures remain an evidence warning,
   matching native recipe behavior, rather than invented verification or an
   implicit change to the explicit command-launch policy. Cancel unused tickets
   after preparation failure, revocation, pane loss or shell exit.
4. **Implemented and accepted (checkpoints 34–38):** add identity-bound distro-side policy reads with the existing task source coverage:
   package scripts/package-manager selection and ancestor lockfiles, Cargo,
   Make/Just, Composer and Python project tasks. Factor parsing/selection from
   filesystem access so both environments use the same rules. Preserve nearest
   task-directory/repository boundaries, bounded manifests/previews and task-name
   filtering. Bind every input affecting command selection, including a changed
   package-manager or lockfile choice; no manifest executes during discovery.
5. **Implemented and accepted (checkpoints 35–38):** extend Access review/grants with explicit environment and canonical project
   identity. Keep read authority separate from selected named-task authority and
   provider-history consent. Native, unknown and other-distribution panes/results
   must remain inaccessible through a Linux grant even when paths or IDs match.
   Recheck definitions, profile, directory identities and revocation on request,
   claim and prompt-gated launch. Reuse idempotent request/run IDs, cancellation,
   requester attribution and the existing no-arbitrary-input protocol. Grants
   and pending permissions remain session-only.
6. **Implemented and validated (checkpoint 36, R117):** validate a real Linux client's route to the Windows CLI/named-pipe service.
   Prefer the existing `--agent-client` executable mode through WSL interop,
   with explicit Windows connection-file path handling; no token in copied shell
   source or command arguments. Document an actual tested invocation. A Linux
   grant must not require enabling unrelated transcript indexing or expose a
   second unauthenticated listener.

## Acceptance evidence

Register desktop risks before specs. Use a disposable real Linux project, actual
Git and shell programs; no model calls or live provider homes. Prove recipe
dependency/readiness ordering, layouts, source/profile/folder changes while
waiting, timeout/Stop/cancellation, failed shell exit, command metadata and
restart without replay. Prove read-only versus selected-task grants, environment
and Linux case isolation, unavailable profiles/distributions, revoked delayed
launches, concurrent idempotent retries, requester/result persistence and the
actual WSL client invocation. Check pane reservations across React commits.

Deliberately break the relevant scope, definition and startup guards, restore
sources, then pass focused GUI and broader desktop checks. Existing Windows
recipe/grant tests stay part of regression acceptance. Do not mark recipes,
scoped WSL execution or the full goal complete from bridge/parser tests alone.
