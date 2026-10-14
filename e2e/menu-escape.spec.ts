// Risk R20 (e2e/README.md): Esc closes a menu or panel opened while the keyboard is in a terminal
// (right-click on a tab, Shift+right-click on a pane, Ctrl+, for Settings) and doesn't reach the shell.
import { expect, test } from "./qterm";

test("Esc closes the tab and pane menus and leaves the shell's line alone", async ({ qterm }) => {
  const pane = await qterm.activePane();
  await qterm.waitForPrompt(pane);
  const page = qterm.page;
  // Something typed at the prompt, not run: PowerShell clears the line on Esc.
  const typed = `echo kept-${Date.now() % 100_000}`;
  await qterm.pane(pane).getByRole("textbox", { name: "Terminal input" }).focus();
  await page.keyboard.insertText(typed);
  await expect.poll(() => qterm.terminalText(pane)).toContain(typed);

  // Right-click on the tab: its colour and icon menu.
  await page.getByRole("tab").first().click({ button: "right" });
  const tabMenu = page.getByRole("dialog", { name: "Tab colour and icon" });
  await expect(tabMenu).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(tabMenu).toBeHidden();

  // Shift+right-click on the pane: its background menu.
  await qterm.pane(pane).click({ button: "right", modifiers: ["Shift"] });
  const paneMenu = page.getByRole("dialog", { name: "Pane background" });
  await expect(paneMenu).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(paneMenu).toBeHidden();

  // Ctrl+, from the terminal: Settings, which closes on Esc the same way.
  await page.keyboard.press("Control+Comma");
  const settings = page.getByRole("dialog", { name: "Settings" });
  await expect(settings).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(settings).toBeHidden();

  // The shell never saw the Esc: what was typed is still there, and runs.
  await page.keyboard.press("Enter");
  await expect.poll(() => qterm.terminalText(pane)).toMatch(new RegExp(`^${typed.replace("echo ", "")}$`, "m"));
});
