// Risk R30 (e2e/README.md): JSON a command printed opens in the JSON viewer from the
// palette, folded into its values, and Copy on a value puts exactly that value on the
// clipboard (shell output and command marks → viewer → Windows clipboard).
import { clipboardText, expect, test } from "./qterm";

test("a command's JSON output opens in the viewer and one value can be copied", async ({ qterm }) => {
  const marker = Date.now() % 100_000;
  const pane = await qterm.activePane();
  await qterm.waitForPrompt(pane);
  // JSON only the shell can produce: the numbers are computed.
  await qterm.run(pane, `@{ name = "json-$(${marker} + 1)"; answer = 6 * 7; tags = @("a", "b") } | ConvertTo-Json -Compress`);
  await expect.poll(() => qterm.terminalText(pane)).toContain(`"json-${marker + 1}"`);

  await qterm.page.keyboard.press("Control+Shift+P");
  const palette = qterm.page.getByRole("dialog", { name: "Command palette" });
  await palette.getByRole("combobox", { name: "Command" }).fill("view json");
  await palette.getByRole("option", { name: /View the selection or last output as JSON/ }).click();

  const viewer = qterm.page.getByRole("dialog", { name: "JSON viewer" });
  await expect(viewer.getByRole("treeitem", { name: "answer" })).toContainText("42");
  await expect(viewer.getByRole("treeitem", { name: "tags" })).toContainText('"b"');

  await viewer.getByRole("button", { name: "Copy $.name" }).click();
  await expect(viewer.getByRole("status")).toHaveText("Copied $.name");
  expect(clipboardText()).toBe(`json-${marker + 1}`);

  // Esc closes it, back to the shell.
  await qterm.page.keyboard.press("Escape");
  await expect(viewer).toBeHidden();
});
