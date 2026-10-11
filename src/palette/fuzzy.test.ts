import { describe, expect, it } from "vitest";

import { fuzzyMatch, rank } from "./fuzzy";

describe("fuzzyMatch", () => {
  it("needs every query letter in order, ignoring case", () => {
    expect(fuzzyMatch("spr", "Split pane right")).toBeDefined();
    expect(fuzzyMatch("rps", "Split pane right")).toBeUndefined();
    expect(fuzzyMatch("TAB", "new tab")).toBeDefined();
  });

  it("reports which letters matched, for highlighting", () => {
    expect(fuzzyMatch("nt", "New tab")!.indices).toEqual([0, 4]);
  });

  it("matches everything with an empty query", () => {
    expect(fuzzyMatch("", "anything")).toEqual({ score: 0, indices: [] });
  });
});

describe("rank", () => {
  const items = ["Close pane", "Split pane right", "Split pane down", "Swap pane right", "Settings"];

  it("puts word-start and consecutive matches first", () => {
    // Both are perfect initial-letter matches; either may come first.
    expect(rank(items, (s) => s, "spr").slice(0, 2).sort()).toEqual(["Split pane right", "Swap pane right"]);
    expect(rank(items, (s) => s, "set")[0]).toBe("Settings");
  });

  it("drops non-matches and keeps the original order for an empty query", () => {
    expect(rank(items, (s) => s, "zzz")).toEqual([]);
    expect(rank(items, (s) => s, "")).toEqual(items);
  });

  it("prefers a contiguous word over scattered letters", () => {
    expect(rank(["Show tab bar", "Swap pane down"], (s) => s, "swap")[0]).toBe("Swap pane down");
  });
});
