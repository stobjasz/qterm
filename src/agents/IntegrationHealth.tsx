import { useCallback, useEffect, useRef, useState } from "react";
import { agentIntegrationHealth, testAgentDelivery, type AgentIntegrationHealth, type AgentProvider } from "../ipc";

/** Mounted only with Settings; configuration and actual local delivery are separate. */
export function IntegrationHealth({ provider, paneLabel }: { provider: AgentProvider; paneLabel(id: string): string | undefined }) {
  const name = provider === "codex" ? "Codex" : "Claude";
  const [health, setHealth] = useState<AgentIntegrationHealth>();
  const [error, setError] = useState<string>();
  const [testing, setTesting] = useState(false);
  const mounted = useRef(false);
  const testingRef = useRef(false);
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    if (testingRef.current) return;
    const request = ++generation.current;
    try {
      const result = await agentIntegrationHealth(provider);
      if (mounted.current && !testingRef.current && request === generation.current) { setHealth(result); setError(undefined); }
    } catch (e) { if (mounted.current && request === generation.current) setError(String(e)); }
  }, [provider]);
  useEffect(() => {
    mounted.current = true;
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5000);
    return () => { mounted.current = false; generation.current++; window.clearInterval(timer); };
  }, [refresh]);
  const test = async () => {
    testingRef.current = true; generation.current++; setTesting(true); setError(undefined);
    try {
      const result = await testAgentDelivery(provider);
      if (mounted.current) setHealth(result);
    } catch (e) { if (mounted.current) setError(String(e)); }
    finally { testingRef.current = false; if (mounted.current) setTesting(false); }
  };
  const event = health?.lastEvent;
  const label = event ? paneLabel(event.paneId) : undefined;
  return <div className="settings-field integration-health" role="region" aria-label={`${name} integration health`}>
    <span className="settings-label">Local delivery health</span>
    <span className="settings-hint">Tests qterm's hook executable, inbox and watcher. This does not verify provider hook setup or trust.</span>
    {health && <>
      <span className="settings-hint">Data folder: <code>{health.home ?? "Unavailable: check the provider home environment variable"}</code></span>
      <details><summary>Executable and inbox</summary><code>{health.executable}</code><code>{health.inbox ?? "No local inbox folder"}</code></details>
      <span className="settings-hint" aria-label={`${name} last hook event`}>
        {event ? `Last event: ${event.event} · ${new Date(event.receivedAt).toLocaleString()} · ${label ?? `Pane no longer open (${event.paneId})`}${event.sessionId ? ` · session ${event.sessionId}` : ""}` : "No provider event received since qterm started. Start a session in qterm and check its hook setup."}
      </span>
      {health.lastProbe && <span role="status" aria-label={`${name} local delivery result`}>
        {health.lastProbe.success ? "Local delivery passed" : `Local delivery failed: ${health.lastProbe.error}`} · {new Date(health.lastProbe.checkedAt).toLocaleString()}
      </span>}
    </>}
    {error && <span role="alert">Could not check local delivery: {error}</span>}
    <div className="settings-actions">
      <button className="now" aria-label={`Test ${name} local delivery`} disabled={testing} onClick={() => void test()}>{testing ? "Testing…" : `Test ${name} local delivery`}</button>
      <button disabled={testing} onClick={() => void refresh()}>Refresh {name} health</button>
    </div>
  </div>;
}
