// Seed test: the exemplar every qterm E2E spec follows (see e2e/RULES.md).
// Risk R1 (e2e/README.md): the console opens with a shell, and what you type there
// runs in that shell (UI → Rust → ConPTY → PowerShell and back to the screen).
import { expect, test } from "./qterm";

test("a command typed into the console runs in its shell and prints its result", async ({ qterm }) => {
  // The console starts with one tab holding a ready shell.
  const pane = await qterm.activePane();
  await expect(qterm.page.getByRole("tab")).toHaveCount(1);
  await qterm.waitForPrompt(pane);

  // Type a command whose output only a real shell can produce: the sum isn't
  // part of what was typed, so the echo of the command line can't satisfy the check.
  const marker = Date.now() % 100_000;
  await qterm.run(pane, `Write-Output "sum-$(${marker} + 1)"`);

  // Wait for the shell's answer on screen, not for time.
  await expect.poll(() => qterm.terminalText(pane)).toContain(`sum-${marker + 1}`);
});
