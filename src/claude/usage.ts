// How a Claude session's token use reads in the tab bar and the ✳ menu.
import type { ClaudeUsage } from "../ipc";

/** "claude-opus-5-5" → "Opus 5.5", "claude-haiku-4-5-20251001" → "Haiku 4.5". */
export function modelName(id: string | null): string {
  const m = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-|$)/.exec(id ?? "");
  if (!m) return id ?? "Claude";
  const family = m[1][0].toUpperCase() + m[1].slice(1);
  return `${family} ${m[2]}${m[3] ? `.${m[3]}` : ""}`;
}

/** 950 → "950", 12_400 → "12k", 1_250_000 → "1.3M". */
export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  return `${(n / 1_000_000).toFixed(n < 10_000_000 ? 1 : 0).replace(/\.0$/, "")}M`;
}

/** How full the context is, 0-100; undefined when the window size isn't known. */
export function contextPercent(usage: ClaudeUsage): number | undefined {
  if (!usage.contextLimit) return undefined;
  return Math.min(100, Math.round((usage.contextTokens / usage.contextLimit) * 100));
}

export function formatCost(usage: ClaudeUsage): string | undefined {
  if (usage.costUsd === null) return undefined;
  const dollars = usage.costUsd < 10 ? usage.costUsd.toFixed(2) : Math.round(usage.costUsd).toLocaleString("en-US");
  return `${usage.costComplete ? "≈" : "≥"} $${dollars}`;
}

/** "Opus 5.5 · context 444k of 1M (44%) · ≈ $12.34 at API prices · 312 requests" */
export function usageSummary(usage: ClaudeUsage): string {
  const percent = contextPercent(usage);
  const context = usage.contextLimit
    ? `context ${formatTokens(usage.contextTokens)} of ${formatTokens(usage.contextLimit)} (${percent}%)`
    : `context ${formatTokens(usage.contextTokens)}`;
  const cost = formatCost(usage);
  return [
    modelName(usage.model),
    context,
    cost && `${cost} at API prices${usage.costComplete ? "" : " (some models unpriced)"}`,
    `${usage.requests} request${usage.requests === 1 ? "" : "s"}`,
  ]
    .filter(Boolean)
    .join(" · ");
}
