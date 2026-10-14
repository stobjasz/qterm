// Risk R13 (e2e/README.md): Claude Code's status line, relayed by qterm, reaches the
// app: the plan usage shows in the ✳ menu (shell → `qterm --claude-statusline` →
// inbox → watcher → UI). The JSON is what Claude Code passes its status line
// command, piped in by hand: no Claude Code needed.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { EXE, expect, test } from "./qterm";

// The ✳ menu exists with remembered sessions on.
test.use({ settings: { values: { claude_sessions: "true" } } });

test("plan usage from Claude Code's status line shows in the ✳ menu", async ({ qterm }) => {
  const used = 10 + (Date.now() % 80);
  const input = path.join(fs.realpathSync.native(os.tmpdir()), `qterm-statusline-${Date.now()}.json`);
  fs.writeFileSync(
    input,
    JSON.stringify({
      session_id: "e2e-session",
      model: { id: "claude-opus-5-5", display_name: "Opus 5.5" },
      context_window: { total_input_tokens: 120000, context_window_size: 1000000, used_percentage: 12 },
      cost: { total_cost_usd: 0.42 },
      rate_limits: { five_hour: { used_percentage: used }, seven_day: { used_percentage: 7 } },
    }),
  );
  try {
    const pane = await qterm.activePane();
    await qterm.waitForPrompt(pane);
    // What Claude Code does: pipe the JSON into the status line command.
    await qterm.run(pane, `Get-Content '${input}' -Raw | & '${EXE}' --claude-statusline`);

    // Its own line, printed for Claude Code to show...
    await expect.poll(() => qterm.terminalText(pane)).toContain(`Opus 5.5 · 12% context · 5h ${used}% · 7d 7%`);
    // ...and the plan usage, in the ✳ menu.
    await qterm.page.getByRole("button", { name: "Claude sessions" }).click();
    await expect(qterm.page.getByRole("region", { name: "Claude plan usage" })).toContainText(`5-hour ${used}% · 7-day 7%`);
  } finally {
    fs.rmSync(input, { force: true });
  }
});
