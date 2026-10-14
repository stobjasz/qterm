import { useEffect, useMemo, useState } from "react";

import { listAllClaudeSessions, type ClaudeSession, type ClaudeUsage, type TranscriptSummary } from "../ipc";
import { Popup } from "../tabs/Popup";
import { groupSessions, type GroupableSession } from "./groups";
import { contextPercent, formatCost, formatTokens, modelName, usageSummary } from "./usage";

/** Above this many sessions the menu offers a filter box. */
const FILTER_FROM = 6;

/** Claude Code running in a pane now, with its token use. */
export interface RunningClaude {
  paneId: string;
  /** Where the pane is, e.g. "2 · PowerShell". */
  label: string;
  usage: ClaudeUsage;
}

/** A pane where Claude Code waits for you. */
export interface WaitingClaude {
  paneId: string;
  /** Where the pane is, e.g. "2 · PowerShell". */
  label: string;
  message: string;
}

export interface ClaudeMenuProps {
  sessions: ClaudeSession[];
  onResume(session: ClaudeSession): void;
  /** Resumes it in the focused pane instead of a new tab. */
  onResumeHere(session: ClaudeSession): void;
  onForget(ids: string[]): void;
  /** Starts a fresh Claude Code session in this folder. */
  onNewSession(cwd: string): void;
  running: RunningClaude[];
  /** Panes where Claude waits for you, in tab order. */
  waiting: WaitingClaude[];
  /** "5-hour 23% (resets 14:30) · 7-day 41%", once Claude Code's status line reported it. */
  plan?: string;
  onFocusPane(paneId: string): void;
}

type Props = ClaudeMenuProps;

/** One row of either view. */
interface Row extends GroupableSession {
  /** Remembered sessions keep the profile they were seen in; "" = default. */
  profileId: string;
  meta: string;
  remembered: boolean;
}

/** The ✳ tab-bar button: remembered Claude Code sessions, grouped by folder. */
export function ClaudeMenu({ sessions, onResume, onResumeHere, onForget, onNewSession, running, waiting, plan, onFocusPane }: Props) {
  return (
    <Popup
      label="Claude sessions"
      title={`Claude sessions (${sessions.length})`}
      icon={<span className="claude-icon">✳{sessions.length > 0 && <sup>{sessions.length}</sup>}</span>}
      menuLabel="Claude sessions"
      className="claude-menu"
    >
      {(close) => (
        <>
          {plan && (
            <section className="claude-running" aria-label="Claude plan usage">
              <div className="claude-running-title">Claude plan: {plan}</div>
            </section>
          )}
          {waiting.length > 0 && (
            <section className="claude-running" aria-label="Claude is waiting for you">
              <div className="claude-running-title">Waiting for you · Alt+Shift+W goes to the next</div>
              {waiting.map(({ paneId, label, message }) => (
                <button
                  key={paneId}
                  className="claude-running-row claude-waiting-row"
                  title={message}
                  onClick={() => {
                    close();
                    onFocusPane(paneId);
                  }}
                >
                  <span className="claude-running-tab">{label}</span>
                  <span className="claude-waiting-message">{message}</span>
                </button>
              ))}
            </section>
          )}
          {running.length > 0 && (
            <section className="claude-running" aria-label="Claude running now">
              <div className="claude-running-title">Running now</div>
              {running.map(({ paneId, label, usage }) => {
                const percent = contextPercent(usage);
                return (
                  <button
                    key={paneId}
                    className="claude-running-row"
                    title={usageSummary(usage)}
                    onClick={() => {
                      close();
                      onFocusPane(paneId);
                    }}
                  >
                    <span className="claude-running-tab">{label}</span>
                    <span className="claude-running-model">{modelName(usage.model)}</span>
                    <span className="claude-running-context">
                      {percent !== undefined && <meter min={0} max={100} low={60} high={80} optimum={0} value={percent} />}
                      {formatTokens(usage.contextTokens)}
                      {percent !== undefined && ` (${percent}%)`}
                    </span>
                    <span className="claude-running-cost">{formatCost(usage) ?? ""}</span>
                  </button>
                );
              })}
              <p className="claude-running-note">Cost is an estimate at API list prices; a Claude subscription isn't billed per token.</p>
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
            onNewSession={(cwd) => {
              close();
              onNewSession(cwd);
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
  const [all, setAll] = useState<TranscriptSummary[]>();
  const [filter, setFilter] = useState("");
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    if (view === "all" && !all) void listAllClaudeSessions().then(setAll, () => setAll([]));
  }, [view, all]);

  const rows = useMemo((): Row[] => {
    if (view === "remembered") {
      return sessions.map((s) => ({ ...s, meta: timeAgo(s.seenAt), remembered: true }));
    }
    return (all ?? []).map((t) => ({
      id: t.id,
      cwd: t.cwd,
      title: t.title,
      seenAt: t.modified,
      profileId: sessions.find((s) => s.id === t.id)?.profileId ?? "",
      meta: [t.gitBranch, `${t.prompts} prompt${t.prompts === 1 ? "" : "s"}`, timeAgo(t.modified)].filter(Boolean).join(" · "),
      remembered: sessions.some((s) => s.id === t.id),
    }));
  }, [view, sessions, all]);
  const groups = useMemo(() => groupSessions(rows, filter), [rows, filter]);
  const asSession = (row: Row): ClaudeSession => ({ id: row.id, cwd: row.cwd, title: row.title, profileId: row.profileId, seenAt: row.seenAt });
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
      <div className="claude-menu-header">
        <div className="claude-views" role="tablist" aria-label="Which sessions">
          <button role="tab" aria-selected={view === "remembered"} onClick={() => setView("remembered")}>
            Remembered
          </button>
          <button role="tab" aria-selected={view === "all"} onClick={() => setView("all")}>
            All on this PC
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
        <span className="claude-count">
          {shown} session{shown === 1 ? "" : "s"} in {groups.length} folder{groups.length === 1 ? "" : "s"}
        </span>
      </div>
      <div className="claude-groups">
        {view === "all" && !all && <p className="menu-empty">Reading Claude Code's sessions…</p>}
        {view === "remembered" && sessions.length === 0 && (
          <p className="menu-empty">
            Nothing remembered yet. Sessions appear here when a terminal prints <code>claude --resume &lt;id&gt;</code>,
            as Claude Code does when you quit it. "All on this PC" lists every session.
          </p>
        )}
        {rows.length > 0 && groups.length === 0 && <p className="menu-empty">No session matches “{filter}”.</p>}
        {groups.map((group) => {
          // While filtering, every match stays visible.
          const open = filter.trim() !== "" || !collapsed.has(group.key);
          return (
            <section key={group.key} className="claude-group" aria-label={`Sessions in ${group.label}`}>
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
                  <span className="claude-group-count">{group.sessions.length}</span>
                </button>
                {group.cwd && (
                  <button
                    className="tab-close claude-new"
                    aria-label={`New Claude session in ${group.label}`}
                    title={`Start claude in ${group.cwd}`}
                    onClick={() => onNewSession(group.cwd!)}
                  >
                    +
                  </button>
                )}
                {view === "remembered" && (
                  <button
                    className="tab-close"
                    aria-label={`Forget all sessions in ${group.label}`}
                    title={`Forget all ${group.sessions.length} in ${group.label}`}
                    onClick={() => onForget(group.sessions.map((s) => s.id))}
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
                      title={`Resume in ${session.cwd ?? "your home folder"}\nclaude --resume ${session.id}`}
                      onClick={() => resume(session)}
                    >
                      <span className="claude-title">{session.title ?? "Untitled session"}</span>
                      <span className="claude-meta">
                        {session.meta} · {session.id.slice(0, 8)}
                      </span>
                    </button>
                    <button
                      className="claude-here"
                      title="Resume in the current tab (goes to its folder first)"
                      aria-label={`Resume ${session.title ?? session.id} in the current tab`}
                      onClick={() => onResumeHere(asSession(session))}
                    >
                      here
                    </button>
                    {session.remembered && view === "remembered" && (
                      <button
                        className="tab-close"
                        aria-label={`Forget ${session.title ?? session.id}`}
                        onClick={() => onForget([session.id])}
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
