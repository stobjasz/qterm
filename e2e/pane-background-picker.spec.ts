// Risk R7 (e2e/README.md): a background chosen for one pane (Shift+right-click) colours
// that pane only, not the other pane of the same tab, and comes back after a restart.
import { expect, test } from "./qterm";

test("a background chosen for one pane colours that pane only and survives a restart", async ({ qterm }) => {
  const left = await qterm.activePane();
  await qterm.waitForPrompt(left);
  await qterm.page.getByRole("button", { name: "Split right" }).click();
  await expect.poll(() => qterm.activePane()).not.toBe(left);
  const right = await qterm.activePane();
  await qterm.waitForPrompt(right);
  const paneColor = (paneId: string) => qterm.pane(paneId).evaluate((el) => getComputedStyle(el).backgroundColor);
  const leftBefore = await paneColor(left);

  // Shift+right-click the right pane and pick "Navy" (#14213d).
  await qterm.pane(right).click({ button: "right", modifiers: ["Shift"] });
  const menu = qterm.page.getByRole("dialog", { name: "Pane background" });
  await expect(menu).toBeVisible();
  await menu.getByRole("radio", { name: "Navy" }).click();
  await qterm.page.keyboard.press("Escape");
  await expect(menu).toBeHidden();

  // The right pane is navy at the console's opacity; the left one hasn't changed.
  await expect.poll(() => paneColor(right)).toBe("rgba(20, 33, 61, 0.82)");
  expect(await paneColor(left)).toBe(leftBefore);

  // After a restart the right pane is still navy.
  await qterm.restart();
  await expect(qterm.pane(right)).toBeVisible();
  await expect.poll(() => paneColor(right)).toBe("rgba(20, 33, 61, 0.82)");
  expect(await paneColor(left)).toBe(leftBefore);
});
