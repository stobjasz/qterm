# WSL verification implementation

Checkpoint 28 adds Linux repository evidence primitives and a bounded stdin
transport. Checkpoint 29 adds owned authenticated monitors and environment-bound
backend tickets/records. Checkpoints 30–31 integrate and validate the WSL UI,
prompt authorization, result attribution, cancellation and crash cleanup. The
workflow is accepted with the filesystem/evidence limitations described below;
full WSL parity still has other open work.

`wsl_repository.py` captures canonical Linux root, HEAD, branch, staged index,
tracked/nonignored untracked paths, actual file bytes and executable bits. Root
and Git metadata device/inode identities distinguish a replaced repository.
Directory descriptors and no-follow opens prevent source symlinks from redirecting
capture outside the reviewed tree. Missing tracked files have explicit digest
entries; symlinks, FIFOs and submodules cannot yield a successful snapshot.
Limits are 20000 files, 128 MiB, 4 MiB per Git output and ten seconds per capture.
Fixed Git arguments disable hooks/fsmonitor and never request external diff,
text conversion, checkout or filter execution.

`RepositoryCoverage` owns nonblocking inotify watches from before capture until
the caller closes it. It watches directories, source inodes and shared worktree
Git metadata. Individual inode watches catch writes through outside hard links.
Observed relevant changes are sticky, including edits restored to their old bytes
and atomic editor replacements. Ignored output does not invalidate evidence;
tracked paths, ignore rules and metadata changes do. Watch setup, descriptor use,
event draining and path accumulation are bounded. Kernel queue overflow, unknown
events, malformed names, closed watchers and lost coverage produce errors, never
unchanged evidence. Watch deletion invalidates the check.

This uses ordinary filesystem event coverage, not a sandbox or proof against a
malicious check. Linux documents limitations such as memory-mapped writes; report
only that no relevant edits were observed, and retain snapshot comparison and
unknown states. See [inotify semantics and limitations](https://man7.org/linux/man-pages/man7/inotify.7.html).

Descriptor mount IDs and device identities now enforce known local Linux
filesystems. Windows 9p source and local worktrees with Windows-hosted shared Git
metadata are rejected by real fixtures, before acquiring Linux-only proof. Mount
changes invalidate coverage. Drvfs/9p/network projects need an appropriate host
observer or explicit unavailable evidence; Linux watch success cannot establish
that remote/Windows edits are observable. They do not silently acquire a match.
Mount information semantics: [Linux mountinfo](https://man7.org/linux/man-pages/man5/proc_pid_mountinfo.5.html).

The application sends its fixed bundled source plus a separate JSON request on
stdin to `wsl_bootstrap.py`. No IPC caller can supply helper source. The command
line contains only the small bootstrap, so helper growth and Unicode cannot hit
Windows' argument-length limit. Rust retains the 1 MiB request bound, the envelope
is capped at 2 MiB, and output/concurrency/deadline limits remain. Existing direct
bridge fixture calls remain supported; production uses the bounded envelope.

Run real Linux checks explicitly:

```powershell
$env:QTERM_E2E_WSL_DISTRIBUTION='Ubuntu'
node --test scripts/wsl-repository.integration.mjs scripts/wsl-worktree-bridge.integration.mjs
```

Nine Python cases cover bytes/index/HEAD/mode, edit/restore, ignored output/new
source, hard links, shared worktree metadata, replacement/symlinks/FIFOs, capture
and watcher limits, descriptor cleanup, hostile repository configuration, and an
actual kernel queue overflow. Node checks exercise Unicode snapshot responses,
helper source beyond argv limits, oversized-envelope rejection and existing
worktree operations. A kernel queue above the fixture's bounded workload is
explicitly skipped; do not treat that as overflow proof on such a machine.
Deliberate removal of content hashing, inode watches and overflow rejection each
fails its intended assertion. Logs:
`.tools.local/checkpoint28-{missing-content-hash,missing-inode-watch,ignored-kernel-overflow,restored-linux}.log`.

All 41 existing WSL desktop cases pass (4.7 minutes) and three focused cases pass
with the GUI subsystem. After lazy-loading the monitor FFI and handling temporary
ignored build directories, all nine Linux cases/four Node checks and three
rebuilt desktop cases pass again. Strict Clippy and 202 native tests pass (five
ignored). Logs: `.tools.local/checkpoint28-{restored-wsl-desktop,repository-gui,final-linux,final-desktop}.log`.

The backend now hosts coverage in a Windows-owned Linux monitor for each pending
check. An immutable delete-on-close lifetime controls a detached monitor, with
authenticated same-user, nonce/expiry-bound fixed status/finish/cancel requests
and authenticated responses. Extra context fields and expired finish cannot
change or close the monitor. A lifetime thread interrupts it on owner removal or
replacement; the Git launcher avoids `preexec_fn` after that thread starts (see
[Python's subprocess precautions](https://docs.python.org/3/library/subprocess.html#popen-constructor)).
Real process tests cover context retention, cancellation and Windows owner crash.

Backend preparation starts watches before
capture, verifies unchanged coverage, and freezes canonical cwd/environment and exact
profile identity before a check launches. Never let a delayed launch switch
distribution or shell. Continuous coverage must outlive shell startup and the
whole check; an unchanged finish captures the after state before closing watches.
Already-invalidated checks may omit that snapshot and remain stale. Cancellation,
app exit and direct Windows crash must remove the monitor. Bound pending tickets,
resource use and response sizes. A missing/dead monitor cannot establish a match.

Run records now retain environment-bound evidence and comparison caches keyed by
environment plus canonical root. Linux refresh uses a fresh owned monitor and
never native filesystem aliases. Restored evidence remains unknown until a fresh
comparison. Backend authorization checks current profile and actual PTY launch
binding; recording requires the authorized pane/profile/environment/command/cwd.
Cancellation and ticket Drop remove the lifetime even with validation in flight.

The Windows wrapper caps pending monitors at sixteen. Preparation's optional
profile/environment arguments select this backend; legacy native requests keep
their native behavior. WSL preparation returns frozen launch identity alongside
the before snapshot. `authorize_verification` validates current configuration,
actual session binding and canonical cwd before and after the monitor check.
Unauthorized or mismatched records cannot acquire eligible evidence. Comparison
keys include environment even when root strings collide. Initial process identity
is diagnostic only; production exposes no arbitrary-PID signal endpoint.

Opt-in native ownership/record tests:

```powershell
$env:QTERM_E2E_WSL_DISTRIBUTION='Ubuntu'
cargo test --locked --manifest-path src-tauri/Cargo.toml wsl_verification_monitor::tests:: -- --ignored --test-threads=1 --nocapture
```

This runs two real scenarios plus a conditional crash-child fixture: independent
Windows lifetimes and backend evidence, then a direct Windows owner crash. Checks
cover authorization/mismatch rejection, retention/refresh, edit/restore staleness
and actual Linux monitor exit. Fixture cleanup checks pinned identity, UID, start
time and exact helper argv; forced cleanup happens after assertions and supplies
no acceptance evidence. Default runs leave these opt-in cases ignored. Python
monitor cases use actual sockets, signals and PID descriptors, including forged
and stale requests/responses. Logs:
`.tools.local/checkpoint29-{native-monitor,linux-monitor}.log`.

Acceptance additionally catches four deliberate breaks: mount guard, request
authentication, owner lifetime and comparison environment isolation. After source
restoration, all Linux/native checks, five GUI cases and 50 affected desktop cases
pass (6.3 minutes). No helpers, lifetimes or fixtures remain. Script and logs:
`.tools.local/verify-checkpoint29-monitor.mjs`,
`.tools.local/checkpoint29-{restored-linux,restored-native,restored-native-monitor,monitor-gui,restored-desktop}.log`.

Checkpoint 30 wires the frontend action: typed frozen launch context, original
profile/environment preparation, canonical cwd and expected profile hash at spawn,
authorization at the empty prompt, exact-command ticket attribution and close/error
cancellation. The review displays environment. Latest-run deduplication includes
environment so identical path/profile/command spellings cannot hide another
environment's result; a frontend regression case covers that boundary.

R104–R106 prove successful real Linux commands, ignored build output, durable
evidence across restart, source-edit staleness, edit/restore during a blocked check
and changed-profile rejection before startup submission. Removing ticket
attribution and profile validation makes the protected cases fail. Sources restored;
three GUI and seven focused desktop cases pass. Logs:
`.tools.local/checkpoint30-{missing-ticket,missing-profile-guard,verification-gui,restored-desktop}.log`.
Both TypeScript checks, 355 frontend tests and production bundling pass. Cleanup
finds no isolated app/WebViews, bundled helpers, lifetimes or launch directories.

Checkpoint 31 adds R107–R112: actual pane close and direct Windows app crash,
pinned fixture monitor loss before/during execution, failed shell startup,
Windows-mounted source/shared Git metadata, unavailable replacement distribution
and case-sensitive startup folders. The failed-shell case reproduced a leak;
`App.onExit` now cancels the ticket even when the nonzero error pane remains.
OS observations identify the actual helper by UID, exact bundled argv, process
birth identity and inotify watches on the unique fixture root/source. Signals
pin the recorded process with pidfd; forced cleanup happens only after assertions
and cannot supply acceptance evidence.

Seven deliberate negatives are caught: missing cancellation, crash lifetime,
launch authorization, lost-monitor error handling, filesystem guard, native
fallback on environment mismatch and case-folded Linux folder checks. Sources
restored; all twelve verification GUI cases pass, as do **all 146 desktop cases**
(15.3 minutes, zero skips/failures/flaky cases). Both TypeScript checks, 355
frontend tests and production bundling pass. Logs/report:
`.tools.local/checkpoint31-*.log`, `.tools.local/checkpoint31-full-desktop.json`.
Cleanup finds no isolated app/WebViews, bundled data/monitor helpers, lifetime
files or Linux/Windows verification fixtures. This accepts WSL verification;
recipes, scoped task grants and the other full-parity requirements remain open.
