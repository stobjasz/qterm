// Risk R35 (e2e/README.md): a pane split with another shell runs that shell in the same
// folder, panes say which shell they run while a tab mixes them, and switching a pane's
// shell keeps its place and folder (palette → split / replace → Rust starts that profile
// in the folder → the shells themselves answer).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { expect, test } from "./qterm";

test("a split with Command Prompt runs cmd in the same folder, and switching back keeps it", async ({ qterm }) => {
  const marker = Date.now() % 100_000;
  const folder = path.join(fs.realpathSync.native(os.tmpdir()), `qterm-mixed-${marker}`);
  fs.mkdirSync(folder);
  const palette = qterm.page.getByRole("dialog", { name: "Command palette" });
  const runFromPalette = async (query: string, option: RegExp) => {
    await qterm.page.keyboard.press("Control+Shift+P");
    await palette.getByRole("combobox", { name: "Command" }).fill(query);
    await palette.getByRole("option", { name: option }).click();
    await expect(palette).toBeHidden();
  };
  try {
    const first = await qterm.activePane();
    await qterm.waitForPrompt(first);
    await qterm.run(first, `Set-Location '${folder}'`);
    await expect.poll(async () => (await qterm.workspace()).panes[first].cwd).toBe(folder);

    // Split right with Command Prompt: cmd's own prompt, in the same folder.
    await runFromPalette("split right command prompt", /^Split right with\s*Command Prompt/);
    await expect.poll(async () => Object.keys((await qterm.workspace()).panes).length).toBe(2);
    const second = await qterm.activePane();
    await expect.poll(() => qterm.terminalText(second), { timeout: 30_000 }).toContain(`${folder}>`);
    // Something only cmd computes this way (PowerShell has no `set /a`).
    await qterm.run(second, `set /a ${marker}*3`);
    await expect.poll(() => qterm.terminalText(second)).toMatch(new RegExp(`^${marker * 3}$`, "m"));

    // The tab mixes shells: each pane says which one it runs.
    await expect(qterm.pane(first).getByRole("note", { name: "Shell: PowerShell" })).toBeVisible();
    await expect(qterm.pane(second).getByRole("note", { name: "Shell: Command Prompt" })).toBeVisible();

    // Switch the cmd pane to PowerShell: a new shell in its place and folder.
    await runFromPalette("switch this pane to powershell", /^Switch this pane to\s*PowerShell/);
    await expect.poll(async () => paneIdsOf(await qterm.workspace())).not.toContain(second);
    const third = await qterm.activePane();
    expect(paneIdsOf(await qterm.workspace())).toEqual([first, third]);
    await expect.poll(() => qterm.terminalText(third), { timeout: 30_000 }).toContain(`PS ${folder}>`);
    // One kind of shell again: no labels.
    await expect(qterm.page.getByRole("note", { name: /^Shell: / })).toHaveCount(0);
  } finally {
    // cmd started in the folder, which Windows keeps from being deleted while a shell runs there.
    await qterm.stop();
    fs.rmSync(folder, { recursive: true, force: true });
  }
});

/** The panes of the first tab, in layout order. */
function paneIdsOf(ws: { tabs: { root: unknown }[] }): string[] {
  const ids: string[] = [];
  const visit = (node: { kind: string; pane?: string; children?: unknown[] }) =>
    node.kind === "leaf" ? ids.push(node.pane!) : node.children!.forEach((child) => visit(child as typeof node));
  visit(ws.tabs[0].root as { kind: string });
  return ids;
}
