// Risk R24 (e2e/README.md): an idle Claude tab counts down to when its prompt cache
// goes cold, from the cache data Claude Code's status line passes (shell → `qterm
// --claude-statusline` → inbox → the tab), and says "cold" once it has.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { EXE, expect, startFakeClaude, test } from "./qterm";

test("an idle Claude tab counts down its prompt cache, then says it's cold", async ({ qterm }) => {
  const stamp = Date.now();
  const tmp = fs.realpathSync.native(os.tmpdir());
  const statusline = (expiresAt: number) => ({
    session_id: "e2e-session",
    model: { id: "claude-opus-5-5", display_name: "Opus 5.5" },
    prompt_cache: { warm: true, expires_at: expiresAt },
  });
  const warm = path.join(tmp, `qterm-cache-warm-${stamp}.json`);
  const expired = path.join(tmp, `qterm-cache-expired-${stamp}.json`);
  // Warm for about 7 minutes; and one that went cold a minute ago.
  fs.writeFileSync(warm, JSON.stringify(statusline(Math.floor(stamp / 1000) + 7 * 60 - 5)));
  fs.writeFileSync(expired, JSON.stringify(statusline(Math.floor(stamp / 1000) - 60)));
  try {
    const pane = await qterm.activePane();
    await qterm.waitForPrompt(pane);
    const tab = qterm.page.getByRole("tab").first();
    await qterm.run(pane, startFakeClaude());
    await expect(tab.getByRole("status", { name: "Claude is idle" })).toBeVisible();

    // What Claude Code does after each reply: pipe its figures into the status line command.
    await qterm.run(pane, `Get-Content '${warm}' -Raw | & '${EXE}' --claude-statusline`);
    await expect(tab.getByRole("timer", { name: "Claude's prompt cache stays warm for 7m" })).toBeVisible();

    await qterm.run(pane, `Get-Content '${expired}' -Raw | & '${EXE}' --claude-statusline`);
    await expect(tab.getByRole("timer", { name: "Claude's prompt cache is cold" })).toBeVisible();
  } finally {
    fs.rmSync(warm, { force: true });
    fs.rmSync(expired, { force: true });
  }
});
