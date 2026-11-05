# WSL parity implementation slice

**Final delivery decisions, 5 November 2026:** the user deferred managed sessions/
automatic running-agent follow-ups and explicitly accepted unprivileged Linux
cleanup limits (“limits”). The implemented scope passes the checkpoint 38 full
suite (162 cases), with the final [requirement audit](goal-completion-audit.md).
Root supervision remains unimplemented and unauthorized. Historical open items
below are superseded by this explicit scope decision where noted.

Next after the session library checkpoint. Read-only inventory/runtime probes
confirmed an existing Ubuntu distribution with a working WSL2 shell, Python 3
and Git. No distribution installation or provider configuration change is needed
to start validation. Use isolated temporary Linux projects and provider homes;
do not scan the user's live provider transcripts as a test fixture.

The [project and diagnostic slice](wsl-support.md) is implemented: explicit
profile distribution metadata, Bash telemetry, bounded distro-side Git, Linux
project settings/manifests, captured command environment and file resolution.
The remaining items below are still acceptance requirements for full parity.

## Environment identity and consent

- Carry distribution identity beside every POSIX cwd, session, discovered source,
  project query and file link. Never infer a distribution from path text or fall
  back to a different/default distro after an identity becomes unavailable.
- Keep WSL session discovery off until the user opts in for a named installed
  distribution. Existing per-provider history settings remain additional gates.
  Show resolved source homes and failures, and support explicit source-home
  overrides for isolated/test or customized CLI homes.
- Extend library source caches to provider + environment identity. Existing pins
  and remembered sightings already distinguish distributions; preserve that
  distinction through discovery, resume, grouping and scoped removal in the older
  provider menus. Native and WSL records must not merge on matching UUID/cwd.

## Terminal and project context

- Add supported WSL shell prompt/cwd/command reporting without rewriting the
  user's shell profiles. Pass qterm's association environment across the Windows
  boundary deliberately. Preserve Linux case and valid paths such as `/c/work`;
  do not apply Git Bash's Windows-drive interpretation to WSL output.
- Read project settings/manifests and Git status in the selected distro. Keep
  project command launch explicit. Git inspection must disable hooks, fsmonitor
  and clean/process filters, with bounded output and process deadlines.
- Resolve absolute/relative diagnostic links against the reported distro/cwd;
  open the actual Linux file in that distro, not a same-spelled Windows path.
  Validate transport/path quoting and preserve file/line/column information.

## Agent workflows

- Resume discovered sessions in a compatible distribution-specific new pane and
  wait for its actual empty prompt/folder. A mismatched or missing distro must
  fail visibly rather than launch a provider in another environment.
- Extend reviewed output/session handoffs using literal brief-file data in the
  destination environment. Resolve/move file references deliberately; never
  assume a fixed `/mnt/c` mapping or interpolate source text into shell code.
- Keep missing lifecycle telemetry unknown and retain its provenance. Existing
  native agent-pipe grants, native verification and native task launch policies
  cannot silently gain a different filesystem/execution environment.

## Next implementation order

1. Pane distribution identity now persists and native launch rejects incompatible
   edited/missing profiles. Split/switch uses captured identity, including custom
   profiles. Folder transfers and the shared file/image paste pipeline now use
   distro-side wslpath, without fixed mount roots. Mixed-shell broadcast delivery
   prepares per-target paths and revalidates every destination before typing;
   terminal replies stay local. Linux-to-Windows conversion validates Windows
   representability and accessibility before replacing the source pane.
2. Named-distribution opt-in discovery, explicit home overrides and independent
   provider/environment/home caches are implemented. Retention gates, source edits
   and colliding UUIDs are covered. Keep those boundaries while enabling launch.
3. Verified source resume and reviewed session handoffs now use distribution-aware
   prompt/folder validation and literal brief files. Cross-provider excerpts stay
   separately consented. Reviewed output handoffs now also use a new or confirmed
   idle matching-distribution shell, with a second prompt/input check after
   preparation and literal Linux brief files.
4. Per-pane subreapers and Windows lifetime files now clean same-user detached Linux
   descendants on pane/app exit and Windows crashes while preserving unrelated
   processes. Close/Stop now use authenticated same-user Linux tree inspection,
   including worker-thread children and adopted descendants. Failed probes require
   close confirmation, and expiring requests prevent delayed Stop against new
   programs. Continue provider-specific lifecycle/process probes and Windows interop
   ownership validation. Provider menus, library grouping, scoped removal and
   unavailable distributions now have checkpoint 19 coverage; all 109 desktop
   scenarios passed on 4 November 2026.
   Privileged descendants require the [root-supervisor decision](wsl-ownership-proposal.md).
   The [provider-menu audit](provider-menu-scope-audit.md) records the historical
   UUID-only joins/removal and parallel launch paths, and their implemented fixes.

## Remaining workflow acceptance

The native workflow implementations do not by themselves establish WSL parity.
Keep these items in the full-goal completion audit:

- **Live programs and agent status:** close/Stop now query only the captured pane's
  owned Linux tree in its distribution. Provider-specific presence now uses the
  same captured owner, with explicit failed/stale evidence and shared provider
  polling (checkpoint 23 validated). Distinguish process presence from provider lifecycle
  events; silence or a failed probe cannot establish idle. Closing/switching and
  Stop now use Linux evidence, preserve a verified shell when stopping programs,
  and preserve unrelated panes and processes. Direct program roots require explicit
  close/interrupt. Validate Windows interoperability
  descendants separately. Privileged cleanup still requires the pending decision.
  Delayed checks and confirmation now revalidate pane/session/input/tab identity.
  Shell invocation/alias matching has real Bash and pure shared-image coverage;
  real multi-call runtime validation is recorded in checkpoint 39 using actual
  BusyBox executable/argv facts, physical fixture aliases and production
  unregistered-shell probes. See [scope and evidence](wsl-shell-runtime-validation.md).
- **Worktree tasks and verification:** worktree preview/creation/inspection and
  separate prompt-gated agent launch now use the selected distribution, retained
  environment and Linux filesystem identities. Dirty source/worktrees are
  preserved; edited profiles and unavailable distributions cannot substitute
  native Git or another environment. Checkpoint 27 passes all 134 desktop cases,
  six GUI cases and three deliberate regressions. See
  [implementation and evidence](wsl-worktree-implementation.md). WSL tracked
  verification is accepted in checkpoint 31: environment-bound panes/evidence,
  actual Linux repository bytes, continuous local-filesystem coverage,
  edit/restore staleness, profile/folder guards and owned monitor cleanup.
  All 146 desktop cases pass; see [verification evidence](wsl-verification-implementation.md)
  for limitations, including refusal of Windows-mounted/remote-only coverage.
- **Workflow recipes:** accepted in checkpoint 33: distro-side definitions,
  environment-bound review/launch/readiness/Stop, fresh source/profile/folder
  checks, result attribution and restart without command replay. All 153 desktop
  cases pass. Scoped project grants remain separate work. Follow
  [the recipe and scoped-task implementation plan](wsl-workflows-implementation.md).
- **Scoped local interface:** implemented and full-suite validated in checkpoints
  34–38 (162 desktop cases, no failures/skips/flaky results). Bind each explicit session-only project grant to
  its environment and canonical project, and require separate named-task execution
  authority. Distro task results need stable run/request identities and requester
  attribution. Changed definitions, revocation or unavailable distributions must
  cancel pending launches. Native grants never authorize a same-spelled Linux
  project or a different distribution.
- **Running-agent follow-ups, explicitly deferred by the user on 5 November:** new-tab and confirmed idle-shell handoffs are
  implemented. Delivering a structured follow-up to an already running provider
  remains future work outside this delivery; never infer a safe input target from output silence or
  type a shell command into a provider's terminal UI.
- **Completion evidence:** native Codex indexing has a measured baseline in
  [the indexing report](codex-index-measurement.md). Still
  audit every original phase against current implementation and real boundary
  tests. Optional MCP/App Server experiments remain separately scoped.

### Source implementation constraints

- Keep source opt-in separate from provider history retention. No distro transcript
  read or distro startup merely from opening an unrefreshed library; resolve its
  homes only during explicit enabled-source discovery. Support explicit absolute
  Linux home overrides instead of sourcing the user's shell startup files.
- Key scan state and scanner instances by provider/environment/home. A home or
  source-enabled change invalidates cached context; disabling provider history
  additionally removes every environment's source data. Reject duplicate source
  definitions for the same distribution rather than merging their homes.
- The catalog now keys source status and cache state by provider/environment and
  source signature, with independent WSL scanners keyed by resolved home. Launch
  validates folders through the selected distribution; WSL scans never use the
  shared native provider index.
- Prompt folder comparison is now environment-aware, including actual Linux
  `/c/...` directories and case-colliding destinations. Keep this distinction
  when extending the remaining handoff paths.
- Usage and busy-process probes now gate native lookup by captured environment
  and known shell kind, including ambiguous Other profiles. Linux lifecycle
  provider probes now also use the pane supervisor; generic close/Stop use it too.
  Provider menu/removal fixes passed full desktop validation.

## Evidence required

Register desktop risks before specs. Drive the actual installed distribution,
real files, Git and ConPTY; isolate every fixture and verify cleanup ownership.
Cover opt-in/retention gates, source identity collisions, reported folders,
project discovery without configured Git side effects, path-aware file opening,
resume/handoff prompt guards and literal hostile data. Use native/pure tests for
unavailable distributions, normalization and bounds. Deliberately break protected
guards, restore source and run the relevant suites before claiming parity.
