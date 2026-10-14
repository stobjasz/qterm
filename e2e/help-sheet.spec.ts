// Risk R22 (e2e/README.md): Ctrl+Shift+/ in a terminal opens "Shortcuts and tips",
// which shows the shortcuts in effect (a rebound one by its new keys), not the defaults.
import { expect, test } from "./qterm";

// The whole settings file: the defaults already have a [keybindings] table, and TOML
// doesn't allow a second one.
test.use({ settings: { files: { "config.toml": `[keybindings]\nquick_select = "f10"\n` } } });

test("the shortcuts sheet opens from the terminal and shows the keys in effect", async ({ qterm }) => {
  const pane = await qterm.activePane();
  await qterm.waitForPrompt(pane);
  // Not a first start (the test's settings file was there before): no welcome.
  await expect(qterm.page.getByRole("status", { name: "Welcome" })).toHaveCount(0);

  await qterm.pane(pane).getByRole("textbox", { name: "Terminal input" }).focus();
  await qterm.page.keyboard.press("Control+Shift+Slash");
  const sheet = qterm.page.getByRole("dialog", { name: "Shortcuts and tips" });
  await expect(sheet).toBeVisible();

  const keyboard = sheet.getByRole("region", { name: "Keyboard" });
  await expect(keyboard.locator(".help-row", { hasText: "Command palette" })).toContainText("Ctrl+Shift+P");
  await expect(keyboard.locator(".help-row", { hasText: "Quick select" })).toContainText("F10");
  await expect(sheet.getByRole("region", { name: "Mouse" })).toContainText("Shift+right-click a pane");

  await qterm.page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
});
