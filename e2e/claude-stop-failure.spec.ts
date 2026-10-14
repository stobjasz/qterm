// Risk R14 (e2e/README.md): when Claude Code stops on an API error in a tab you aren't
// looking at, that tab says so (StopFailure hook → `qterm --claude-notify` → inbox →
// the tab's alert). The hook input is Claude Code's documented JSON, piped in by hand.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { EXE, expect, test } from "./qterm";

test("Claude stopping on a rate limit in a background tab marks that tab with the reason", async ({ qterm }) => {
  const marker = Date.now() % 100_000;
  const input = path.join(fs.realpathSync.native(os.tmpdir()), `qterm-stopfailure-${marker}.json`);
  fs.writeFileSync(
    input,
    JSON.stringify({
      session_id: "e2e-session",
      hook_event_name: "StopFailure",
      error: "rate_limit",
      error_details: "429 Too Many Requests",
      last_assistant_message: `API Error: Rate limit reached (${marker})`,
    }),
  );
  try {
    const first = await qterm.activePane();
    await qterm.waitForPrompt(first);
    // The hook runs a moment later, as Claude Code's would while you're elsewhere.
    await qterm.run(first, `Start-Sleep -Seconds 2; Get-Content '${input}' -Raw | & '${EXE}' --claude-notify`);
    await qterm.page.keyboard.press("Control+Shift+T");
    await expect(qterm.page.getByRole("tab")).toHaveCount(2);

    const firstTab = qterm.page.getByRole("tab").first();
    await expect(firstTab.getByRole("status", { name: `Claude stopped: rate limit reached: API Error: Rate limit reached (${marker})` })).toBeVisible();
  } finally {
    fs.rmSync(input, { force: true });
  }
});
