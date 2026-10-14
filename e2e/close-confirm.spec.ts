// Risk R21 (e2e/README.md): closing a pane where a program still runs asks first and
// names it; an idle pane closes at once (pane's shell → its child processes → dialog).
import { expect, test } from "./qterm";

test("closing a pane with a program running asks first; an idle one closes at once", async ({ qterm }) => {
  const page = qterm.page;
  const pane = await qterm.activePane();
  await qterm.waitForPrompt(pane);
  // A second pane, so closing the first leaves the tab (and the check simple).
  await page.keyboard.press("Alt+Shift+=");
  await expect.poll(async () => Object.keys((await qterm.workspace()).panes).length).toBe(2);
  const second = await qterm.activePane();
  await qterm.waitForPrompt(second);

  // A program that runs a while under the shell.
  await qterm.run(second, "ping -n 30 127.0.0.1");
  await expect.poll(() => qterm.terminalText(second)).toContain("Reply from 127.0.0.1");

  await qterm.pane(second).getByRole("textbox", { name: "Terminal input" }).focus();
  await page.keyboard.press("Control+Shift+W");
  const dialog = page.getByRole("alertdialog", { name: "Close this pane?" });
  await expect(dialog).toContainText("ping is still running in this pane");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  expect(Object.keys((await qterm.workspace()).panes)).toContain(second);

  // Asked again, closed this time.
  await qterm.pane(second).getByRole("textbox", { name: "Terminal input" }).focus();
  await page.keyboard.press("Control+Shift+W");
  await dialog.getByRole("button", { name: "Close pane" }).click();
  await expect.poll(async () => Object.keys((await qterm.workspace()).panes)).toEqual([pane]);

  // The idle first pane: no question. The console always has a shell, so a fresh one replaces it.
  await qterm.pane(pane).getByRole("textbox", { name: "Terminal input" }).focus();
  await page.keyboard.press("Control+Shift+W");
  await expect.poll(async () => Object.keys((await qterm.workspace()).panes)).not.toContain(pane);
  await expect(dialog).toHaveCount(0);
});
