// Claude plan usage (5-hour and 7-day windows) and exact session figures, from
// Claude Code's status line relayed to qterm (claude_statusline.rs).

import type { ClaudeUsage, PlanLimit, StatuslineUsage } from "../ipc";

export interface PlanUsage {
  fiveHour?: PlanLimit;
  sevenDay?: PlanLimit;
}

export const PLAN_WARNINGS = [95, 80] as const;

/** "14:30" today, "Mon 14:30" within a week, else the date. */
export function formatReset(epochSeconds: number, now: Date): string {
  const at = new Date(epochSeconds * 1000);
  const time = at.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  if (at.toDateString() === now.toDateString()) return time;
  const days = (at.getTime() - now.getTime()) / 86_400_000;
  if (days > 0 && days < 7) return `${at.toLocaleDateString(undefined, { weekday: "short" })} ${time}`;
  return at.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function window(name: string, limit: PlanLimit | undefined, now: Date): string | undefined {
  if (!limit) return undefined;
  const reset = limit.resetsAt ? ` (resets ${formatReset(limit.resetsAt, now)})` : "";
  return `${name} ${Math.round(limit.usedPercent)}%${reset}`;
}

/** "5-hour 23% (resets 14:30) · 7-day 41% (resets Mon 09:00)"; undefined when unknown. */
export function planSummary(plan: PlanUsage | undefined, now: Date): string | undefined {
  const parts = [window("5-hour", plan?.fiveHour, now), window("7-day", plan?.sevenDay, now)].filter(Boolean);
  return parts.length ? parts.join(" · ") : undefined;
}

/** The highest warning level reached by going from `before` to `after` percent, if any. */
export function crossedWarning(before: number | undefined, after: number): number | undefined {
  return PLAN_WARNINGS.find((level) => after >= level && (before === undefined || before < level));
}

/** The tab's usage with Claude Code's own figures (status line) where it has them. */
export function mergeUsage(transcript: ClaudeUsage | undefined, line: StatuslineUsage | undefined): ClaudeUsage | undefined {
  if (!line) return transcript;
  const base: ClaudeUsage = transcript ?? {
    sessionId: line.sessionId ?? "",
    model: null,
    contextTokens: 0,
    contextLimit: null,
    costUsd: null,
    costComplete: true,
    outputTokens: 0,
    requests: 0,
    title: null,
  };
  return {
    ...base,
    model: line.modelId ?? base.model,
    contextTokens: line.contextTokens ?? base.contextTokens,
    contextLimit: line.contextLimit ?? base.contextLimit,
    ...(line.costUsd !== null && line.costUsd !== undefined ? { costUsd: line.costUsd, costComplete: true } : {}),
  };
}
