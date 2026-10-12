// Risk R6 (e2e/README.md): a shell with its own background shows it in its panes, at
// the console's opacity, while the other panes keep the theme's
// (config.toml [[profiles]] → Rust → the UI's pane painting).
import { expect, test } from "./qterm";

test.use({
  settings: {
    extra: ['[[profiles]]', 'name = "Deep"', "command = 'pwsh -NoLogo'", 'background = "#203040"'].join("\n"),
  },
});

test("a shell with its own background paints its panes in it, others keep the theme's", async ({ qterm }) => {
  const first = await qterm.activePane();
  await qterm.waitForPrompt(first);
  const paneColor = (paneId: string) => qterm.pane(paneId).evaluate((el) => getComputedStyle(el).backgroundColor);
  // The theme's background at the console's opacity, as the console paints it.
  const themeColor = await qterm.page.getByRole("tablist", { name: "Terminal tabs" }).evaluate((el) => {
    const probe = document.createElement("div");
    probe.style.background = getComputedStyle(el).getPropertyValue("--console-bg");
    el.append(probe);
    const color = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return color;
  });

  // Open the "Deep" shell from the profile menu.
  await qterm.page.getByRole("button", { name: "Choose profile" }).click();
  await qterm.page.getByRole("menuitem", { name: "Deep" }).click();
  await expect(qterm.page.getByRole("tab")).toHaveCount(2);
  await expect.poll(() => qterm.activePane()).not.toBe(first);
  const deep = await qterm.activePane();
  await qterm.waitForPrompt(deep);

  // Its pane has its own colour, at the default opacity (0.82)...
  await expect.poll(() => paneColor(deep)).toBe("rgba(32, 48, 64, 0.82)");
  // ...and the first pane still has the theme's.
  expect(await paneColor(first)).toBe(themeColor);
});
