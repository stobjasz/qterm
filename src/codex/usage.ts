import type { CodexUsage } from "../ipc";
export { formatTokens } from "../claude/usage";
import { formatTokens } from "../claude/usage";

export const modelName = (model: string | null) => model ?? "Codex";
export function contextPercent(usage: CodexUsage): number | undefined {
  return usage.contextLimit ? Math.min(100, Math.round(100 * usage.contextTokens / usage.contextLimit)) : undefined;
}
export function planSummary(usage: CodexUsage): string {
  return [usage.rateLimits?.primary, usage.rateLimits?.secondary].flatMap((limit) => {
    if (!limit || !Number.isFinite(limit.used_percent)) return [];
    const minutes = limit.window_minutes;
    const window = minutes ? minutes >= 1440 ? `${minutes / 1440}-day` : `${minutes / 60}-hour` : "Plan";
    const reset = limit.resets_at ? ` (resets ${new Date(limit.resets_at * 1000).toLocaleString()})` : "";
    return [`${window} ${Math.round(limit.used_percent)}%${reset}`];
  }).join(" · ");
}
export function usageSummary(usage: CodexUsage): string {
  const percent = contextPercent(usage);
  return [modelName(usage.model), `context ${formatTokens(usage.contextTokens)}${percent === undefined ? "" : ` of ${formatTokens(usage.contextLimit!)} (${percent}%)`}`,
    `${formatTokens(usage.outputTokens)} output tokens`, planSummary(usage)].filter(Boolean).join(" · ");
}
