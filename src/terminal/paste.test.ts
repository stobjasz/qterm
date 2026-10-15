import { describe, expect, it } from "vitest";

import { isMultiLine, pastedLines } from "./paste";

describe("pastedLines", () => {
  it("splits on any line break, ignoring one at the end", () => {
    expect(pastedLines("git add .\r\ngit commit\nrm -rf build\r")).toEqual(["git add .", "git commit", "rm -rf build"]);
    expect(pastedLines("ls\n")).toEqual(["ls"]);
    expect(pastedLines("")).toEqual([""]);
  });

  it("counts a paste with a blank line in the middle as several lines", () => {
    expect(isMultiLine("echo a\n\n")).toBe(true);
    expect(isMultiLine("echo a\n")).toBe(false);
    expect(isMultiLine("echo a")).toBe(false);
  });
});
