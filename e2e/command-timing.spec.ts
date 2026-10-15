// Risk R34 (e2e/README.md): a command's bar says when it ran and how long it took, and
// the palette's recent commands say so too (shell integration marks → bar menu →
// history → palette).
import { expect, test } from "./qterm";

test("a command's bar and the recent commands show when it ran and how long it took", async ({ qterm }) => {
  const pane = await qterm.activePane();
  await qterm.waitForPrompt(pane);
  const marker = Date.now() % 100_000;
  // About three seconds: long enough to tell from an instant command.
  const command = `Start-Sleep -Milliseconds 3000; Write-Output "slept-$(${marker} + 1)"`;
  await qterm.run(pane, command);
  await expect.poll(() => qterm.terminalText(pane)).toContain(`slept-${marker + 1}`);

  await qterm.pane(pane).getByRole("button", { name: `Command: ${command}` }).click();
  const menu = qterm.page.getByRole("menu", { name: "Command" });
  await expect(menu).toContainText(/\d{1,2}.\d{2}.\d{2}\s*(AM|PM)?\s*· took 3s/);
  await qterm.page.keyboard.press("Escape");
  await expect(menu).toBeHidden();

  await qterm.page.keyboard.press("Control+Shift+P");
  const palette = qterm.page.getByRole("dialog", { name: "Command palette" });
  await palette.getByRole("combobox", { name: "Command" }).fill(`slept ${marker}`);
  await expect(palette.getByRole("option", { name: new RegExp(`^Recent command.*${marker}`) })).toContainText(/· 3s ·/);
});
