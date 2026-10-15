// Risk R31 (e2e/README.md): F11 lets the console fill the screen's work area and F11
// again brings it back to its size, without the key reaching the shell (keymap → Rust
// resizes the window → the panes refit).
import { expect, test } from "./qterm";

// Half the screen to start from, so full size is clearly different.
test.use({ settings: { values: { height: "0.5" } } });

test("F11 makes the console full size and back to its own size", async ({ qterm }) => {
  const page = qterm.page;
  const pane = await qterm.activePane();
  await qterm.waitForPrompt(pane);
  const share = () => page.evaluate(() => window.innerHeight / window.screen.availHeight);
  const rows = () => page.evaluate((id) => (window as unknown as { __qterm: { registry: { entries: Map<string, { term: { rows: number } }> } } }).__qterm.registry.entries.get(id)!.term.rows, pane);
  await expect.poll(share).toBeLessThan(0.6);
  const rowsBefore = await rows();

  await qterm.pane(pane).getByRole("textbox", { name: "Terminal input" }).focus();
  await page.keyboard.press("F11");
  await expect.poll(share).toBeGreaterThan(0.95);
  // The terminal grew with it.
  await expect.poll(rows).toBeGreaterThan(rowsBefore * 1.5);

  await page.keyboard.press("F11");
  await expect.poll(share).toBeLessThan(0.6);
  await expect.poll(rows).toBe(rowsBefore);
});
