# Session library and reviewed handoffs

Implemented after workflow recipes; the [user-facing behavior](session-library.md)
and [implementation checkpoints](developer-agent-plan.md) record current scope
and verification. The library combines provider sources without replacing CLI
conversations. Distro-side discovery remains in the WSL parity slice.

## Identity and discovery

- Use provider + environment + session ID as identity. Native Windows and each
  WSL distribution remain separate, even when folder strings or session IDs
  match. A POSIX folder alone does not identify its distribution.
- Default to sessions qterm remembered under the corresponding retention setting.
  Make transcript discovery an explicit refresh, label scan errors and source
  freshness, and preserve existing integration-health diagnostics.
- Filter by provider, project/folder, reported branch, environment and free text.
  Existing transcript summaries already expose reported Git branch, last prompt,
  prompt count and modification time. Do not substitute the checkout's current
  branch as historical session branch. Unknown branch/environment stays unknown.
- Resume through the existing compatible-shell and idle-prompt checks. Do not
  type into a running provider TUI. Add explicit pins and durable bounded metadata
  with save/recovery feedback; pinning must not create copies of transcripts.
  Missing/retired source sessions remain labelled unavailable rather than being
  silently recreated from stale cache.

## Handoff artifact

Provide an editable, bounded preview with the selected source session identity,
project/branch/environment and observation time, plus goals, findings, files,
checks and next steps. Treat provider text as quoted source data. Attach command
results only by explicit selection and retain their exit, capture limitations,
repository comparison time and staleness; a successful older check is not proof
of the current checkout.

Allow explicit copy/export and reuse the generated brief-file transport for a
new destination agent session. Require review before sharing between providers.
No background transcript synchronization, automatic follow-up injection or
provider configuration changes are part of this slice. Keep source excerpts
optional and visible; respect disabled transcript/session retention settings.

## Verification

Register real desktop risks before specs. Use isolated provider homes and actual
provider-format files to verify mixed-provider search/filtering, pin persistence,
unavailable sessions, retention-off behavior and an inspected handoff export.
Include deliberately hostile text and separate environment identities. Resume
and handoff tests must prove literal content does not become shell source.
Use actual command records for check attribution and stale evidence. Regress key
guards deliberately, restore them and pass the relevant suites before claiming
the phase complete.
