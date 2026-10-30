import { useCallback, useEffect, useState } from "react";
import { agentAccessSnapshot, grantAgentAccess, revokeAgentAccess, onAgentAccessChanged, type AgentAccessSnapshot } from "../ipc";

export function useAgentAccess() {
  const [snapshot, setSnapshot] = useState<AgentAccessSnapshot>({ grants: [], listening: false, revision: -1, executable: "", invocations: [] });
  const [error, setError] = useState<string>();
  const accept = useCallback((value: AgentAccessSnapshot) => { setSnapshot((current) => value.revision >= current.revision ? value : current); setError(undefined); return value; }, []);
  useEffect(() => {
    let active = true;
    const listener = onAgentAccessChanged((value) => active && accept(value));
    void listener.then(() => agentAccessSnapshot()).then((value) => active && accept(value)).catch((e) => active && setError(String(e)));
    return () => { active = false; void listener.then((stop) => stop()).catch(() => {}); };
  }, [accept]);
  const grant = useCallback(async (review: string, client: string, taskIds: string[] = []) => accept(await grantAgentAccess(review, client, taskIds)), [accept]);
  const revoke = useCallback(async (id: string) => accept(await revokeAgentAccess(id)), [accept]);
  useEffect(() => {
    if (!snapshot.grants.length) return;
    let active = true;
    const timer = window.setInterval(() => void agentAccessSnapshot().then((value) => active && accept(value), (e) => active && setError(String(e))), 5000);
    return () => { active = false; window.clearInterval(timer); };
  }, [snapshot.grants.length, accept]);
  return { snapshot, grant, revoke, error };
}
