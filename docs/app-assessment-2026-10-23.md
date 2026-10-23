# qterm assessment — 23 October 2026

qterm has a substantial terminal foundation: real ConPTY shells, split layouts,
workspace restore, command navigation, project tasks, search across panes,
signed update verification, and separate Claude/Codex integrations. The next
iteration should prioritize reliability and visibility before expanding features.

This is a source review plus targeted desktop verification of the Codex flows,
not a complete manual audit of every screen, a security audit, or a performance
benchmark. Version reviewed: 0.2.7 in this checkout.

## Verified defects addressed in this checkout

1. **Codex history disappears from All on this PC.** All six local rollouts use
   `response_item` messages for user input. The parser only counted
   `event_msg.user_message`, then filtered out sessions with zero counted prompts.
   Remembered sessions came from a separate saved list, explaining the mismatch.
   The parser now falls back to response messages, excludes known injected context,
   and avoids double-counting when both representations exist. Unit and desktop
   fixtures cover this format (`src-tauri/src/codex.rs`, `e2e/codex.spec.ts`).
2. **Installed Codex hook commands fail to parse in PowerShell.** The configured
   command was a quoted executable followed by arguments without a call operator.
   Running that exact command produced exit 1 and an unexpected-token error;
   invoking it with `&` returned exit 0 and `{}`. New installations explicitly
   invoke PowerShell with a literal, encoded call expression, preserving paths
   containing spaces, quotes or shell metacharacters. Desktop coverage now uses
   the command installed through Settings instead of bypassing command generation
   (`src-tauri/src/codex_hook.rs`, `e2e/codex.spec.ts`).

Changes in this checkout do not update an already installed executable. Existing
hooks also need updating and renewed review in Codex's `/hooks` screen. Hook
trust is tied to the exact definition; see the
[official OpenAI hook documentation](https://learn.chatgpt.com/docs/hooks).

## Remaining findings, in priority order

| Priority | Finding and evidence | Proposed improvement |
| --- | --- | --- |
| High | Workspace `lastSaved` and scrollback save timestamps advance before writes succeed; errors are swallowed. An unchanged layout or buffer can therefore skip retries after a transient failure (`src/App.tsx`, `flushSession`, `saveScrollbacks`). | Mark a snapshot saved only after success; serialize/coalesce writes, retry failures, and show a persistent save-error indicator. Test a failed write followed by recovery. |
| High | Codex scan suppresses directory and file errors, and the all-sessions view has no explanation for an empty result (`codex.rs`, `CodexMenu.tsx`). | Distinguish empty, missing folder, unreadable files and unsupported records. Show the resolved Codex home, scan counts, Refresh and Open folder. Avoid describing an inaccessible index as zero sessions. |
| Medium | Tests previously used only the older rollout message shape and directly invoked hook mode. Both reported issues escaped despite passing tests. | Keep sanitized fixtures for supported Codex versions and execute generated hook commands through the actual Windows shell. Include incomplete records and mixed formats. |
| Medium | Each usage request enumerates all rollout files under a mutex; polling requests usage separately for each running pane (`codex.rs::rollouts`, `useCodex.ts`). Parsed content is cached, but traversal and cloning still repeat. | Batch usage lookup per poll; measure on large histories, then add incremental indexing and background blocking I/O if warranted. |
| Medium | Codex hooks have no visible end-to-end health check. “Configured” establishes command equality, not successful delivery, pane association, or trust (`SettingsPanel.tsx`, `codex_hook.rs`). | Add a Test connection action and show the last event/time, executable, receiving pane and actionable failure reason. Keep trust review explicit. |
| Medium | Agent menus duplicate grouping, filtering, row actions and empty-state behavior (`ClaudeMenu.tsx`, `CodexMenu.tsx`). `App.tsx` also owns many unrelated lifecycle concerns. | Extract a shared session browser and isolate persistence/agent lifecycle hooks in small steps, keeping provider-specific parsing separate. |
| Medium | Accessibility remains open on the roadmap; no screen-reader or minimum-contrast setting is exposed. | Add terminal screen-reader mode, contrast controls and keyboard-only checks for menus, panes and Settings before adding more dense controls. |
| Review | The webview has no CSP (`src-tauri/tauri.conf.json`). This alone does not demonstrate an exploit. | Audit rendered content and IPC capabilities, then adopt a restrictive production CSP compatible with local assets. Verify links and previews cannot introduce executable content. |

## Recommended feature sequence

| Order | Feature | User outcome | Approximate scope |
| --- | --- | --- | --- |
| 1 | Integration health and recoverable persistence | Understand why history, hooks or restore stopped working and recover without inspecting logs. | Medium |
| 2 | Searchable session library | Pin/rename sessions, filter by provider/project/branch, preview the last prompt, and refresh explicitly. Label native Windows, archived and WSL scope accurately. | Medium |
| 3 | Unified agent attention inbox | See permissions, completed replies and failures across Claude and Codex, jump to the right pane, and dismiss resolved items. Build on the current waiting menus and Alt+Shift+W. | Medium |
| 4 | Problems list from builds/tests (roadmap #68) | Navigate compiler and test failures across panes, with file/line links and a command rerun action. | Medium |
| 5 | Worktree-backed agent sessions (extend #40 to both providers) | Start parallel tasks on separate branches and folders, with explicit cleanup controls. | Medium–large |
| 6 | Workspace notes and task presets (#77, extend existing tasks) | Keep a project's commands, context and working notes alongside its panes. | Medium |

Code signing and ARM64 packaging are valuable distribution work already tracked
in the roadmap. Prioritize them when expanding the audience; prioritize the first
three items above for the current daily workflow. These are product judgments
based on this repository and the failures reproduced here, not market research.

## Verification

Final checks: 287 TypeScript tests across 41 files passed; 129 Rust library tests
passed with one ignored; the frontend production build and Clippy with warnings
denied passed. All three Codex desktop tests passed, including the Settings-installed
hook command. Deliberately broken fixtures made both history and hook checks fail;
restoring the fixtures returned the suite to green. The repaired command in the
local hooks file also returned exit 0, `{}` and no stderr through PowerShell.
The full desktop suite was not rerun.
