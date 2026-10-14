import { describe, expect, it } from "vitest";

import { matches, queryWords } from "./filter";

describe("settings search", () => {
  it("needs every word, in the setting or its group's title, ignoring case and accents", () => {
    const words = queryWords("  Font   SIZE ");
    expect(words).toEqual(["font", "size"]);
    expect(matches(words, "Font size 14", "Appearance")).toBe(true);
    expect(matches(words, "Font family", "Appearance")).toBe(false);
    expect(matches(queryWords("appearance opacity"), "Background opacity 82%", "Appearance")).toBe(true);
    expect(matches(queryWords("cafe"), "Café mode")).toBe(true);
  });

  it("shows everything for an empty search", () => {
    expect(matches(queryWords("   "), "anything")).toBe(true);
  });
});
