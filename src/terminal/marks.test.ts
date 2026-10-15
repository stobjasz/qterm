import { describe, expect, it } from "vitest";

import { formatClock, formatDuration, parseMark } from "./marks";

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
    expect(formatDuration(420)).toBe("0.4s");
    expect(formatDuration(0)).toBe("0.0s");
    expect(formatDuration(960)).toBe("1s");
  });

  it("says when: the time today, the weekday this week, else the date", () => {
    const now = new Date(2026, 9, 15, 16, 0, 0).getTime();
    const today = new Date(2026, 9, 15, 14, 32, 5).getTime();
    expect(formatClock(today, now)).toMatch(/14.32$/);
    expect(formatClock(today, now, true)).toMatch(/14.32.05$/);
    expect(formatClock(new Date(2026, 9, 13, 9, 5).getTime(), now)).toMatch(/^\S+ 09.05$/);
    expect(formatClock(new Date(2026, 8, 1, 9, 5).getTime(), now)).not.toMatch(/09.05/);
  });
});
