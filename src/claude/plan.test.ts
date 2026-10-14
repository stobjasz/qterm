import { describe, expect, it } from "vitest";

import type { ClaudeUsage, StatuslineUsage } from "../ipc";
import { crossedWarning, formatReset, mergeUsage, planSummary } from "./plan";

const now = new Date(2026, 9, 14, 10, 0); // Wed 14 Oct 2026, 10:00 local
const at = (d: Date) => Math.floor(d.getTime() / 1000);

describe("plan usage", () => {
  it("names the reset time: the time today, the weekday within a week", () => {
    expect(formatReset(at(new Date(2026, 9, 14, 14, 30)), now)).toMatch(/14.30|2.30/);
    expect(formatReset(at(new Date(2026, 9, 19, 9, 0)), now)).toMatch(/^\S+ /);
  });

  it("summarizes both windows, or says nothing when unknown", () => {
    const summary = planSummary({ fiveHour: { usedPercent: 23.4, resetsAt: at(new Date(2026, 9, 14, 14, 30)) }, sevenDay: { usedPercent: 41, resetsAt: null } }, now);
    expect(summary).toMatch(/^5-hour 23% \(resets .+\) · 7-day 41%$/);
    expect(planSummary(undefined, now)).toBeUndefined();
    expect(planSummary({}, now)).toBeUndefined();
  });

  it("warns once per level when usage crosses 80% and 95%", () => {
    expect(crossedWarning(70, 81)).toBe(80);
    expect(crossedWarning(81, 85)).toBeUndefined();
    expect(crossedWarning(85, 96)).toBe(95);
    expect(crossedWarning(undefined, 97)).toBe(95);
    expect(crossedWarning(undefined, 50)).toBeUndefined();
  });
});

describe("exact usage from the status line", () => {
  const line: StatuslineUsage = {
    paneId: "p",
    sessionId: "s",
    modelId: "claude-opus-5-5",
    modelName: "Opus 5.5",
    contextTokens: 52_000,
    contextLimit: 1_000_000,
    contextPercent: 5.2,
    costUsd: 1.25,
    fiveHour: null,
    sevenDay: null,
    cache: null,
  };
  const transcript: ClaudeUsage = {
    sessionId: "s",
    model: "claude-opus-5",
    contextTokens: 40_000,
    contextLimit: 1_000_000,
    costUsd: 0.9,
    costComplete: false,
    outputTokens: 900,
    requests: 12,
    title: "Fix login",
  };

  it("takes Claude Code's figures over the transcript estimate, keeping the rest", () => {
    expect(mergeUsage(transcript, line)).toEqual({ ...transcript, model: "claude-opus-5-5", contextTokens: 52_000, costUsd: 1.25, costComplete: true });
    expect(mergeUsage(transcript, undefined)).toBe(transcript);
  });

  it("works from the status line alone", () => {
    expect(mergeUsage(undefined, line)).toMatchObject({ sessionId: "s", model: "claude-opus-5-5", contextTokens: 52_000, costUsd: 1.25 });
  });
});
