// Risk R8 (e2e/README.md): Explorer's "Open in qterm" opens a tab in that folder in
// the qterm already running (setting → registry → second process → single-instance
// hand-off → UI → a shell started in the folder).

import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { expect, IDENTIFIER, test } from "./qterm";

test.use({ settings: { values: { explorer_menu: "true" } } });

/** What Explorer runs for "Open in qterm" inside a folder (this test build's own key). */
function menuCommand(): string | undefined {
  try {
    const out = execFileSync("reg", ["query", `HKCU\\Software\\Classes\\Directory\\Background\\shell\\${IDENTIFIER}\\command`, "/ve"], {
      encoding: "utf8",
    });
    return out.match(/REG_SZ\s+(.+)/)?.[1].trim();
  } catch {
    return undefined;
  }
}

function removeMenu(): void {
  for (const cls of ["Directory\\shell", "Directory\\Background\\shell", "Drive\\shell"]) {
    try {
      execFileSync("reg", ["delete", `HKCU\\Software\\Classes\\${cls}\\${IDENTIFIER}`, "/f"], { stdio: "ignore" });
    } catch {
      // Not there.
    }
  }
}

test("Explorer's Open in qterm opens a tab in that folder in the running qterm", async ({ qterm }) => {
  // A unique folder, by its long path (the temp folder can be an 8.3 name on CI).
  const folder = path.join(fs.realpathSync.native(os.tmpdir()), `qterm-open-here-${Date.now()}`);
  fs.mkdirSync(folder);
  try {
    const first = await qterm.activePane();
    await qterm.waitForPrompt(first);

    // The setting is on, so the menu item is registered for this exe.
    await expect.poll(menuCommand, { message: "the Explorer menu command in the registry" }).toMatch(/--open-here "%V"$/);
    const command = menuCommand()!.replace("%V", folder);
    const exe = command.match(/^"([^"]+)"/)![1];

    // Run it the way Explorer does: the whole command line, verbatim.
    const second = spawn(exe, [command.slice(exe.length + 2).trim()], { windowsVerbatimArguments: true, stdio: "ignore" });
    // The second start hands the folder over and exits.
    await expect.poll(() => second.exitCode, { message: "the second qterm to exit" }).toBe(0);

    // A new tab, active, whose shell starts in that folder.
    await expect(qterm.page.getByRole("tab")).toHaveCount(2);
    const opened = await qterm.activePane();
    expect(opened).not.toBe(first);
    await expect.poll(() => qterm.terminalText(opened), { timeout: 30_000 }).toContain(`PS ${folder}>`);
  } finally {
    await qterm.stop();
    removeMenu();
    fs.rmSync(folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});
