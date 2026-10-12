// Risk R4 (e2e/README.md): a long command that fails in a tab you aren't looking at
// marks that tab (PowerShell integration → OSC 133 marks → the tab's alert).
import { expect, test } from "./qterm";

// Anything running a second or more counts as long here.
test.use({ settings: { values: { long_command_alert: "1" } } });

test("a long command that fails in a background tab marks that tab", async ({ qterm }) => {
  const first = await qterm.activePane();
  await qterm.waitForPrompt(first);

  // Start a command that runs a while and then fails...
  await qterm.run(first, "Start-Sleep -Seconds 2; cmd /c exit 4");

  // ...and look at another tab while it runs.
  await qterm.page.keyboard.press("Control+Shift+T");
  await expect(qterm.page.getByRole("tab")).toHaveCount(2);
  await expect(qterm.page.getByRole("tab").nth(1)).toHaveAttribute("aria-selected", "true");

  // The first tab says the command failed, with its exit code.
  const firstTab = qterm.page.getByRole("tab").first();
  await expect(firstTab.getByRole("status", { name: /Command failed \(exit 4\)/ })).toBeVisible();
});
