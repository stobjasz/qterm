import { describe, expect, it } from "vitest";

import { cacheCountdown, cacheTick } from "./cache";

const now = 1_800_000_000_000;
const inSeconds = (s: number) => now / 1000 + s;

describe("cacheCountdown", () => {
  it("counts minutes, then seconds in the last minute", () => {
    expect(cacheCountdown({ warm: true, expiresAt: inSeconds(272) }, now)).toMatchObject({ text: "5m", cold: false });
    expect(cacheCountdown({ warm: true, expiresAt: inSeconds(60) }, now)?.text).toBe("1m");
    expect(cacheCountdown({ warm: true, expiresAt: inSeconds(42) }, now)).toMatchObject({ text: "42s", cold: false });
  });

  it("says cold once it expired, or when Claude Code says so", () => {
    expect(cacheCountdown({ warm: true, expiresAt: inSeconds(0) }, now)).toMatchObject({ text: "cold", cold: true });
    expect(cacheCountdown({ warm: false, expiresAt: null }, now)).toMatchObject({ text: "cold", cold: true });
  });

  it("shows nothing without a time to count down to", () => {
    expect(cacheCountdown(undefined, now)).toBeUndefined();
    expect(cacheCountdown({ warm: true, expiresAt: null }, now)).toBeUndefined();
  });

  it("redraws every second only in the last minute", () => {
    expect(cacheTick({ warm: true, expiresAt: inSeconds(30) }, now)).toBe(1000);
    expect(cacheTick({ warm: true, expiresAt: inSeconds(300) }, now)).toBe(15_000);
    expect(cacheTick({ warm: true, expiresAt: inSeconds(-5) }, now)).toBe(15_000);
  });
});
