# Session library and reviewed handoffs

Open **Sessions** in the tab bar or the `session_library` palette action. The
library combines Claude and Codex sessions remembered by qterm. Use search,
provider, project/folder, reported branch, environment and pin filters. Branches
come from transcript metadata, not the checkout's current branch.

The library does not scan transcripts on opening. **Discover / refresh enabled
sources** explicitly scans the configured native Claude/Codex homes and any
enabled named WSL sources. Discovery status shows provider/environment, paths, observation times,
errors and truncation. Cached observations are historical; refreshing is required
to notice files deleted or changed since the scan. Resume verifies the source and
folder again, opens a new tab and waits for an empty prompt before submitting the
UUID-based resume command. It never submits into an existing provider TUI.
Automatic resume and handoff actions support verified native and explicitly
enabled WSL sources. WSL launch requires a compatible profile for that exact
distribution and a case-sensitive folder match at its actual empty prompt.

Provider history settings gate discovery and sharing. When history is disabled,
the library discards cached source metadata for that provider and shows only
explicit pin references, with no cached transcript context. Enable history in
Settings before discovering sources. Pins store provider, environment, session
ID and pin time; they do not copy titles, folders or transcripts. Unavailable
source sessions remain labelled unavailable rather than being reconstructed from
a pin. Native Windows, each WSL distribution and unknown environments have
separate identities, including when UUIDs or folder strings match.

Use **Settings → WSL session sources** to add an exact distribution name. Entries
default disabled; enable one explicitly, keep each desired provider's history on,
and save. Optional home overrides must be absolute Linux paths. Empty homes resolve
the distro process's `CLAUDE_CONFIG_DIR`/`CODEX_HOME` or `~/.claude`/`~/.codex` during
explicit discovery. qterm does not source shell startup files to find custom homes;
use overrides for homes configured only by those files. Listing installed
distributions is a separate read-only action and does not scan transcripts.

Opening an unrefreshed library does not open a WSL transcript source. Disabling,
removing or changing a source invalidates its discovered context; stale in-flight
results cannot repopulate it. Provider history additionally gates every environment.
Remembered references and pins do not recreate missing transcript context. Missing
distros report errors without substituting the default. Scanner instances are
separate by provider, distribution and resolved home; no WSL scan uses the shared
native provider index. New custom-profile sightings retain captured environment
without reading a matching native transcript.

Select **Review session handoff** for a verified source. Edit goals, findings,
files and next steps; each field is bounded to 4000 UTF-16 units. The latest user
prompt excerpt is excluded unless explicitly selected. Optionally attach up to
five saved command results from their displayed original folders. Their exit,
capture limitations and repository evidence are historical, and the export
performs no check or fresh repository comparison. Output excerpts are limited to
2000 UTF-16 units each. An earlier exit zero is not current validation.

Review the complete preview, then copy it or **Export handoff file**. Export
writes the exact preview as a Markdown brief in qterm's local cache; generated
briefs are cleaned opportunistically after seven days, so copy the file elsewhere
for permanent retention. The entire artifact is limited to 128 KiB of UTF-8.
To open a destination agent, select its provider and a shell in the source
environment and explicitly
check consent to share this reviewed handoff. qterm revalidates the source and
folder, creates a brief file, and passes only its reference into a new pane at an
empty prompt. Goals, findings, excerpts and saved output never become shell
source. Cross-provider sharing is an explicit action, not synchronization.
WSL briefs are written in the selected distribution's cache. Resuming or handing
off to the same provider preserves its discovered home; a different destination
provider uses the selected profile's configuration. Source/home settings and
history access are revalidated before sharing and again before deferred launch.

At most 500 pin references are persisted in `session-pins.json`. Failed writes
remain visible and retry without requiring another edit. An unreadable saved
list is preserved until Retry succeeds or the user chooses explicit backup
recovery. Recovery retains the original file and starts a new pin list. Provider
transcripts are not modified. At most 16 WSL source definitions are allowed, with
one definition per distribution. Discovery retains at most 2000 summaries per
provider/environment source and the combined catalog is bounded to 4000 entries. The UI displays
100 matching entries at a time with **Show 100 more sessions**.
