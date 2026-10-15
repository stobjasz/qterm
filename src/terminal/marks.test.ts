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
    // In whatever locale runs the tests (14:32 or 2:32 PM).
    const time = (d: Date, second?: "2-digit") => d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second });
    const now = new Date(2026, 9, 15, 16, 0, 0).getTime();
    const today = new Date(2026, 9, 15, 14, 32, 5);
    expect(formatClock(today.getTime(), now)).toBe(time(today));
    expect(formatClock(today.getTime(), now, true)).toBe(time(today, "2-digit"));
    const tuesday = new Date(2026, 9, 13, 9, 5);
    expect(formatClock(tuesday.getTime(), now)).toBe(`${tuesday.toLocaleDateString(undefined, { weekday: "short" })} ${time(tuesday)}`);
    const longAgo = new Date(2026, 8, 1, 9, 5);
    expect(formatClock(longAgo.getTime(), now)).toBe(longAgo.toLocaleDateString(undefined, { month: "short", day: "numeric" }));
  });
});
