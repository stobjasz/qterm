import { expect, it } from "vitest";
import type { CodexUsage } from "../ipc";
import { contextPercent, planSummary, usageSummary } from "./usage";

const usage: CodexUsage = { sessionId: "s", model: "example-model", contextTokens: 50_000, contextLimit: 100_000, outputTokens: 1234, title: null, rateLimits: { primary: { used_percent: 81, window_minutes: 300 }, secondary: { used_percent: 20, window_minutes: 10080 } } };
it("shows reported context and plan windows without billing estimates", () => {
  expect(contextPercent(usage)).toBe(50);
  expect(planSummary(usage)).toBe("5-hour 81% · 7-day 20%");
  expect(usageSummary(usage)).toBe("example-model · context 50k of 100k (50%) · 1k output tokens · 5-hour 81% · 7-day 20%");
});
it("omits unavailable limits and handles rate-limit-only records", () => {
  expect(contextPercent({ ...usage, contextLimit: null })).toBeUndefined();
  expect(planSummary({ ...usage, rateLimits: null })).toBe("");
  expect(planSummary({ ...usage, rateLimits: { primary: null } })).toBe("");
});
