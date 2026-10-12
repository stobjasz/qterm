// Risk R2 (e2e/README.md): after a split, input goes to the pane you typed in only,
// and closing that pane leaves the other one working.
import { expect, test } from "./qterm";

test("a split pane gets its own input, and closing it leaves the other pane working", async ({ qterm }) => {
  const left = await qterm.activePane();
  await qterm.waitForPrompt(left);

  // Split right: a second shell opens and takes the focus.
  await qterm.page.getByRole("button", { name: "Split right" }).click();
  await expect.poll(() => qterm.activePane()).not.toBe(left);
  const right = await qterm.activePane();
  await expect(qterm.pane(right)).toBeVisible();
  await qterm.waitForPrompt(right);

  // What is typed in the right pane runs there...
  const marker = Date.now() % 100_000;
  await qterm.run(right, `Write-Output "right-$(${marker} + 1)"`);
  await expect.poll(() => qterm.terminalText(right)).toContain(`right-${marker + 1}`);

  // ...and not in the left one. The left pane's own command runs after anything that
  // could have leaked into it, so once its result is there, a leak would be too.
  await qterm.run(left, `Write-Output "left-$(${marker} + 2)"`);
  await expect.poll(() => qterm.terminalText(left)).toContain(`left-${marker + 2}`);
  // Neither the command nor its result: leaked keystrokes leave their text behind even
  // when they don't run cleanly.
  const leftText = await qterm.terminalText(left);
  expect(leftText).not.toContain(`right-$(${marker} + 1)`);
  expect(leftText).not.toContain(`right-${marker + 1}`);

  // Close the right pane: it's gone, and the left one still runs commands.
  await qterm.pane(right).getByRole("textbox", { name: "Terminal input" }).focus();
  await qterm.page.keyboard.press("Control+Shift+W");
  await expect(qterm.pane(right)).toHaveCount(0);
  await qterm.run(left, `Write-Output "left-$(${marker} + 3)"`);
  await expect.poll(() => qterm.terminalText(left)).toContain(`left-${marker + 3}`);
});
