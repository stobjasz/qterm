import { describe, expect, it } from "vitest";

import { excerpt, findInLines } from "./searchAll";

const plain = { caseSensitive: false, regex: false };

describe("search across panes", () => {
  it("finds every match with its position", () => {
    expect(findInLines(["error here", "no", "Error and ERROR"], "error", plain)).toEqual([
      { line: 0, col: 0, length: 5 },
      { line: 2, col: 0, length: 5 },
      { line: 2, col: 10, length: 5 },
    ]);
  });

  it("can match case and regular expressions", () => {
    expect(findInLines(["Error error"], "error", { ...plain, caseSensitive: true })).toEqual([{ line: 0, col: 6, length: 5 }]);
    expect(findInLines(["exit 3", "exit 12"], "exit \\d+", { ...plain, regex: true }).map((m) => m.length)).toEqual([6, 7]);
    expect(findInLines(["a.b axb"], "a.b", plain)).toEqual([{ line: 0, col: 0, length: 3 }]);
    expect(findInLines(["abc"], "(", { ...plain, regex: true })).toEqual([]);
    expect(findInLines(["abc"], "x*", { ...plain, regex: true })).toEqual([]);
    expect(findInLines(["abc"], "", plain)).toEqual([]);
  });

  it("shortens long lines around the match", () => {
    const text = `${"a".repeat(200)}NEEDLE${"b".repeat(200)}`;
    const cut = excerpt(text, { line: 0, col: 200, length: 6 }, 40);
    expect(cut.hit).toBe("NEEDLE");
    expect(cut.before.startsWith("…")).toBe(true);
    expect(cut.after.endsWith("…")).toBe(true);
    expect((cut.before + cut.hit + cut.after).length).toBeLessThanOrEqual(42);
    expect(excerpt("short hit", { line: 0, col: 6, length: 3 })).toEqual({ before: "short ", hit: "hit", after: "" });
  });
});
