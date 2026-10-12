import { describe, expect, it } from "vitest";

import { formatDuration, parseMark } from "./marks";

describe("command marks", () => {
  it("reads OSC 133 payloads", () => {
    expect(parseMark("A")).toEqual({ kind: "A" });
    expect(parseMark("B")).toEqual({ kind: "B" });
    expect(parseMark("D;0")).toEqual({ kind: "D", exitCode: 0 });
    expect(parseMark("D;127")).toEqual({ kind: "D", exitCode: 127 });
    expect(parseMark("D")).toEqual({ kind: "D", exitCode: undefined });
    expect(parseMark("D;")).toEqual({ kind: "D", exitCode: undefined });
    expect(parseMark("D;x")).toEqual({ kind: "D", exitCode: undefined });
    expect(parseMark("P;k=v")).toBeUndefined();
  });

  it("formats durations", () => {
    expect(formatDuration(4_400)).toBe("4s");
    expect(formatDuration(123_000)).toBe("2m 03s");
    expect(formatDuration(3_725_000)).toBe("1h 02m");
  });
});
