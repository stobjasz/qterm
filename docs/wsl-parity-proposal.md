# WSL parity implementation slice

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
   processes. Continue live Linux lifecycle/process probes and Windows interop
   ownership validation. Then revalidate older provider menus, library grouping,
   scoped removal and unavailable distros.
   Privileged descendants require the [root-supervisor decision](wsl-ownership-proposal.md).
   The [provider-menu audit](provider-menu-scope-audit.md) records the remaining
   UUID-only joins/removal and parallel launch paths.

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
  probes and older provider menu/removal paths still need their separate audit.

## Evidence required

Register desktop risks before specs. Drive the actual installed distribution,
real files, Git and ConPTY; isolate every fixture and verify cleanup ownership.
Cover opt-in/retention gates, source identity collisions, reported folders,
project discovery without configured Git side effects, path-aware file opening,
resume/handoff prompt guards and literal hostile data. Use native/pure tests for
unavailable distributions, normalization and bounds. Deliberately break protected
guards, restore source and run the relevant suites before claiming parity.
