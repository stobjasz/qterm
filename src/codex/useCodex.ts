import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  codexRunning, codexSessionSeen, codexUsage, forgetCodexSessions, listCodexSessions,
  onCodexActivity, onCodexAttention, onCodexReply, onCodexSessionStart, onCodexSessionsChanged,
  setCodexPlanSummary, showPlanWarning, type ClaudeAlert, type CodexSession, type CodexUsage, type Config, type Profile,
} from "../ipc";
import { resumeHereCommand } from "../claude/resume";
import type { TerminalRegistry } from "../terminal/registry";
import { activeTab, paneIds, type Workspace } from "../workspace/workspace";
import { sessionProfile } from "./profiles";
import { planSummary } from "./usage";
import type { CodexMenuProps } from "./CodexMenu";

interface Options {
  config: Config | undefined;
  workspace: Workspace;
  profiles: Profile[] | undefined;
  defaultProfile: Profile | undefined;
  registry: TerminalRegistry;
  newTab(profile?: string, cwd?: string): string | undefined;
  startupInput: Map<string, string>;
  attention: ReadonlyMap<string, ClaudeAlert>;
  raiseAlert(alert: ClaudeAlert): void;
  focusPane(paneId: string): void;
  label(paneId: string): string;
  notice(message: string): void;
  refreshProject(paneId: string): void;
  agentRunning(paneId: string): boolean;
}

/** Provider-specific state lives here; terminal, layout and attention UI stay shared. */
export function useCodex(options: Options) {
  const latest = useRef(options); latest.current = options;
  const [sessions, setSessions] = useState<CodexSession[]>([]);
  const [status, setStatus] = useState<ReadonlyMap<string, "busy" | "idle">>(new Map());
  const statusRef = useRef(status); statusRef.current = status;
  const [usages, setUsages] = useState<ReadonlyMap<string, CodexUsage>>(new Map());
  const [replies, setReplies] = useState<ReadonlyMap<string, string>>(new Map());
  const known = useRef(new Map<string, string>());
  const activity = useRef(new Map<string, "busy" | "idle">());
  const warned = useRef(new Map<string, number>());
  const seen = useCallback((paneId: string, id: string, associate = true) => {
    const o = latest.current;
    const pane = o.workspace.panes[paneId];
    if (!pane) return;
    if (associate) {
      if (known.current.get(paneId) !== id) {
        activity.current.delete(paneId);
        setReplies((current) => { const next = new Map(current); next.delete(paneId); return next; });
      }
      known.current.set(paneId, id);
    }
    if (o.config?.codexSessions) void codexSessionSeen(id, pane.profileId, pane.cwd).catch((e) => o.notice(`Could not remember Codex session: ${e}`));
  }, []);

  useEffect(() => {
    let disposed = false;
    void listCodexSessions().then((s) => { if (!disposed) setSessions(s); }).catch((e) => latest.current.notice(`Could not read Codex sessions: ${e}`));
    const listeners = [
      onCodexSessionsChanged(setSessions),
      onCodexSessionStart((s) => { seen(s.paneId, s.sessionId); activity.current.set(s.paneId, "idle"); }),
      onCodexActivity((s) => { if (s.sessionId) seenIfNew(s.paneId, s.sessionId); activity.current.set(s.paneId, s.busy ? "busy" : "idle"); }),
      onCodexAttention((a) => {
        if (a.sessionId) seenIfNew(a.paneId, a.sessionId);
        activity.current.set(a.paneId, "idle");
        if (latest.current.config?.codexAlerts) latest.current.raiseAlert(a);
      }),
      onCodexReply((r) => {
        const o = latest.current;
        if (!o.workspace.panes[r.paneId]) return;
        if (r.sessionId) seenIfNew(r.paneId, r.sessionId);
        activity.current.set(r.paneId, "idle");
        setReplies((current) => new Map(current).set(r.paneId, r.message));
        o.refreshProject(r.paneId);
        if (o.config?.codexAlerts) o.raiseAlert({ paneId: r.paneId, sessionId: r.sessionId, title: "Codex finished", message: r.message || "Codex finished its turn.", kind: "codex:reply" });
      }),
    ];
    function seenIfNew(paneId: string, id: string) { if (known.current.get(paneId) !== id) seen(paneId, id); }
    return () => { disposed = true; for (const listener of listeners) void listener.then((off) => off()); };
  }, [seen]);

  const enabled = Boolean(options.config?.codexSessions || options.config?.codexAlerts || options.config?.codexRestore);
  useEffect(() => {
    if (!enabled) { setStatus(new Map()); setUsages(new Map()); return; }
    let disposed = false;
    let timer: number;
    const poll = async () => {
      try {
        const running = new Set(await codexRunning());
        if (disposed) return;
        const o = latest.current;
        const next = new Map<string, "busy" | "idle">();
        const usage = new Map<string, CodexUsage>();
        for (const pane of Object.values(o.workspace.panes)) {
          const session = o.registry.sessionOf(pane.id);
          if (session === undefined || !running.has(session)) continue;
          next.set(pane.id, activity.current.get(pane.id) ?? (Date.now() - o.registry.lastOutput(pane.id) < 2000 ? "busy" : "idle"));
          const id = known.current.get(pane.id);
          if (id) {
            const u = await codexUsage(id);
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
          setStatus(next); setUsages(usage);
          // Forget ended process associations; never assign a new session by cwd.
          for (const id of known.current.keys()) if (!next.has(id)) { known.current.delete(id); activity.current.delete(id); }
          setReplies((current) => new Map([...current].filter(([id]) => next.has(id))));
        }
      } catch { /* Retry transient process/transcript failures on the next poll. */ }
      if (!disposed) timer = window.setTimeout(() => void poll(), 2500);
    };
    void poll();
    return () => { disposed = true; window.clearTimeout(timer); };
  }, [enabled]);

  const resume = useCallback((session: CodexSession) => {
    const o = latest.current;
    const profile = sessionProfile(o.profiles, o.defaultProfile, session.cwd, session.profileId);
    if (!profile) { o.notice("No shell can open this Codex session's folder."); return; }
    // Only session IDs obtained from the UUID-validated backend enter a shell.
    if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(session.id)) return;
    const id = o.newTab(profile.id, session.cwd ?? undefined);
    if (id) o.startupInput.set(id, `codex --no-daemon resume ${session.id}\r`);
  }, []);
  const resumeHere = useCallback((session: CodexSession) => {
    const o = latest.current;
    const paneId = activeTab(o.workspace)?.focusedPane;
    const pane = paneId ? o.workspace.panes[paneId] : undefined;
    const kind = o.profiles?.find((p) => p.id === pane?.profileId)?.kind ?? "other";
    const command = resumeHereCommand(session.id, session.cwd, kind, "codex");
    if (!paneId || !command || statusRef.current.has(paneId) || o.agentRunning(paneId) || o.registry.commandRunning(paneId) || o.registry.fullScreen(paneId)) {
      o.notice("The current pane is busy or cannot open this session's folder, so Codex opened in a new tab.");
      resume(session); return;
    }
    o.registry.focus(paneId); o.registry.typeSnippet(paneId, command, true);
  }, [resume]);
  const byPane = useMemo(() => new Map([...status.keys()].flatMap((id) => known.current.has(id) ? [[id, known.current.get(id)!] as const] : [])), [status]);
  const plan = [...usages.values()].map(planSummary).find(Boolean);
  useEffect(() => { void setCodexPlanSummary(plan ?? null).catch(() => {}); }, [plan]);
  const menu: CodexMenuProps = {
    plan,
    sessions, onResume: resume, onResumeHere: resumeHere,
    onForget: (ids) => void forgetCodexSessions(ids).catch((e) => options.notice(String(e))),
    onNewSession: (cwd) => {
      const profile = sessionProfile(options.profiles, options.defaultProfile, cwd);
      if (!profile) { options.notice("No shell can open this Codex session's folder."); return; }
      const id = options.newTab(profile.id, cwd);
      if (id) options.startupInput.set(id, "codex --no-daemon\r");
    },
    running: [...status].map(([paneId, state]) => ({ paneId, label: options.label(paneId), state, usage: usages.get(paneId) })),
    waiting: options.workspace.tabs.flatMap((t) => paneIds(t.root)).flatMap((paneId) => {
      const alert = options.attention.get(paneId);
      return alert?.kind?.startsWith("codex:") ? [{ paneId, label: options.label(paneId), message: alert.message, reply: replies.get(paneId) }] : [];
    }),
    onFocusPane: options.focusPane,
  };
  return { sessions, status, usages, replies, byPane, menu, seen, resume, resumeHere };
}
