// Risk R17 (e2e/README.md): a [[triggers]] pattern matching a line a shell prints in a
// tab you aren't looking at marks that tab with the trigger and the line (settings →
// registry line check → the tab's alert).
import { expect, test } from "./qterm";

// Anchored at the line start: the echoed command line ("PS ...> Write-Output ...")
// can't match, only the shell's own output can.
test.use({
  settings: {
    extra: `[[triggers]]\nname = "Build done"\npattern = '^built-ok-\\d+$'\nregex = true\naction = "mark"\n`,
  },
});

test("a trigger matching output in a background tab marks that tab with the line", async ({ qterm }) => {
  const first = await qterm.activePane();
  await qterm.waitForPrompt(first);
  const marker = Date.now() % 100_000;
  await qterm.run(first, `Start-Sleep -Seconds 2; Write-Output ("built-ok-" + (${marker} * 3))`);

  // Look at another tab while it runs.
  await qterm.page.keyboard.press("Control+Shift+T");
  await expect(qterm.page.getByRole("tab")).toHaveCount(2);

  const firstTab = qterm.page.getByRole("tab").first();
  await expect(firstTab.getByRole("status", { name: `Build done: built-ok-${marker * 3}` })).toBeVisible();
});
