// Risk R3 (e2e/README.md): a restart brings back the tab, the folder it was in and
// its earlier output (the tab layout, shell integration and saved scrollback).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { expect, test } from "./qterm";

test("a restart brings back the tab, the folder it was in and its earlier output", async ({ qterm }) => {
  const marker = Date.now() % 100_000;
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "qterm-e2e-restore-"));
  try {
    const pane = await qterm.activePane();
    await qterm.waitForPrompt(pane);

    // Work in a folder of its own and print something worth keeping.
    await qterm.run(pane, `cd '${folder}'; Write-Output "kept-$(${marker} + 1)"`);
    await expect.poll(() => qterm.terminalText(pane)).toContain(`kept-${marker + 1}`);
    await expect.poll(async () => (await qterm.workspace()).panes[pane]?.cwd).toBe(folder);

    // Quit the way the tray does, then start again.
    await qterm.restart();

    // The same pane is back: the earlier output above the "restored" line, and a
    // new shell below it, in the same folder.
    await expect(qterm.page.getByRole("tab")).toHaveCount(1);
    await expect.poll(() => qterm.terminalText(pane), { timeout: 30_000 }).toMatch(
      new RegExp(`kept-${marker + 1}[\\s\\S]*──── restored[\\s\\S]*PS ${escape(folder)}>`),
    );
  } finally {
    // The restored shell is still in the folder: end it before removing the folder.
    await qterm.stop();
    fs.rmSync(folder, { recursive: true, force: true });
  }
});

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
