import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  codexSessionSeen, codexUsageMany, forgetCodexSessions, listCodexSessions,
  onCodexActivity, onCodexAttention, onCodexReply, onCodexSessionStart, onCodexSessionsChanged,
  setCodexPlanSummary, showPlanWarning, type ClaudeAlert, type CodexSession, type CodexUsage, type Config,
} from "../ipc";
import type { TerminalRegistry } from "../terminal/registry";
import { paneIds, type Workspace } from "../workspace/workspace";
import {nativeAgentContext,sightingContext} from "../agents/environments";
import { planSummary } from "./usage";
import type { CodexMenuProps } from "./CodexMenu";
import { hookObservation, resolveObservation, type AgentObservation, type AgentStatus } from "../agents/status";
import {processEvidence,withProcessEvidence} from "../agents/processEvidence";
import type {ProcessSnapshot} from "../agents/useProviderProcesses";

interface Options {
  processes:ProcessSnapshot;
  resumeSession(session:CodexSession,where:"new"|"current"):void;
  newSession(cwd:string,environment:string):void;
  config: Config | undefined;
  workspace: Workspace;
  registry: TerminalRegistry;
  attention: ReadonlyMap<string, ClaudeAlert>;
  raiseAlert(alert: ClaudeAlert, notify?: boolean): void;
  clearAlert(paneId: string): void;
  focusPane(paneId: string): void;
  label(paneId: string): string;
  notice(message: string): void;
  refreshProject(paneId: string): void;
}

/** Provider-specific state lives here; terminal, layout and attention UI stay shared. */
export function useCodex(options: Options) {
  const latest = useRef(options); latest.current = options;
  const [sessions, setSessions] = useState<CodexSession[]>([]);
  const [status, setStatus] = useState<ReadonlyMap<string, AgentStatus>>(new Map());
  const [observations, setObservations] = useState<ReadonlyMap<string, AgentObservation>>(new Map());
  const [usages, setUsages] = useState<ReadonlyMap<string, CodexUsage>>(new Map());
  const [replies, setReplies] = useState<ReadonlyMap<string, string>>(new Map());
  const known = useRef(new Map<string, string>());
  const activity = useRef(new Map<string, AgentObservation>());
  const previousStatus=useRef(status);previousStatus.current=status;
  const warned = useRef(new Map<string, number>());
  const seen = useCallback((paneId: string, id: string, associate = true) => {
    const o = latest.current;
    const pane = o.workspace.panes[paneId];
    if (!pane) return;
    if (associate) {
      if (known.current.get(paneId) !== id) {
        activity.current.delete(paneId);
        setReplies((current) => { const next = new Map(current); next.delete(paneId); return next; });
        setUsages((current) => { const next = new Map(current); next.delete(paneId); return next; });
      }
      known.current.set(paneId, id);
    }
    if (o.config?.codexSessions) void codexSessionSeen(id, pane.profileId, pane.cwd,sightingContext(o.registry.environmentOf(paneId)??pane.environment,o.registry.shellKindOf(paneId))).catch((e) => o.notice(`Could not remember Codex session: ${e}`));
  }, []);

  useEffect(() => {
    let disposed = false;
    void listCodexSessions().then((s) => { if (!disposed) setSessions(s); }).catch((e) => latest.current.notice(`Could not read Codex sessions: ${e}`));
    const listeners = [
      onCodexSessionsChanged(setSessions),
      onCodexSessionStart((s) => { seen(s.paneId, s.sessionId); observe(s.paneId, "unknown", "SessionStart", s.sessionId); }),
      onCodexActivity((s) => { if (s.sessionId) seenIfNew(s.paneId, s.sessionId); latest.current.clearAlert(s.paneId); observe(s.paneId, s.busy ? "busy" : "idle", s.busy ? "activity" : "Interrupt", s.sessionId); }),
      onCodexAttention((a) => {
        if (a.sessionId) seenIfNew(a.paneId, a.sessionId);
        observe(a.paneId, "approval", "PermissionRequest", a.sessionId);
        if (latest.current.config?.codexAlerts) latest.current.raiseAlert(a, false);
      }),
      onCodexReply((r) => {
        const o = latest.current;
        if (!o.workspace.panes[r.paneId]) return;
        if (r.sessionId) seenIfNew(r.paneId, r.sessionId);
        o.clearAlert(r.paneId);
        observe(r.paneId, "completed", "Stop", r.sessionId);
        setReplies((current) => new Map(current).set(r.paneId, r.message));
        o.refreshProject(r.paneId);
        if (o.config?.codexAlerts && r.message.trim()) o.raiseAlert({ paneId: r.paneId, sessionId: r.sessionId, title: "Codex turn completed", message: r.message, kind: "codex:reply" });
      }),
    ];
    function observe(paneId: string, state: AgentStatus, event: string, sessionId?: string | null) {
      const o = latest.current;
      if (!o.workspace.panes[paneId]) return;
      activity.current.set(paneId, hookObservation(state, event, o.registry.submissionRevision(paneId), sessionId));
    }
    function seenIfNew(paneId: string, id: string) { if (known.current.get(paneId) !== id) seen(paneId, id); }
    return () => { disposed = true; for (const listener of listeners) void listener.then((off) => off()); };
  }, [seen]);

  const enabled = Boolean(options.config?.codexSessions || options.config?.codexAlerts || options.config?.codexRestore);
  useEffect(() => {
    if (!enabled) { setStatus(new Map()); setUsages(new Map()); setObservations(new Map()); return; }
    let disposed = false;
    const poll = async () => {
      try {
        if (disposed) return;
        const o = latest.current;
        const next = new Map<string, AgentStatus>();
        const usage = new Map<string, CodexUsage>();
        const observed = new Map<string, AgentObservation>();
        const livePanes = Object.values(o.workspace.panes).filter((pane) => {
          const session = o.registry.sessionOf(pane.id);
          if(session===undefined)return false;
          const environment=o.registry.environmentOf(pane.id),native=nativeAgentContext(environment,o.registry.shellKindOf(pane.id));
          const evidence=processEvidence(o.processes.get(session),environment,"codex",known.current.has(pane.id)||activity.current.has(pane.id),previousStatus.current.has(pane.id),o.registry.atEmptyPrompt(pane.id),native||environment?.startsWith("wsl:")===true);
          if(!evidence.track)return false;
          const event=withProcessEvidence(resolveObservation(activity.current.get(pane.id),o.registry.submissionRevision(pane.id),o.registry.lastOutput(pane.id),Date.now(),2000),evidence);
          next.set(pane.id,event.state);observed.set(pane.id,event);return true;
        });
        setStatus(next); setObservations(observed);
        const nativePanes=livePanes.filter(pane=>nativeAgentContext(o.registry.environmentOf(pane.id),o.registry.shellKindOf(pane.id)));
        const ids = [...new Set(nativePanes.flatMap((pane) => known.current.has(pane.id) ? [known.current.get(pane.id)!] : []))];
        // Usage failures cannot hide a successfully observed running process.
        const batch = ids.length ? await codexUsageMany(ids).catch(() => []) : [];
        if (disposed) return;
        const bySession = new Map(batch.map((u) => [u.sessionId.toLowerCase(), u]));
        for (const pane of nativePanes) {
          const id = known.current.get(pane.id);
          if (id) {
            const u = bySession.get(id.toLowerCase());
            if (disposed) return;
            if (u) {
              usage.set(pane.id, u);
              for (const [name, limit] of Object.entries(u.rateLimits ?? {})) {
                if (!limit || !Number.isFinite(limit.used_percent)) continue;
                const key = `${name}:${limit.resets_at ?? "unknown"}`;
                const level = limit.used_percent >= 95 ? 95 : limit.used_percent >= 80 ? 80 : 0;
                const previous = warned.current.get(key) ?? 0;
                warned.current.set(key, Math.max(level, previous));
                if (level > previous && o.config?.codexAlerts) void showPlanWarning(`Codex plan: ${name} limit at ${level}%`, `${Math.round(limit.used_percent)}% used${limit.resets_at ? `; resets ${new Date(limit.resets_at * 1000).toLocaleString()}` : ""}.`).catch(() => {});
              }
            }
          }
        }
        if (!disposed) {
          setUsages(usage);
          // Forget ended process associations; never assign a new session by cwd.
          for (const id of known.current.keys()) if (!next.has(id)) { known.current.delete(id); activity.current.delete(id); }
          setReplies((current) => new Map([...current].filter(([id]) => next.has(id))));
        }
      } catch {
        if (!disposed) {
          setStatus((current) => new Map([...current.keys()].map((id) => [id, "unknown"])));
          setObservations((current) => new Map([...current].map(([id, value]) => [id, { ...value, state: "unknown", reason: "Process scan failed; last observation retained." }])));
        }
      }
    };
    void poll();
    return () => { disposed = true; };
  }, [enabled,options.processes]);

  const resume = useCallback((session: CodexSession) => {
    latest.current.resumeSession(session,"new");
  }, []);
  const resumeHere = useCallback((session: CodexSession) => {
    latest.current.resumeSession(session,"current");
  }, []);
  const byPane = useMemo(() => new Map([...status.keys()].flatMap((id) => known.current.has(id) ? [[id, known.current.get(id)!] as const] : [])), [status]);
  const plan = [...usages.values()].map(planSummary).find(Boolean);
  useEffect(() => { void setCodexPlanSummary(plan ?? null).catch(() => {}); }, [plan]);
  const menu: CodexMenuProps = {
    plan,
    sessions, onResume: resume, onResumeHere: resumeHere,
    onForget: (ids) => void forgetCodexSessions(ids).catch((e) => options.notice(String(e))),
    onNewSession: options.newSession,
    running: [...status].map(([paneId, state]) => ({ paneId, label: options.label(paneId), state, observation: observations.get(paneId), usage: usages.get(paneId) })),
    waiting: options.workspace.tabs.flatMap((t) => paneIds(t.root)).flatMap((paneId) => {
      const alert = options.attention.get(paneId);
      return alert?.kind?.startsWith("codex:") ? [{ paneId, label: options.label(paneId), message: alert.message, reply: replies.get(paneId) }] : [];
    }),
    onFocusPane: options.focusPane,
  };
  return { sessions, status, observations, usages, replies, byPane, menu, seen, resume, resumeHere };
}
