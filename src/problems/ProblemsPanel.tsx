import { useMemo, useRef, useState } from "react";
import { useModalFocus } from "../tabs/useModalFocus";
import { formatClock, formatDuration } from "../terminal/marks";
import type { Diagnostic } from "./diagnostics";
import { latestRuns, type CommandRun } from "./runs";
import type { CommandRunsAction, CommandRunsSnapshot } from "../ipc";

interface Props {
  runs: readonly CommandRun[];
  initialRunId?: string;
  snapshot: CommandRunsSnapshot;
  saveError?: string | null;
  comparisonError?: string;
  onAction(action: CommandRunsAction): Promise<unknown>;
  onRefresh(): Promise<void>;
  onVerify(run: CommandRun): void;
  paneLabels: ReadonlyMap<string, string>;
  onOpen(run: CommandRun, diagnostic: Diagnostic): Promise<void>;
  onGo(paneId: string): void;
  onClose(): void;
}
export function ProblemsPanel({ runs, initialRunId, snapshot, saveError, comparisonError, onAction, onRefresh, onVerify, paneLabels, onOpen, onGo, onClose }: Props) {
  const root = useRef<HTMLElement>(null); useModalFocus(root);
  const [history, setHistory] = useState(!!initialRunId);
  const [query, setQuery] = useState("");
  const [severity, setSeverity] = useState("all");
  const [selected, setSelected] = useState<string | undefined>(initialRunId);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const act = async (action: CommandRunsAction) => { setBusy(true); setError(undefined); try { await onAction(action); setConfirmReset(false); setConfirmClear(false); } catch (e) { setError(String(e)); } finally { setBusy(false); } };
  const visible = useMemo(() => (history ? runs : latestRuns(runs)).filter((r) => `${r.command} ${r.cwd ?? ""}`.toLowerCase().includes(query.toLowerCase())), [runs, history, query]);
  const run = visible.find((r) => r.id === selected) ?? visible[0];
  const diagnostics = run?.diagnostics.items.filter((d) => severity === "all" || severity === d.severity) ?? [];
  const count = latestRuns(runs).reduce((n, r) => n + r.diagnostics.items.filter((d) => d.severity === "error").length, 0);
  const open = async (r: CommandRun, d: Diagnostic) => { setError(undefined); try { await onOpen(r, d); } catch (e) { setError(String(e)); } };
  return <div className="palette-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
    <section ref={root} tabIndex={-1} className="palette problems-panel" role="dialog" aria-modal="true" aria-label="Problems and command runs" onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Escape") { e.preventDefault(); onClose(); } }}>
      <div className="inbox-heading"><h2>Problems and command runs</h2><span>{count} error{count === 1 ? "" : "s"} in latest runs</span><button onClick={onClose}>Close problems</button></div>
      <p>Saved command results, with their original folder and shell. Later runs supersede the same command in the latest view. Exit zero describes that run; repository evidence applies only to the captured state.</p>
      <div className="inbox-filters"><label>Search<input aria-label="Search command runs" value={query} onChange={(e) => setQuery(e.target.value)} /></label>
        <label>Severity<select aria-label="Problem severity" value={severity} onChange={(e) => setSeverity(e.target.value)}><option value="all">All severities</option><option value="error">Errors</option><option value="warning">Warnings</option></select></label>
        <label className="problems-history"><input type="checkbox" checked={history} onChange={(e) => setHistory(e.target.checked)} />Show superseded runs</label></div>
      {(error || saveError) && <div role="alert"><p>{error || saveError}</p><button disabled={busy} onClick={() => void act("retry")}>Retry command record save</button>
        {snapshot.recoveryRequired && <><button disabled={busy} onClick={() => setConfirmReset(true)}>Recover command history</button>{confirmReset && <p>The original file will be preserved as a backup before this run's records are saved. <button disabled={busy} onClick={() => void act("resetSaved")}>Keep backup and recover records</button><button onClick={() => setConfirmReset(false)}>Cancel recovery</button></p>}</>}
      </div>}
      {snapshot.backupPath && <p>Original command history preserved at {snapshot.backupPath}</p>}
      {comparisonError && <p role="alert">Could not refresh repository evidence: {comparisonError}. The displayed comparison is historical; use Refresh verification to retry.</p>}
      <div className="inbox-content"><div className="inbox-list" role="list" aria-label="Command runs">
        {visible.length === 0 && <p>No command runs yet. Run a compiler or check in a pane with shell integration.</p>}
        {visible.map((r) => <div role="listitem" key={r.id}><button className={`inbox-event${r.id === run?.id ? " selected" : ""}`} aria-label={`Inspect run: ${r.command}`} onClick={() => { setSelected(r.id); setError(undefined); }}>
          <strong>{r.command}</strong><span>{r.cwd ?? "Folder not reported"}</span><span>{r.exitCode === undefined ? "Exit unknown" : `Exit ${r.exitCode}`} · {r.diagnostics.items.length} diagnostics · {formatClock(r.startedAt, Date.now(), true)} · {formatDuration(r.finishedAt - r.startedAt)}</span>
          <span>{r.appRunId !== snapshot.runId ? "Previous run" : paneLabels.get(r.paneId) ?? "Pane closed"}{r.verification ? ` · ${r.verification.status === "matches" ? "Repository matches" : r.verification.status === "stale" ? "Stale evidence" : "Freshness unknown"}` : ""}</span></button></div>)}
      </div><div className="inbox-detail" aria-label="Run details">{run && <>
        <h3>{run.command}</h3><p>{run.cwd ?? "Folder not reported"}</p><p>{new Date(run.startedAt).toLocaleString()} · {formatDuration(run.finishedAt - run.startedAt)} · {run.exitCode === undefined ? "Exit code not reported by the shell" : `Exit ${run.exitCode}`}</p>
        {run.environment&&<p>Environment: {run.environment}</p>}
        {run.requester && <p>Requested by {run.requester.client} · Task: {run.requester.taskName} · Request: {run.requester.requestId}</p>}
        {run.commandTruncated && <p role="status">The recorded command was truncated. Rerunning this fragment is disabled.</p>}
        {run.verificationPending ? <p role="status" aria-label="Verification freshness">Evaluating repository evidence…</p> : run.verification ? <>
          <p role="status" aria-label="Verification freshness">{run.verification.status === "matches" ? "Last comparison: repository matches checked state" : run.verification.status === "stale" ? "Stale: result does not validate the changed state" : "Freshness unknown"}</p>
          <p>{run.verification.reason}</p><p>Last compared: {new Date(run.verification.checkedAt).toLocaleString()}</p>
          <details><summary>Repository evidence</summary><p>Root: {run.verification.before.root}</p><p>Branch: {run.verification.before.branch ?? "Unborn or detached"} · HEAD: {run.verification.before.head ?? "Unborn"}</p>
            <p>Before launch: {new Date(run.verification.before.capturedAt).toLocaleString()}</p><p>{run.verification.before.files} files · {run.verification.before.bytes} bytes</p><p>SHA-256: {run.verification.before.digest}</p>
          </details>
        </> : <p role="status" aria-label="Verification freshness">No before-run repository state captured. Use Run with repository tracking for a new check.</p>}
        {run.diagnostics.truncated && <p role="status">Output or diagnostics were truncated or lost from scrollback. Results are incomplete.</p>}
        {run.diagnostics.items.length === 0 && <p role="status">No supported diagnostics found. This does not establish a clean check; review the exit status and output.</p>}
        <ul className="problem-list" aria-label="Diagnostics">{diagnostics.map((d, i) => <li key={i}>
          <strong>{d.tool} · {d.severity}{d.code ? ` ${d.code}` : ""}: {d.message}</strong>
          {d.file ? <button aria-label={`Open ${d.file}${d.line ? `:${d.line}` : ""}`} onClick={() => void open(run, d)}>{d.file}{d.line ? `:${d.line}${d.col ? `:${d.col}` : ""}` : ""}</button> : <span>No source location reported</span>}
        </li>)}</ul>
        <details><summary>Captured output</summary><pre aria-label="Captured command output">{run.output || "(No captured output)"}</pre></details>
        <div className="settings-actions"><button disabled={busy || !run.cwd || run.commandTruncated || !run.shellKind || run.shellKind === "other" || (run.shellKind === "wsl" && !run.environment?.startsWith("wsl:"))} onClick={() => onVerify(run)}>Run with repository tracking</button>
          <button disabled={busy || !paneLabels.has(run.paneId) || run.appRunId !== snapshot.runId} onClick={() => onGo(run.paneId)}>Go to command pane</button></div>
      </>}</div></div>
      <div className="settings-actions"><button disabled={busy || !runs.some((r) => r.verification)} onClick={() => { setBusy(true); void onRefresh().catch((e) => setError(String(e))).finally(() => setBusy(false)); }}>Refresh verification</button>
        <button disabled={busy || !runs.length} onClick={() => setConfirmClear(true)}>Clear command history</button></div>
      {confirmClear && <p>Clear saved command results? Running checks continue and can add new records. <button disabled={busy} onClick={() => void act("clear")}>Clear saved records</button><button disabled={busy} onClick={() => setConfirmClear(false)}>Cancel clearing</button></p>}
    </section>
  </div>;
}
