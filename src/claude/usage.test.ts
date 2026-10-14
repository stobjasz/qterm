import { describe, expect, it } from "vitest";

import type { ClaudeUsage } from "../ipc";
import { contextPercent, formatCost, formatTokens, modelName, usageSummary } from "./usage";

const usage: ClaudeUsage = {
  sessionId: "s",
  model: "claude-opus-5-5",
  contextTokens: 443_877,
  contextLimit: 1_000_000,
  costUsd: 12.3456,
  costComplete: true,
  outputTokens: 1000,
  requests: 312,
  title: null,
};

describe("Claude usage in the tab bar", () => {
  it("names models", () => {
    expect(modelName("claude-opus-5-5")).toBe("Opus 5.5");
    expect(modelName("claude-sonnet-5")).toBe("Sonnet 5");
    expect(modelName("claude-haiku-4-5-20251001")).toBe("Haiku 4.5");
    expect(modelName("claude-fable-5-1")).toBe("Fable 5.1");
    expect(modelName("something-else")).toBe("something-else");
    expect(modelName(null)).toBe("Claude");
  });

  it("formats tokens, context and cost", () => {
    expect(formatTokens(950)).toBe("950");
    expect(formatTokens(443_877)).toBe("444k");
    expect(formatTokens(1_000_000)).toBe("1M");
    expect(formatTokens(1_250_000)).toBe("1.3M");
    expect(contextPercent(usage)).toBe(44);
    expect(contextPercent({ ...usage, contextLimit: null })).toBeUndefined();
    expect(formatCost(usage)).toBe("≈ $12");
    expect(formatCost({ ...usage, costUsd: 0.4 })).toBe("≈ $0.40");
    expect(formatCost({ ...usage, costUsd: 1234.5 })).toBe("≈ $1,235");
    expect(formatCost({ ...usage, costComplete: false, costUsd: 3 })).toBe("≥ $3.00");
    expect(formatCost({ ...usage, costUsd: null })).toBeUndefined();
  });

  it("sums it up for the tooltip", () => {
    expect(usageSummary(usage)).toBe("Opus 5.5 · context 444k of 1M (44%) · ≈ $12 at API prices · 312 requests");
    expect(usageSummary({ ...usage, model: "claude-next", contextLimit: null, costUsd: null, requests: 1 })).toBe("claude-next · context 444k · 1 request");
  });
});
