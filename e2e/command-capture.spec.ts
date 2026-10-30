// R54: final partial line must survive shell prompt output and app restart.
import { expect, test } from "./qterm";

test("a command's final output without a newline is recorded without its next prompt", async ({ qterm }) => {
  const pane = await qterm.activePane(); await qterm.waitForPrompt(pane);
  await qterm.run(pane, "[Console]::Write('partial-' + (6*7))");
  await expect.poll(() => qterm.terminalText(pane)).toContain("partial-42");
  await qterm.page.getByRole("button", { name: "Problems and command runs", exact: true }).click();
  let panel = qterm.page.getByRole("dialog", { name: "Problems and command runs", exact: true });
  await panel.getByRole("button", { name: /Inspect run:.*Console.*Write/ }).click();
  await panel.getByText("Captured output", { exact: true }).click();
  await expect(panel.getByLabel("Captured command output", { exact: true })).toHaveText("partial-42");
  await panel.getByRole("button", { name: "Close problems", exact: true }).click();
  await qterm.restart();
  await qterm.page.getByRole("button", { name: "Problems and command runs", exact: true }).click();
  panel = qterm.page.getByRole("dialog", { name: "Problems and command runs", exact: true });
  await panel.getByRole("button", { name: /Inspect run:.*Console.*Write/ }).click();
  await panel.getByText("Captured output", { exact: true }).click();
  await expect(panel.getByLabel("Captured command output", { exact: true })).toHaveText("partial-42");
});
