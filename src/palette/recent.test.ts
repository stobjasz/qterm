import { describe, expect, it } from "vitest";

import { emptyQueryOrder, MAX_RECENT, remember } from "./recent";

const items = [
  { id: "action:split", group: "Action" },
  { id: "action:find", group: "Action" },
  { id: "admin:pwsh", group: "New admin tab" },
  { id: "theme:nord", group: "Theme" },
  { id: "tab:t1", group: "Tab" },
];

describe("the palette with nothing typed", () => {
  it("puts recent entries first and leaves the long lists for when you type", () => {
    expect(emptyQueryOrder(items, ["action:find", "theme:nord", "gone"]).map((i) => i.id)).toEqual([
      "action:find",
      "theme:nord", // a recent one shows even from a search-only group
      "action:split",
      "tab:t1",
    ]);
  });

  it("remembers the latest first, each once, a few of them", () => {
    let recent: string[] = [];
    for (let i = 0; i < MAX_RECENT + 3; i++) recent = remember(recent, `a${i}`);
    recent = remember(recent, "a5");
    expect(recent[0]).toBe("a5");
    expect(recent).toHaveLength(MAX_RECENT);
    expect(new Set(recent).size).toBe(MAX_RECENT);
  });
});
