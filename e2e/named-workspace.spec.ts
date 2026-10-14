// Risk R10 (e2e/README.md): tabs saved as a named workspace open again after a
// restart, each shell in its folder (palette → name dialog → workspaces.json →
// restart → palette → new shells started where they were).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { expect, IDENTIFIER, test } from "./qterm";

// Tabs aren't reopened on start: only the workspace can bring the folder back.
test.use({ settings: { values: { restore_session: "false" } } });

test("tabs saved as a named workspace open again after a restart, in their folder", async ({ qterm }) => {
  const marker = Date.now();
  const folder = path.join(fs.realpathSync.native(os.tmpdir()), `qterm-workspace-${marker}`);
  const name = `ws-${marker}`;
  fs.mkdirSync(folder);
  try {
    const pane = await qterm.activePane();
    await qterm.waitForPrompt(pane);
    await qterm.run(pane, `Set-Location '${folder}'`);
    await expect.poll(async () => (await qterm.workspace()).panes[pane]?.cwd).toBe(folder);

    // Palette → "Save all tabs as a workspace…" → name it.
    const openPalette = async (paneId: string) => {
      await qterm.pane(paneId).getByRole("textbox", { name: "Terminal input" }).focus();
      await qterm.page.keyboard.press("Control+Shift+P");
      return qterm.page.getByRole("dialog", { name: "Command palette" });
    };
    let palette = await openPalette(pane);
    await palette.getByRole("combobox", { name: "Command" }).fill("save all tabs as a workspace");
    await palette.getByRole("option", { name: /^Workspace.*Save all tabs/ }).click();
    const dialog = qterm.page.getByRole("dialog", { name: "Save workspace" });
    await dialog.getByRole("textbox").fill(name);
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toBeHidden();
    await expect.poll(() => fs.existsSync(path.join(process.env.APPDATA ?? "", IDENTIFIER, "workspaces.json"))).toBe(true);

    await qterm.restart();
    const fresh = await qterm.activePane();
    await qterm.waitForPrompt(fresh);
    await expect(qterm.page.getByRole("tab")).toHaveCount(1);

    // Palette → the workspace: its tab opens next to the fresh one, in the folder.
    palette = await openPalette(fresh);
    await palette.getByRole("combobox", { name: "Command" }).fill(name);
    await palette.getByRole("option", { name: new RegExp(`^Workspace.*${name}`) }).click();
    await expect(qterm.page.getByRole("tab")).toHaveCount(2);
    const opened = await qterm.activePane();
    expect(opened).not.toBe(fresh);
    await expect.poll(() => qterm.terminalText(opened), { timeout: 30_000 }).toContain(`PS ${folder}>`);
  } finally {
    await qterm.stop();
    fs.rmSync(folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});
