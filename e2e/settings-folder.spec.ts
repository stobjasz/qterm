// Risk R18 (e2e/README.md): settings kept in a folder of your choice are the ones in
// effect: an edit there applies at once (the file watcher moved with them), and a
// restart reads them from there (pointer file → load).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { expect, test } from "./qterm";

test("settings kept in a folder of your choice apply live and after a restart", async ({ qterm }) => {
  const folder = path.join(fs.realpathSync.native(os.tmpdir()), `qterm-settings-${Date.now()}`);
  fs.mkdirSync(folder);
  try {
    const pane = await qterm.activePane();
    await qterm.waitForPrompt(pane);

    // Settings → Keep settings in a folder…: the folder comes from Windows' folder
    // picker, which a test can't drive, so the step after it is invoked directly.
    expect(await qterm.invoke("set_settings_folder", { folder })).toBe("moved");
    const file = path.join(folder, "config.toml");
    expect(fs.readFileSync(file, "utf8")).toMatch(/\[font\]/);

    // An edit in the folder applies to the open terminal.
    fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace(/(\[font\][^[]*\nsize = )\d+/, "$117"));
    await expect.poll(() => qterm.fontSize(pane)).toBe(17);

    // After a restart, still the folder's settings.
    await qterm.restart();
    await expect.poll(async () => qterm.fontSize(await qterm.activePane())).toBe(17);
    await qterm.page.getByRole("button", { name: "Settings" }).click();
    await expect(qterm.page.getByRole("dialog", { name: "Settings" }).getByText(file, { exact: false })).toBeVisible();
  } finally {
    await qterm.stop();
    fs.rmSync(folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});
