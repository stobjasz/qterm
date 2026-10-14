// Risk R11 (e2e/README.md): quick select labels what's on screen and typing a label
// picks exactly that target (rendered labels over the canvas, keys taken before the
// terminal sees them, the target's text copied).
import { expect, test } from "./qterm";

test("typing a quick select label copies the target under it", async ({ qterm }) => {
  const pane = await qterm.activePane();
  await qterm.waitForPrompt(pane);

  // A git-hash-like token only the shell can produce: "ab" and a computed number.
  const marker = 10_000 + (Date.now() % 80_000);
  const hash = `ab${marker * 7}`;
  await qterm.run(pane, `Write-Output ("ab" + (${marker} * 7))`);
  await expect.poll(() => qterm.terminalText(pane)).toContain(hash);

  // Alt+Shift+S: labels over the screen; the one over the hash names it.
  await qterm.pane(pane).getByRole("textbox", { name: "Terminal input" }).focus();
  await qterm.page.keyboard.press("Alt+Shift+S");
  const overlay = qterm.page.getByRole("status", { name: "Quick select" });
  await expect(overlay).toBeVisible();
  const label = (await overlay.getByTitle(hash, { exact: true }).textContent()) ?? "";
  expect(label).toMatch(/^[a-z]{1,2}$/);

  await qterm.page.keyboard.type(label);
  await expect(overlay).toBeHidden();
  await expect(qterm.page.getByRole("status").filter({ hasText: `Copied ${hash}` })).toBeVisible();
  // The label's letters went to quick select, not to the prompt: a command typed now
  // runs as typed (a leaked letter in front of it would make it fail).
  await qterm.run(pane, `Write-Output "after-$(${marker} + 2)"`);
  await expect.poll(() => qterm.terminalText(pane)).toContain(`after-${marker + 2}`);
});
