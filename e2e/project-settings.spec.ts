// Risk R27 (e2e/README.md): a project's .qterm.toml names and marks the tab of a pane
// inside it, and adds its snippets there; leaving the project takes them away again
// (shell's folder → Rust finds and reads .qterm.toml → tab and palette).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { expect, test } from "./qterm";

test("a project's .qterm.toml names the tab and adds its snippets while a pane is inside", async ({ qterm }) => {
  const marker = Date.now() % 100_000;
  const project = path.join(fs.realpathSync.native(os.tmpdir()), `qterm-project-${marker}`);
  fs.mkdirSync(path.join(project, "deep", "er"), { recursive: true });
  fs.writeFileSync(
    path.join(project, ".qterm.toml"),
    `name = "Shop ${marker}"\ntab_color = "green"\nicon = "S"\n\n[[snippets]]\nname = "Seed ${marker}"\ncommand = "Write-Output seeded-$(${marker} + 1)"\nrun = true\n`,
  );
  try {
    const pane = await qterm.activePane();
    await qterm.waitForPrompt(pane);
    const tab = qterm.page.getByRole("tab").first();

    // Two folders down inside the project: its settings still apply.
    await qterm.run(pane, `Set-Location '${path.join(project, "deep", "er")}'`);
    await expect(tab).toHaveAccessibleName(new RegExp(`Shop ${marker}`));

    // Its snippet is in the palette, and runs in this pane.
    await qterm.page.keyboard.press("Control+Shift+P");
    const palette = qterm.page.getByRole("dialog", { name: "Command palette" });
    await palette.getByRole("combobox", { name: "Command" }).fill(`Seed ${marker}`);
    await palette.getByRole("option", { name: new RegExp(`^Snippet\\s*Seed ${marker}`) }).click();
    await expect(palette).toBeHidden();
    await expect.poll(() => qterm.terminalText(pane)).toContain(`seeded-${marker + 1}`);

    // Out of the project: the shell's own title again, and no snippet.
    await qterm.run(pane, `Set-Location '${os.tmpdir()}'`);
    await expect(tab).not.toHaveAccessibleName(new RegExp(`Shop ${marker}`));
    await qterm.page.keyboard.press("Control+Shift+P");
    await palette.getByRole("combobox", { name: "Command" }).fill(`Seed ${marker}`);
    await expect(palette.getByRole("option", { name: new RegExp(`Seed ${marker}`) })).toHaveCount(0);
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
  }
});
