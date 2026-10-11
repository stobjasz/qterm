import { describe, expect, it } from "vitest";

import { findResumeIds } from "./detect";

const ID = "4c766d1a-f139-42df-90f0-a04fe20d3056";

describe("findResumeIds", () => {
  it("finds the id in Claude Code's exit hint", () => {
    expect(findResumeIds(`Resume this session with:\nclaude --resume ${ID}\n`)).toEqual([ID]);
  });

  it("accepts -r, extra spaces and upper case", () => {
    expect(findResumeIds(`claude   -r  ${ID.toUpperCase()}`)).toEqual([ID]);
  });

  it("finds several and drops duplicates", () => {
    const other = "0b62fa9b-7001-4bed-a5e0-7d951d9700b1";
    expect(findResumeIds(`claude --resume ${ID}\nclaude --resume ${other}\nclaude --resume ${ID}`)).toEqual([
      ID,
      other,
    ]);
  });

  it("ignores ids that aren't after a resume flag, and malformed ids", () => {
    expect(findResumeIds(`session ${ID}`)).toEqual([]);
    expect(findResumeIds("claude --resume 4c766d1a-f139-42df-90f0")).toEqual([]);
    expect(findResumeIds(`claude --resume ${ID}0`)).toEqual([]);
  });
});
