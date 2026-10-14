// Risk R15 (e2e/README.md): a command's ✓/✗ bar opens that command's menu, and its
// actions work on that command, not another (shell integration marks → decoration
// over the canvas → menu → selection / the shell).
import { expect, test } from "./qterm";

test("a command's bar selects that command's output and runs it again", async ({ qterm }) => {
  const pane = await qterm.activePane();
  await qterm.waitForPrompt(pane);
  const marker = Date.now() % 100_000;
  // Two commands with outputs only the shell can produce.
  const first = `Write-Output "first-$(${marker} + 1)"`;
  await qterm.run(pane, first);
  await expect.poll(() => qterm.terminalText(pane)).toContain(`first-${marker + 1}`);
  await qterm.run(pane, `Write-Output "second-$(${marker} + 2)"`);
  await expect.poll(() => qterm.terminalText(pane)).toContain(`second-${marker + 2}`);

  // The first command's bar → Select output: exactly its output is selected.
  const bar = qterm.pane(pane).getByRole("button", { name: `Command: ${first}` });
  await bar.click();
  const menu = qterm.page.getByRole("menu", { name: "Command" });
  await menu.getByRole("menuitem", { name: "Select output" }).click();
  await expect(menu).toBeHidden();
  const selection = () => qterm.page.evaluate((id) => (window as unknown as { __qterm: { registry: { entries: Map<string, { term: { getSelection(): string } }> } } }).__qterm.registry.entries.get(id)?.term.getSelection().trim(), pane);
  await expect.poll(selection).toBe(`first-${marker + 1}`);

  // Its bar again → Run again: the same command runs once more.
  await bar.click();
  await menu.getByRole("menuitem", { name: "Run again" }).click();
  await expect.poll(async () => (await qterm.terminalText(pane)).split(`first-${marker + 1}`).length - 1).toBe(2);
});
