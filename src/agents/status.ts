/** "idle" is reserved for a provider lifecycle event, never inferred from silence. */
export type AgentStatus = "busy" | "approval" | "waiting" | "completed" | "failed" | "idle" | "unknown";

export interface AgentObservation {
  state: AgentStatus;
  source: "hook" | "output" | "process";
  updatedAt: number;
  submissionRevision: number;
  event?: string;
  sessionId?: string | null;
  reason?: string;
}

/** Provider events are invalidated by a later submitted input, not by quiet output. */
export function hookObservation(state: AgentStatus, event: string, submissionRevision: number, sessionId?: string | null, now = Date.now()): AgentObservation {
  return { state, event, source: "hook", updatedAt: now, submissionRevision, sessionId };
}

export function resolveObservation(observed: AgentObservation | undefined, submissionRevision: number, lastOutput: number, now: number, recentMs: number): AgentObservation {
  if (observed && observed.state !== "unknown" && observed.submissionRevision === submissionRevision) {
    if (observed.state === "approval" && now - observed.updatedAt >= 60_000) return { ...observed, state: "unknown", reason: "Approval routing was reported, but no user prompt was confirmed." };
    if (observed.state !== "busy" || now - observed.updatedAt < 10 * 60_000) return observed;
    return { ...observed, state: "unknown", reason: "No new lifecycle event for more than ten minutes." };
  }
  const state = inferredStatus(lastOutput, now, recentMs);
  return { state, source: state === "busy" ? "output" : "process", updatedAt: state === "busy" ? lastOutput : now, submissionRevision,
    reason: observed ? observed.submissionRevision !== submissionRevision ? "Input was submitted after the last lifecycle event." : "The session started without reporting turn activity." : undefined };
}

export function inferredStatus(lastOutput: number, now: number, recentMs: number): AgentStatus {
  return lastOutput > 0 && now >= lastOutput && now - lastOutput < recentMs ? "busy" : "unknown";
}

/** A tab summarizes all its agent panes. Unknown takes precedence over known idle. */
export function tabAgentStatus(states: readonly (AgentStatus | undefined)[]): AgentStatus | undefined {
  return (["waiting", "failed", "approval", "busy", "unknown", "completed", "idle"] as const).find((state) => states.includes(state));
}

export function agentStateText(state: AgentStatus): string {
  return { busy: "Working", approval: "Approval check (input not confirmed)", waiting: "Waiting for input", completed: "Turn completed", failed: "Turn failed", idle: "Idle", unknown: "Status unknown" }[state];
}

export function agentStatusLabel(provider: string, state: AgentStatus): string {
  return `${provider} ${{ unknown: "status unknown", approval: "approval check (input not confirmed)", busy: "is working", idle: "is idle", waiting: "is waiting for input", completed: "turn completed", failed: "turn failed" }[state]}`;
}

export function agentStatusDetail(state: AgentStatus, observed = false): string {
  if (state === "approval") return "Codex requested an approval check. Hooks or automatic review may handle it; qterm has not confirmed a question for you.";
  if (state === "unknown") return "qterm cannot confirm the agent's current activity. Silence does not mean it is idle.";
  if (state === "idle") return "The last provider lifecycle event reported an idle session.";
  if (state === "waiting") return "A provider hook reported that input or permission is needed.";
  if (state === "completed") return "The provider reported that its turn completed; this does not establish that the changes passed checks.";
  if (state === "failed") return "A provider hook reported that the turn stopped with an error.";
  return observed ? "The last provider lifecycle event reported work in progress." : "Recent terminal output suggests activity; qterm cannot confirm the current turn state.";
}

export function observationDetail(observation: AgentObservation | undefined, state: AgentStatus): string {
  const detail = agentStatusDetail(state, observation?.source === "hook");
  return [detail, observation && `${observation.source === "hook" ? `Hook: ${observation.event}` : observation.source === "output" ? "Terminal output" : "Process scan"} · ${new Date(observation.updatedAt).toLocaleString()}`, observation?.reason].filter(Boolean).join("\n");
}
