# Provider menu scope audit and implementation

Checkpoint 19 implements the changes below and passes focused/native/frontend
validation. All 109 desktop scenarios passed on 4 November 2026 after resuming the
saved checkpoint. The findings below preserve the audit's original rationale; they no
longer describe the current launch/removal code.

The session library and Claude/Codex menus now share provider/environment/UUID
identities, verified source revisions and prompt-gated launch. Native browsing is
labelled **Native Windows**. Folder groups and remembered-reference removal retain
environment identity; fresh group actions also launch in that environment.

Findings before checkpoint 19:

- `ClaudeMenu.tsx` and `CodexMenu.tsx` join native transcript rows to remembered
  sessions by UUID alone. Their folder groups also omit environment identity.
  Same UUIDs or Linux folder strings in different distributions can be conflated.
  Their row-to-session conversion also drops the captured environment field.
- Both menus accept `onForget(ids: string[])`. The native provider stores filter
  by UUID alone, so forgetting a selected native/WSL reference can remove another
  environment's remembered reference. This affects qterm metadata, not transcripts.
- `App.resumeClaude` and `useCodex.resume` submit startup input without the library's
  source/environment/folder/prompt checks. Recorded mutable profile IDs and path
  spelling determine the destination. `resumeHere` uses mutable profile kinds and
  direct snippet delivery instead of a captured prompt/input token.
- Native transcript scan commands (`list_all_claude_sessions` and
  `scan_codex_sessions`) do not check provider history settings themselves.
  Keep backend retention checks consistent with the library, including refreshes
  already in flight when history is disabled.

Implementation requirements addressed by checkpoint 19:

1. Normalize remembered environment using the same explicit captured value and
   conservative historical inference as the backend library. Keep unknown context
   unknown. Native transcript browsing must be explicitly labelled native Windows
   and must match only native remembered identities.
   Gate native scans at the backend and reject stale results after disabling
   history, rather than relying only on the menu being hidden.
2. Include environment in folder and row identity, accessible labels and filter
   text. Preserve Linux case and literal backslashes. Keep same-folder native
   grouping while separating distributions and unknown contexts.
3. Add scoped forgetting by environment/UUID for both stores and commands. Legacy
   UUID-only callers should apply only to native references. Provider-history
   disabling must still clear that provider across all environments. Failed writes
   must not mutate the in-memory selected metadata.
4. Route new-tab resumes through shared library source resolution, matching
   environment selection, source-home overrides and prompt revalidation. A missing
   or disabled source reports a reason and offers manual copy instead of substituting
   another environment.
5. Reuse a pane only after an actual empty prompt in the same captured environment,
   outside broadcast mode. Capture and recheck prompt/input identity around awaits.
   Use shell-appropriate literal folder arguments and the verified provider home.
   Busy/unknown cases may fall back to the same verified new-tab path, with a notice.
6. Fresh-session actions from a folder group also retain that group's environment.
   Avoid passing a Linux folder to a native default profile.

Evidence: backend colliding-UUID scoped-forget and failed-save tests pass. R83–R86
cover 12 real Windows/WSL menu scenarios, including collision/removal, literal
source-home resume through a startup barrier, busy-shell preservation, disabled
sources, unavailable distributions and fresh-session environment selection.
Five deliberate mutations failed their intended assertions; restored source and
all 12 scenarios passed afterward. The full 109-scenario desktop run passed with
no skips or failures. The current menu screenshot was inspected, and no isolated
app, supervisor, fixture daemon or lifetime file remained after the suite.
Fixtures use no models or live provider configuration.
