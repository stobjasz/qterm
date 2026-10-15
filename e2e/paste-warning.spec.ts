// Risk R28 (e2e/README.md): pasting several lines into a shell asks first, and nothing
// runs until you say so (clipboard → paste → the question → the shell).
import { copyToClipboard, expect, test } from "./qterm";

test("pasting several lines into a shell runs nothing until confirmed", async ({ qterm }) => {
  const marker = Date.now() % 100_000;
  const pane = await qterm.activePane();
  await qterm.waitForPrompt(pane);
  const input = qterm.pane(pane).getByRole("textbox", { name: "Terminal input" });
  // Two commands, each printing a value only running it produces.
  copyToClipboard(`Write-Output "one-$(${marker} + 1)"\nWrite-Output "two-$(${marker} + 2)"\n`);

  // Pasted, then cancelled: neither line ran.
  await input.focus();
  await qterm.page.keyboard.press("Control+Shift+V");
  const question = qterm.page.getByRole("alertdialog", { name: "Paste 2 lines?" });
  await expect(question.getByLabel("What will be pasted")).toContainText(`two-$(${marker} + 2)`);
  await question.getByRole("button", { name: "Cancel" }).click();
  await expect(question).toBeHidden();
  await qterm.run(pane, `Write-Output "after-$(${marker} + 3)"`);
  await expect.poll(() => qterm.terminalText(pane)).toContain(`after-${marker + 3}`);
  expect(await qterm.terminalText(pane)).not.toContain(`one-${marker + 1}`);

  // Pasted and confirmed: both ran.
  await input.focus();
  await qterm.page.keyboard.press("Control+Shift+V");
  await question.getByRole("button", { name: "Paste 2 lines" }).click();
  await expect.poll(() => qterm.terminalText(pane)).toContain(`two-${marker + 2}`);
  expect(await qterm.terminalText(pane)).toContain(`one-${marker + 1}`);
});
