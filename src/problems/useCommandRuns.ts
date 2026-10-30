import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { commandRunsSnapshot, commandRunsAction, recordCommandRun, refreshVerification, onCommandRunsChanged, type CommandRunsSnapshot, type CommandRunsAction } from "../ipc";
import { restoreRun, type CommandRun, MAX_RUNS } from "./runs";

export function useCommandRuns() {
  const [snapshot, setSnapshot] = useState<CommandRunsSnapshot>({ runId: "", revision: -1, runs: [], error: null, recoveryRequired: false, backupPath: null });
  const [errors, setErrors] = useState<ReadonlyMap<string, string>>(new Map());
  const [refreshError, setRefreshError] = useState<string>();
  const pending = useRef(new Map<string, { run: CommandRun; ticket?: string }>());
  const inflight = useRef(new Map<string, Promise<void>>());
  const [localRevision, changed] = useState(0);
  const report = useCallback((key: string, error?: unknown) => setErrors((current) => {
    if (error === undefined && !current.has(key)) return current;
    if (error !== undefined && current.get(key) === String(error)) return current;
    const next = new Map(current); if (error === undefined) next.delete(key); else next.set(key, String(error)); return next;
  }), []);
  const accept = useCallback((value: CommandRunsSnapshot) => {
    setSnapshot((current) => value.revision >= current.revision ? value : current); report("load");
  }, [report]);
  useEffect(() => {
    let active = true;
    const listener = onCommandRunsChanged((value) => active && accept(value));
    void listener.then(() => commandRunsSnapshot()).then((value) => active && accept(value)).catch((e) => active && report("load", e));
    return () => { active = false; void listener.then((stop) => stop()).catch(() => {}); };
  }, [accept, report]);
  const send = useCallback((id: string): Promise<void> => {
    const running = inflight.current.get(id); if (running) return running;
    const item = pending.current.get(id); if (!item) return Promise.resolve();
    const operation = recordCommandRun(item.run, item.ticket).then((value) => {
      accept(value); pending.current.delete(id); changed((n) => n + 1); report(id);
    }, (e) => { report(id, e); throw e; }).finally(() => inflight.current.delete(id));
    inflight.current.set(id, operation); return operation;
  }, [accept, report]);
  const record = useCallback((run: CommandRun, ticket?: string) => {
    pending.current.set(run.id, { run: { ...run, verificationPending: !!ticket }, ticket }); changed((n) => n + 1); return send(run.id);
  }, [send]);
  const act = useCallback(async (action: CommandRunsAction) => {
    if (action === "clear") await Promise.all([...pending.current.keys()].map(send));
    try { const value = await commandRunsAction(action); accept(value); report("action"); return value; }
    catch (e) { report("action", e); throw e; }
  }, [accept, report, send]);
  const flush = useCallback(async () => {
    await Promise.all([...pending.current.keys()].map(send));
    const value = await act("retry"); if (value.error) throw new Error(value.error);
  }, [send, act]);
  const refreshing = useRef<Promise<void> | undefined>(undefined);
  const refresh = useCallback(() => {
    if (refreshing.current) return refreshing.current;
    const operation = refreshVerification().then((value) => { accept(value); setRefreshError(undefined); }, (e) => { setRefreshError(String(e)); throw e; }).finally(() => { refreshing.current = undefined; });
    refreshing.current = operation; return operation;
  }, [accept]);
  const runs = useMemo(() => {
    const values = new Map(snapshot.runs.map((r) => [r.id, restoreRun(r)]));
    for (const [id, item] of pending.current) if (!values.has(id)) values.set(id, item.run);
    return [...values.values()].sort((a, b) => b.startedAt - a.startedAt).slice(0, MAX_RUNS);
  }, [snapshot, localRevision]);
  return { snapshot, runs, record, act, flush, refresh, refreshError, error: [...errors.values()][0] ?? snapshot.error };
}
