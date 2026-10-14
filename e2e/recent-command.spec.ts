// Risk R9 (e2e/README.md): a command run in one shell can be typed again from the
// palette after a restart (shell integration marks → history → history.json →
// restart → palette → another shell runs it).
import { expect, test } from "./qterm";

// Tabs aren't reopened, so the old output can't satisfy the check after the restart.
test.use({ settings: { values: { restore_session: "false" } } });

test("a command run before a restart can be typed again from the palette", async ({ qterm }) => {
  const before = await qterm.activePane();
  await qterm.waitForPrompt(before);

  // A command whose output only the shell can produce (the sum isn't in the command line).
  const marker = Date.now() % 100_000;
  const command = `Write-Output "again-$(${marker} + 1)"`;
  await qterm.run(before, command);
  await expect.poll(() => qterm.terminalText(before)).toContain(`again-${marker + 1}`);

  await qterm.restart();
  const after = await qterm.activePane();
  await qterm.waitForPrompt(after);
  expect(await qterm.terminalText(after)).not.toContain(`again-${marker + 1}`);

  // Palette → the recent command: typed at the prompt, then run with Enter.
  const input = qterm.pane(after).getByRole("textbox", { name: "Terminal input" });
  await input.focus();
  await qterm.page.keyboard.press("Control+Shift+P");
  const palette = qterm.page.getByRole("dialog", { name: "Command palette" });
  await palette.getByRole("combobox", { name: "Command" }).fill(`again ${marker}`);
  await palette.getByRole("option", { name: new RegExp(`^Recent command.*${marker}`) }).click();
  await expect(palette).toBeHidden();
  await input.focus();
  await qterm.page.keyboard.press("Enter");

  await expect.poll(() => qterm.terminalText(after)).toContain(`again-${marker + 1}`);
});
