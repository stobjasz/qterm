// Risk R23 (e2e/README.md): when Claude Code finishes a turn in a pane, the tab's
// tooltip shows what it said last (Stop hook → `qterm --claude-notify` → inbox → the
// tab). The hook input is Claude Code's documented JSON, piped in by hand; an idle
// stand-in for claude.exe makes the pane count as running Claude.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { EXE, expect, startFakeClaude, test } from "./qterm";

test("Claude's last reply in a pane shows on hovering its tab", async ({ qterm }) => {
  const marker = Date.now() % 100_000;
  const input = path.join(fs.realpathSync.native(os.tmpdir()), `qterm-stop-${marker}.json`);
  fs.writeFileSync(
    input,
    JSON.stringify({
      session_id: "e2e-session",
      hook_event_name: "Stop",
      stop_hook_active: false,
      last_assistant_message: `Done: all ${marker} tests pass.\n\nNext I would look at the flaky one.`,
      background_tasks: [],
      session_crons: [],
    }),
  );
  try {
    const pane = await qterm.activePane();
    await qterm.waitForPrompt(pane);
    const tab = qterm.page.getByRole("tab").first();

    // Claude Code runs in the pane (idle at its prompt)...
    await qterm.run(pane, startFakeClaude());
    await expect(tab.getByRole("status", { name: "Claude is idle" })).toBeVisible();

    // ...and finishes a turn: its Stop hook runs.
    await qterm.run(pane, `Get-Content '${input}' -Raw | & '${EXE}' --claude-notify`);

    await expect(tab).toHaveAccessibleDescription(new RegExp(`Claude's last reply:\\s+Done: all ${marker} tests pass\\.`));
  } finally {
    fs.rmSync(input, { force: true });
  }
});
