import { describe, expect, it } from "vitest";
import { agentStatusDetail, agentStatusLabel, hookObservation, inferredStatus, resolveObservation, tabAgentStatus } from "./status";

describe("agent activity inference", () => {
  it("never reports idle just because a running process is quiet", () => {
    expect(inferredStatus(1000, 2000, 2500)).toBe("busy");
    expect(inferredStatus(1000, 3500, 2500)).toBe("unknown");
    expect(inferredStatus(0, 1000, 2500)).toBe("unknown");
    expect(inferredStatus(5000, 1000, 2500)).toBe("unknown");
  });

  it("does not present a mixed tab with an unobserved agent as idle", () => {
    expect(tabAgentStatus(["idle", "unknown"])).toBe("unknown");
    expect(tabAgentStatus(["idle", "unknown", "busy"])).toBe("busy");
    expect(tabAgentStatus([undefined, "idle"])).toBe("idle");
    expect(tabAgentStatus([undefined])).toBeUndefined();
  });

  it("explains the limits of inferred and observed status", () => {
    expect(agentStatusLabel("Codex", "unknown")).toBe("Codex status unknown");
    expect(agentStatusLabel("Claude", "idle")).toBe("Claude is idle");
    expect(agentStatusDetail("busy")).toContain("suggests activity");
    expect(agentStatusDetail("busy", true)).toContain("lifecycle event");
    expect(agentStatusDetail("unknown")).toContain("Silence does not mean");
  });

  it("keeps waiting and completed states until another input is submitted", () => {
    const waiting = hookObservation("waiting", "permission", 2, "session", 1000);
    expect(resolveObservation(waiting, 2, 0, 5000, 2000).state).toBe("waiting");
    expect(resolveObservation(waiting, 3, 0, 5000, 2000).state).toBe("unknown");
    const completed = hookObservation("completed", "Stop", 4, "session", 1000);
    expect(resolveObservation(completed, 4, 0, 5000, 2000).state).toBe("completed");
    expect(resolveObservation(completed, 5, 4900, 5000, 2000).state).toBe("busy");
    expect(tabAgentStatus(["completed", "waiting", "busy"])).toBe("waiting");
  });

  it("degrades old busy events to unknown and retains their source and time", () => {
    const busy = hookObservation("busy", "activity", 1, "session", 1000);
    const stale = resolveObservation(busy, 1, 0, 601_000, 2000);
    expect(stale.state).toBe("unknown");
    expect(stale.source).toBe("hook");
    expect(stale.updatedAt).toBe(1000);
    expect(stale.reason).toContain("ten minutes");
  });
  it("distinguishes approval routing from waiting for a person's answer", () => {
    const approval = hookObservation("approval", "PermissionRequest", 0, "session", 1000);
    expect(agentStatusLabel("Codex", resolveObservation(approval, 0, 0, 1001, 2000).state)).toBe("Codex approval check (input not confirmed)");
    expect(resolveObservation(approval, 0, 0, 61_000, 2000).state).toBe("unknown");
    expect(resolveObservation(approval, 1, 0, 1001, 2000).state).toBe("unknown");
  });
});
