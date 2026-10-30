import { useEffect, useMemo, useState } from "react";

import { scanCodexSessions, type CodexScan, type CodexSession, type CodexUsage,type SessionReference } from "../ipc";
import {sessionEnvironment,sessionReference} from "../agents/environments";
import {environmentLabel} from "../agents/library";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { Popup } from "../tabs/Popup";
import { groupSessions, type GroupableSession } from "../claude/groups";
import { replyPreview } from "../claude/reply";
import { planSummary, contextPercent, formatTokens, modelName, usageSummary } from "./usage";
import { agentStateText, agentStatusLabel, observationDetail, type AgentObservation, type AgentStatus } from "../agents/status";

/** Above this many sessions the menu offers a filter box. */
const FILTER_FROM = 6;

/** Codex CLI running in a pane now, with its token use. */
export interface RunningCodex {
  paneId: string;
  /** Where the pane is, e.g. "2 · PowerShell". */
  label: string;
  usage?: CodexUsage;
  state: AgentStatus;
  observation?: AgentObservation;
}

/** A pane where Codex CLI waits for you. */
export interface WaitingCodex {
  paneId: string;
  /** Where the pane is, e.g. "2 · PowerShell". */
  label: string;
  message: string;
  /** What Codex said last, if its Stop hook told qterm. */
  reply?: string;
}

export interface CodexMenuProps {
  sessions: CodexSession[];
  onResume(session: CodexSession): void;
  /** Resumes it in the focused pane instead of a new tab. */
  onResumeHere(session: CodexSession): void;
  onForget(references: SessionReference[]): void;
  /** Starts a fresh Codex CLI session in this folder. */
  onNewSession(cwd: string,environment:string): void;
  running: RunningCodex[];
  /** Panes where Codex waits for you, in tab order. */
  waiting: WaitingCodex[];
  /** "5-hour 23% (resets 14:30) · 7-day 41%", once the local Codex rollout reports it. */
  plan?: string;
  onFocusPane(paneId: string): void;
}

type Props = CodexMenuProps;

/** One row of either view. */
interface Row extends GroupableSession {
  /** Remembered sessions keep the profile they were seen in; "" = default. */
  profileId: string;
  meta: string;
  remembered: boolean;
}

/** The ⬡ tab-bar button: remembered Codex CLI sessions, grouped by folder. */
export function CodexMenu({ sessions, onResume, onResumeHere, onForget, onNewSession, running, waiting, plan, onFocusPane }: Props) {
  return (
    <Popup
      label="Codex sessions"
      title={`Codex sessions (${sessions.length})`}
      icon={<span className="claude-icon">⬡{sessions.length > 0 && <sup>{sessions.length}</sup>}</span>}
      menuLabel="Codex sessions"
      className="claude-menu"
    >
      {(close) => (
        <>
          {plan && (
            <section className="claude-running" aria-label="Codex plan usage">
              <div className="claude-running-title">Codex plan: {plan}</div>
            </section>
          )}
          {waiting.length > 0 && (
            <section className="claude-running" aria-label="Codex is waiting for you">
              <div className="claude-running-title">Waiting for you · Alt+Shift+W goes to the next</div>
              {waiting.map(({ paneId, label, message, reply }) => (
                <button
                  key={paneId}
                  className="claude-running-row claude-waiting-row"
                  title={reply ? replyPreview(reply, 20, 2000) : message}
                  onClick={() => {
                    close();
                    onFocusPane(paneId);
                  }}
                >
                  <span className="claude-running-tab">{label}</span>
                  <span className="claude-waiting-message">{message}</span>
                  {reply && <span className="claude-waiting-reply">{replyPreview(reply, 3, 240)}</span>}
                </button>
              ))}
            </section>
          )}
          {running.length > 0 && (
            <section className="claude-running" aria-label="Codex running now">
              <div className="claude-running-title">Running now</div>
              {running.map(({ paneId, label, usage, state, observation }) => {
                const percent = usage ? contextPercent(usage) : undefined;
                return (
                  <button
                    key={paneId}
                    className="claude-running-row"
                    title={`${agentStatusLabel("Codex", state)}\n${observationDetail(observation, state)}${usage ? `\n${usageSummary(usage)}` : ""}`}
                    onClick={() => {
                      close();
                      onFocusPane(paneId);
                    }}
                  >
                    <span className="claude-running-tab">{label}</span>
                    <span className="claude-running-model">{usage ? modelName(usage.model) : "Codex"}
                      <span className="agent-state"> · {agentStateText(state)}</span>
                    </span>
                    <span className="claude-running-context">
                      {percent !== undefined && <meter min={0} max={100} low={60} high={80} optimum={0} value={percent} />}
                      {usage ? formatTokens(usage.contextTokens) : "Usage unavailable"}
                      {percent !== undefined && ` (${percent}%)`}
                    </span>
                    <span className="claude-running-cost">{usage ? planSummary(usage) : ""}</span>
                  </button>
                );
              })}
              <p className="claude-running-note">Usage comes from local Codex CLI records. Plan limits appear when Codex reports them.</p>
            </section>
          )}
          <SessionList
            sessions={sessions}
            onResume={(session) => {
              close();
              onResume(session);
            }}
            onResumeHere={(session) => {
              close();
              onResumeHere(session);
            }}
            onForget={onForget}
            onNewSession={(cwd,environment) => {
              close();
              onNewSession(cwd,environment);
            }}
          />
        </>
      )}
    </Popup>
  );
}

function SessionList({
  sessions,
  onResume,
  onResumeHere,
  onForget,
  onNewSession,
}: Pick<Props, "sessions" | "onResume" | "onResumeHere" | "onForget" | "onNewSession">) {
  const [view, setView] = useState<"remembered" | "all">(sessions.length > 0 ? "remembered" : "all");
  const [scan, setScan] = useState<CodexScan>();
  const all = scan?.sessions;
  const [error, setError] = useState<string>();
  const [copyError, setCopyError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [filter, setFilter] = useState("");
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    if (view !== "all") return;
    let disposed = false;
    setLoading(true);
    setError(undefined);
    void scanCodexSessions().then(
      (result) => { if (!disposed) setScan(result); },
      (e) => { if (!disposed) setError(String(e)); },
    ).finally(() => { if (!disposed) setLoading(false); });
    return () => { disposed = true; };
  }, [view, refresh]);

  const rows = useMemo((): Row[] => {
    if (view === "remembered") {
      return sessions.map((s) => ({ ...s,environment:sessionEnvironment(s), meta: timeAgo(s.seenAt), remembered: true }));
    }
    return (all ?? []).map((t) => ({
      id: t.id,
      environment:"native",
      cwd: t.cwd,
      title: t.title,
      seenAt: t.modified,
      profileId: sessions.find((s) => s.id === t.id&&sessionEnvironment(s)==="native")?.profileId ?? "",
      meta: [t.gitBranch, `${t.prompts} prompt${t.prompts === 1 ? "" : "s"}`, timeAgo(t.modified)].filter(Boolean).join(" · "),
      remembered: sessions.some((s) => s.id === t.id&&sessionEnvironment(s)==="native"),
    }));
  }, [view, sessions, all]);
  const groups = useMemo(() => groupSessions(rows, filter), [rows, filter]);
  const asSession = (row: Row): CodexSession => ({ id: row.id,environment:sessionEnvironment(row), cwd: row.cwd, title: row.title, profileId: row.profileId, seenAt: row.seenAt });
  const resume = (row: Row) => onResume(asSession(row));

  const toggle = (key: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  const shown = groups.reduce((n, g) => n + g.sessions.length, 0);

  return (
    <>
      <div className="claude-menu-header codex-menu-header">
        <div className="claude-views" role="tablist" aria-label="Which sessions">
          <button role="tab" aria-selected={view === "remembered"} onClick={() => setView("remembered")}>
            Remembered
          </button>
          <button role="tab" aria-selected={view === "all"} onClick={() => setView("all")}>
            Native Windows
          </button>
        </div>
        {rows.length >= FILTER_FROM && (
          <input
            type="search"
            aria-label="Filter sessions"
            placeholder="Filter by title, folder or id"
            value={filter}
            autoFocus
            onChange={(e) => setFilter(e.target.value)}
          />
        )}
        {(view === "remembered" || scan) && <span className="claude-count">
          {view === "all" && scan?.diagnostics.errors.length && scan.diagnostics.filesScanned === 0 ? "Session count unavailable" : <>
          {shown} session{shown === 1 ? "" : "s"} in {groups.length} folder{groups.length === 1 ? "" : "s"}
          {view === "all" && Boolean(scan?.diagnostics.errors.length) ? " · incomplete scan" : ""}
          </>}
          {view === "all" && loading ? " · refreshing" : view === "all" && error ? " · previous scan" : ""}
        </span>}
        {view === "all" && <button aria-label="Refresh Codex sessions" disabled={loading} onClick={() => setRefresh((value) => value + 1)}>Refresh</button>}
      </div>
      {view === "all" && <section className="codex-scan" aria-label="Codex session scan">
        <p>Native Windows sessions only; WSL and archived sessions are excluded.</p>
        {scan && <>
          <p className="codex-scan-path" title={scan.sessionsPath}>Codex home: {scan.home}</p>
          <button onClick={() => void writeText(scan.home).then(() => setCopyError(undefined), (e) => setCopyError(String(e)))}>Copy Codex home</button>
          {copyError && <p role="status">Could not copy Codex home: {copyError}</p>}
          <p>{scan.diagnostics.filesScanned} rollout files scanned; {scan.diagnostics.unrecognizedFiles} unrecognized.</p>
          {scan.diagnostics.missingSessionsFolder && <p>No sessions folder exists at {scan.sessionsPath}. Check your native Windows Codex installation or CODEX_HOME.</p>}
          {scan.diagnostics.errors.length > 0 && <div role="alert">
            <p>Some session data could not be read. Results may be incomplete.</p>
            <ul>{scan.diagnostics.errors.map((message, index) => <li key={index}>{message}</li>)}</ul>
          </div>}
          {!loading && !error && !scan.diagnostics.missingSessionsFolder && scan.sessions.length === 0 && scan.diagnostics.errors.length === 0 && <p>No sessions containing user prompts were recognized. Unrecognized files may use an unsupported or incomplete format.</p>}
        </>}
      </section>}
      <div className="claude-groups">
        {view==="all"&&<p className="menu-empty">Native Windows transcripts only. Use Session library for enabled WSL sources.</p>}
        {error && <p className="menu-empty">Could not read Codex sessions: {error}</p>}
        {view === "all" && loading && !all && <p className="menu-empty">Reading Codex CLI's sessions…</p>}
        {view === "remembered" && sessions.length === 0 && (
          <p className="menu-empty">
            Nothing remembered yet. Sessions appear here when a terminal prints <code>codex resume &lt;id&gt;</code>,
            as Codex CLI does when you quit it. "Native Windows" reads local Windows transcripts.
          </p>
        )}
        {rows.length > 0 && groups.length === 0 && <p className="menu-empty">No session matches “{filter}”.</p>}
        {groups.map((group) => {
          // While filtering, every match stays visible.
          const open = filter.trim() !== "" || !collapsed.has(group.key);
          return (
            <section key={group.key} className="claude-group" aria-label={`Sessions in ${group.label} · ${environmentLabel(group.environment)}`}>
              <div className="claude-group-header">
                <button
                  className="claude-group-toggle"
                  aria-expanded={open}
                  title={group.cwd ?? "Neither the transcript nor the terminal said where these ran"}
                  onClick={() => toggle(group.key)}
                >
                  <span className="claude-chevron" aria-hidden="true">
                    {open ? "▾" : "▸"}
                  </span>
                  <span className="claude-group-name">{group.label}</span>
                  <span className="claude-group-path">{group.cwd}</span>
                  <span className="claude-meta">{environmentLabel(group.environment)}</span>
                  <span className="claude-group-count">{group.sessions.length}</span>
                </button>
                {group.cwd && (
                  <button
                    className="tab-close claude-new"
                    aria-label={`New Codex session in ${group.label}`}
                    title={`Start codex in ${group.cwd}`}
                    disabled={group.environment==="unknown"}
                    onClick={() => onNewSession(group.cwd!,group.environment)}
                  >
                    +
                  </button>
                )}
                {view === "remembered" && (
                  <button
                    className="tab-close"
                    aria-label={`Forget all sessions in ${group.label}`}
                    title={`Forget all ${group.sessions.length} in ${group.label}`}
                    onClick={() => onForget(group.sessions.map(sessionReference))}
                  >
                    ×
                  </button>
                )}
              </div>
              {open &&
                group.sessions.map((session) => (
                  <div key={session.id} className="claude-session">
                    <button
                      role="menuitem"
                      title={`Resume in ${session.cwd ?? "your home folder"}\ncodex resume ${session.id}`}
                      onClick={() => resume(session)}
                    >
                      <span className="claude-title">{session.title ?? "Untitled session"}</span>
                      <span className="claude-meta">
                        {session.meta} · {session.id.slice(0, 8)}
                      </span>
                    </button>
                    <button
                      className="claude-here"
                      title="Resume in the current tab (agent starts in its verified folder)"
                      aria-label={`Resume ${session.title ?? session.id} in the current tab`}
                      onClick={() => onResumeHere(asSession(session))}
                    >
                      here
                    </button>
                    {session.remembered && view === "remembered" && (
                      <button
                        className="tab-close"
                        aria-label={`Forget ${session.title ?? session.id}`}
                        onClick={() => onForget([sessionReference(session)])}
                      >
                        ×
                      </button>
                    )}
                  </div>
                ))}
            </section>
          );
        })}
      </div>
    </>
  );
}

function timeAgo(ms: number): string {
  const minutes = Math.round((Date.now() - ms) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days < 7 ? `${days} d ago` : new Date(ms).toLocaleDateString();
}
