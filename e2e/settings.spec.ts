// Risk R5 (e2e/README.md): a setting saved in the Settings panel reaches config.toml
// and applies to the terminals already open (UI → Rust → file → watcher → UI).
import { expect, test } from "./qterm";

test("a font size saved in Settings is written to config.toml and applied to open terminals", async ({ qterm }) => {
  const pane = await qterm.activePane();
  await qterm.waitForPrompt(pane);

  await qterm.page.getByRole("button", { name: "Settings" }).click();
  const settings = qterm.page.getByRole("dialog", { name: "Settings" });
  await expect(settings).toBeVisible();
  await settings.getByRole("spinbutton", { name: "Font size" }).fill("19");
  await settings.getByRole("button", { name: "Save", exact: true }).click();
  await expect(settings).toBeHidden();

  // On disk, in the [font] table, comments kept.
  await expect.poll(() => qterm.settingsOnDisk()).toMatch(/\[font\][^[]*\nsize = 19/);
  // And in the open terminal, without a restart.
  await expect.poll(() => qterm.fontSize(pane)).toBe(19);
});
