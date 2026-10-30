import { useMemo, useRef, useState } from "react";
import type { AgentInboxAction, AgentInboxSnapshot } from "../ipc";
import { useModalFocus } from "../tabs/useModalFocus";

interface Props {
  snapshot: AgentInboxSnapshot; error?: string | null;
  paneLabels: ReadonlyMap<string, string>;
  onAction(action: AgentInboxAction, ids?: string[]): Promise<unknown>;
  onGo(paneId: string): void; onClose(): void;
}
export function AgentInbox({ snapshot, error, paneLabels, onAction, onGo, onClose }: Props) {
  const root = useRef<HTMLElement>(null); useModalFocus(root);
  const [provider, setProvider] = useState("all");
  const [kind, setKind] = useState("all");
  const [status, setStatus] = useState("open");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string>();
  const [actionError, setActionError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const act = async (action: AgentInboxAction, ids?: string[]) => {
    setBusy(true); setActionError(undefined);
    try { await onAction(action, ids); setConfirmReset(false); }
    catch (e) { setActionError(String(e)); }
    finally { setBusy(false); }
  };
  const events = useMemo(() => snapshot.events.filter((e) =>
    (provider === "all" || provider === e.provider) && (kind === "all" || kind === e.kind)
    && (status === "all" || (status === "open" ? e.resolvedAt === null : status === "unread" ? e.viewedAt === null : e.resolvedAt !== null))
    && `${e.cwd ?? ""} ${e.title} ${e.message} ${e.sessionId ?? ""} ${paneLabels.get(e.paneId) ?? ""}`.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => b.createdAt - a.createdAt), [snapshot.events, provider, kind, status, query, paneLabels]);
  const detail = snapshot.events.find((e) => e.id === selected);
  const open = snapshot.events.filter((e) => e.resolvedAt === null).length;
  const unread = snapshot.events.filter((e) => e.viewedAt === null).length;
  return <div className="palette-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
    <section ref={root} tabIndex={-1} className="palette agent-inbox" role="dialog" aria-modal="true" aria-label="Agent inbox"
      onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Escape" && !busy) { e.preventDefault(); onClose(); } }}>
      <div className="inbox-heading"><h2>Agent inbox</h2><span role="status">{open} open · {unread} unread</span><button disabled={busy} onClick={onClose}>Close inbox</button></div>
      <p>Viewing an event marks it read. Resolve it when you have handled it. Permission decisions stay in the agent’s terminal.</p>
      {(error || actionError) && <div role="alert"><p>{error || actionError}</p><button disabled={busy} onClick={() => void act("retry")}>Retry inbox save</button>
        {snapshot.recoveryRequired && <><button disabled={busy} onClick={() => setConfirmReset(true)}>Recover saved inbox</button>{confirmReset && <p>The original file will be kept as a backup. Start a fresh saved inbox with this run’s events? <button disabled={busy} onClick={() => void act("resetSaved")}>Keep backup and recover</button><button disabled={busy} onClick={() => setConfirmReset(false)}>Cancel recovery</button></p>}</>}
      </div>}
      {snapshot.backupPath && <p>Original history preserved at {snapshot.backupPath}</p>}
      <div className="inbox-filters">
        <label>Search<input aria-label="Search agent inbox" value={query} onChange={(e) => setQuery(e.target.value)} /></label>
        <label>Provider<select aria-label="Inbox provider" value={provider} onChange={(e) => setProvider(e.target.value)}><option value="all">All providers</option><option value="claude">Claude</option><option value="codex">Codex</option></select></label>
        <label>Type<select aria-label="Inbox type" value={kind} onChange={(e) => { setKind(e.target.value); if (e.target.value === "approval") setStatus("all"); }}><option value="all">All types</option>{["approval", "permission", "input", "completed", "failure"].map((k) => <option key={k} value={k}>{k === "approval" ? "Approval activity (informational)" : k}</option>)}</select></label>
        <label>Status<select aria-label="Inbox status" value={status} onChange={(e) => setStatus(e.target.value)}><option value="open">Open</option><option value="unread">Unread</option><option value="resolved">Resolved</option><option value="all">All events</option></select></label>
      </div>
      <div className="inbox-content">
        <div className="inbox-list" role="list" aria-label="Agent events" onKeyDown={(e) => {
          if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
          const buttons = [...e.currentTarget.querySelectorAll<HTMLButtonElement>("button")];
          const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
          if (at >= 0) { e.preventDefault(); buttons[(at + (e.key === "ArrowDown" ? 1 : buttons.length - 1)) % buttons.length]?.focus(); }
        }}>
          {events.length === 0 && <p>No matching events.</p>}
          {events.map((e) => <div role="listitem" key={e.id}><button disabled={busy} className={selected === e.id ? "inbox-event selected" : "inbox-event"}
            aria-label={`View ${e.provider} ${e.kind}: ${e.title}`} onClick={() => { setSelected(e.id); if (e.viewedAt === null) void act("view", [e.id]); }}>
            <strong>{e.provider === "codex" ? "Codex" : "Claude"} · {e.title}</strong><span>{e.kind} · {e.kind === "approval" ? "Informational" : e.resolvedAt !== null ? "Resolved" : "Open"} · {e.viewedAt !== null ? "Read" : "Unread"}{e.repeats > 1 ? ` · ×${e.repeats}` : ""}</span>
            <span>{e.cwd ?? "Project folder not reported"}</span><span>{paneLabels.get(e.paneId) ?? "Pane closed"}{e.runId !== snapshot.runId ? " · Previous run" : ""} · {new Date(e.createdAt).toLocaleString()}</span>
          </button></div>)}
        </div>
        <div className="inbox-detail" aria-label="Event details">{detail ? <>
          <h3>{detail.title}</h3><p>{detail.cwd ?? "Project folder not reported"}</p><pre>{detail.message}</pre>
          {detail.sessionId && <p>Session: {detail.sessionId}</p>}{detail.resolution && <p>{detail.resolution}</p>}
          {detail.runId !== snapshot.runId && <p>From a previous run. The agent’s current state has not been verified.</p>}
          <div className="settings-actions"><button disabled={busy || !paneLabels.has(detail.paneId) || detail.runId !== snapshot.runId} onClick={() => onGo(detail.paneId)}>Go to pane</button>
            {detail.kind !== "approval" && <button disabled={busy} onClick={() => void act(detail.resolvedAt === null ? "resolve" : "reopen", [detail.id])}>{detail.resolvedAt === null ? "Resolve event" : "Reopen event"}</button>}</div>
        </> : <p>Select an event to read its details.</p>}</div>
      </div>
      <div className="settings-actions"><button disabled={busy || !snapshot.events.some((e) => e.resolvedAt !== null)} onClick={() => void act("clearResolved")}>Clear resolved events</button></div>
    </section>
  </div>;
}
