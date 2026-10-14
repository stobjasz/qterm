// Risk R16 (e2e/README.md): searching Settings shows the matching settings and hides
// the rest, and Esc clears the search before it closes the panel.
import { expect, test } from "./qterm";

test("searching settings shows what matches and hides the rest", async ({ qterm }) => {
  await qterm.waitForPrompt(await qterm.activePane());
  await qterm.page.getByRole("button", { name: "Settings" }).click();
  const settings = qterm.page.getByRole("dialog", { name: "Settings" });
  const search = settings.getByRole("searchbox", { name: "Search settings" });
  const fontSize = settings.getByRole("spinbutton", { name: "Font size" });
  const hotkey = settings.getByRole("combobox", { name: "Hotkey" });
  await expect(fontSize).toBeVisible();
  await expect(hotkey).toBeVisible();

  await search.fill("font size");
  await expect(fontSize).toBeVisible();
  await expect(hotkey).toBeHidden();
  // A shortcut row matches by its action's name.
  await search.fill("split right");
  await expect(settings.getByText("Split right", { exact: true })).toBeVisible();
  await expect(fontSize).toBeHidden();

  await search.fill("nothing-like-this");
  await expect(settings.getByText("No setting matches “nothing-like-this”.")).toBeVisible();

  // Esc: first the search, then the panel.
  await search.press("Escape");
  await expect(search).toHaveValue("");
  await expect(hotkey).toBeVisible();
  await search.press("Escape");
  await expect(settings).toBeHidden();
});
