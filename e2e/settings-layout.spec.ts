// Risk R19 (e2e/README.md): every setting stays inside its group's box in the Settings
// panel (long paths wrap, groups too narrow for their content get wider), and the
// groups don't overlap.
import { expect, test } from "./qterm";

test("every setting stays inside its group, and groups don't overlap", async ({ qterm }) => {
  await qterm.waitForPrompt(await qterm.activePane());
  await qterm.page.getByRole("button", { name: "Settings" }).click();
  const settings = qterm.page.getByRole("dialog", { name: "Settings" });
  // The settings file's path is the longest unbroken text in the panel.
  await expect(settings.getByText("config.toml", { exact: false }).first()).toBeVisible();

  const problems = await settings.evaluate((panel) => {
    const found: string[] = [];
    const groups = [...panel.querySelectorAll<HTMLElement>("fieldset")].filter((g) => !g.hidden);
    const boxes = groups.map((g) => ({ name: g.querySelector("legend")?.textContent ?? "?", box: g.getBoundingClientRect() }));
    for (const { name, box } of boxes) {
      const group = groups[boxes.findIndex((b) => b.name === name)];
      for (const el of group.querySelectorAll<HTMLElement>("*")) {
        const r = el.getBoundingClientRect();
        const label = `${name}: "${(el.textContent ?? "").slice(0, 40)}"`;
        if (r.width > 0 && r.right > box.right + 1) found.push(`${label} sticks out by ${Math.round(r.right - box.right)}px`);
        // Text wider than its own box spills over even when the box fits (inputs scroll theirs).
        if (!["INPUT", "SELECT", "TEXTAREA"].includes(el.tagName) && el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0) {
          found.push(`${label} overflows its box by ${el.scrollWidth - el.clientWidth}px`);
        }
      }
    }
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const [a, b] = [boxes[i].box, boxes[j].box];
        if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) found.push(`${boxes[i].name} overlaps ${boxes[j].name}`);
      }
    }
    return found;
  });
  expect(problems).toEqual([]);
});
