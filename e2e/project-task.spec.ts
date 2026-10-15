// Risk R25 (e2e/README.md): the scripts of the project a pane is in show in the
// palette, and picking one runs it in a new pane beside it, in the project's folder
// (shell's folder → Rust reads package.json → palette → split → npm in a new shell).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { expect, test } from "./qterm";

test("a package.json script picked from the palette runs in a new pane in its folder", async ({ qterm }) => {
  const marker = Date.now() % 100_000;
  const project = path.join(fs.realpathSync.native(os.tmpdir()), `qterm-task-${marker}`);
  fs.mkdirSync(path.join(project, "src"), { recursive: true });
  // Prints the folder it runs in and a value only running it produces.
  const script = `node -e "console.log('task-' + (${marker} * 2) + ' in ' + process.cwd())"`;
  fs.writeFileSync(path.join(project, "package.json"), JSON.stringify({ name: "e2e", scripts: { [`greet-${marker}`]: script } }));
  try {
    const pane = await qterm.activePane();
    await qterm.waitForPrompt(pane);
    // In a folder inside the project, as you'd usually be.
    await qterm.run(pane, `Set-Location '${path.join(project, "src")}'`);
    await expect.poll(async () => (await qterm.workspace()).panes[pane].cwd).toBe(path.join(project, "src"));

    await qterm.page.keyboard.press("Control+Shift+P");
    const palette = qterm.page.getByRole("dialog", { name: "Command palette" });
    await palette.getByRole("combobox", { name: "Command" }).fill(`greet-${marker}`);
    await palette.getByRole("option", { name: new RegExp(`^Project task\\s*greet-${marker}`) }).click();
    await expect(palette).toBeHidden();

    // A second pane, next to the first, running the script in the project's folder.
    await expect.poll(async () => Object.keys((await qterm.workspace()).panes).length).toBe(2);
    const task = await qterm.activePane();
    expect(task).not.toBe(pane);
    await expect.poll(() => qterm.terminalText(task), { timeout: 60_000 }).toContain(`task-${marker * 2} in ${project}`);
  } finally {
    // The task's shell started in the project's folder, which Windows keeps from being deleted while it runs.
    await qterm.stop();
    fs.rmSync(project, { recursive: true, force: true });
  }
});
