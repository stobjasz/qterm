import { useCallback, useEffect, useState } from "react";
import { agentInboxAction, agentInboxSnapshot, onAgentInboxChanged, type AgentInboxAction, type AgentInboxSnapshot } from "../ipc";

export function useAgentInbox() {
  const [snapshot, setSnapshot] = useState<AgentInboxSnapshot>({ revision: -1, runId: "", events: [], error: null, recoveryRequired: false, backupPath: null });
  const [transportError, setTransportError] = useState<string>();
  const accept = useCallback((next: AgentInboxSnapshot) => {
    setSnapshot((current) => next.revision >= current.revision ? next : current);
    setTransportError(undefined);
  }, []);
  useEffect(() => {
    let active = true;
    // Subscribe before reading, so initial loading cannot miss a delivered hook.
    const listener = onAgentInboxChanged((next) => active && accept(next));
    void listener.then(() => agentInboxSnapshot()).then((next) => active && accept(next)).catch((e) => active && setTransportError(String(e)));
    return () => { active = false; void listener.then((stop) => stop()); };
  }, [accept]);
  const act = useCallback(async (action: AgentInboxAction, ids: string[] = []) => {
    try { const next = await agentInboxAction(action, ids); accept(next); return next; }
    catch (e) { setTransportError(String(e)); throw e; }
  }, [accept]);
  const flush = useCallback(async () => {
    // Read native state even if its latest event has not reached React yet.
    const next = await act("retry");
    if (next.error) throw new Error(next.error);
  }, [act]);
  return { snapshot, act, flush, error: transportError ?? snapshot.error };
}
