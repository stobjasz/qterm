import { useEffect, useRef, useState } from "react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { cancelAgentAccessReview, reviewAgentAccess, type AgentAccessReview, type AgentAccessSnapshot, type Profile, type AgentInvocation } from "../ipc";
import { useModalFocus } from "../tabs/useModalFocus";
import { profileSupportsEnvironment } from "./environments";

interface Props { cwd?: string; environment?:string; profiles: Profile[]; profileId?: string; snapshot: AgentAccessSnapshot; error?: string; recordedIds: ReadonlySet<string>; onGrant(review: string, client: string, taskIds?: string[]): Promise<unknown>; onRevoke(id: string): Promise<unknown>; onStop(job: AgentInvocation): Promise<void>; onGo(paneId: string): void; onInspect(job: AgentInvocation): void; onClose(): void }
export function AgentAccessPanel({ cwd, environment:initialEnvironment,profiles, profileId, snapshot, error: loadError, recordedIds, onGrant, onRevoke, onStop, onGo, onInspect, onClose }: Props) {
  const root = useRef<HTMLElement>(null); useModalFocus(root);
  const [folder, setFolder] = useState(cwd ?? ""); const [client, setClient] = useState("Local coding agent"); const [review, setReview] = useState<AgentAccessReview>();
  const [execution, setExecution] = useState(false); const [shell, setShell] = useState(profiles.find((p) => p.id === profileId)?.id ?? profiles[0]?.id ?? "");
  const [environment,setEnvironment]=useState(initialEnvironment??"native");
  const environments=Array.from(new Set(["native",environment,...profiles.flatMap(p=>p.distribution?[`wsl:${p.distribution.toLowerCase()}`]:[])]));
  const shells=profiles.filter(p=>profileSupportsEnvironment(environment,p));
  const selectedShell=shells.find(p=>p.id===shell)?.id??shells[0]?.id??"";
  const [selected, setSelected] = useState<string[]>([]); const [executeConsent, setExecuteConsent] = useState(false);
  const latest = useRef(review); latest.current = review;
  useEffect(() => () => { if (latest.current) void cancelAgentAccessReview(latest.current.id).catch(() => {}); }, []);
  const [consent, setConsent] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState<string>(); const [copied, setCopied] = useState<string>();
  const perform = async (fn: () => Promise<unknown>) => { setBusy(true); setError(undefined); try { await fn(); } catch (e) { setError(String(e)); } finally { setBusy(false); } };
  return <div className="palette-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
    <section ref={root} tabIndex={-1} className="palette agent-handoff agent-access" role="dialog" aria-modal="true" aria-label="Agent access" onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Escape" && !busy) { e.preventDefault(); onClose(); } }}>
      <div className="inbox-heading"><h2>Agent access</h2><button disabled={busy} onClick={onClose}>Close agent access</button></div>
      <p role="status">{snapshot.listening ? `${snapshot.grants.length} session grant${snapshot.grants.length === 1 ? "" : "s"} active` : "Agent access is off"}</p>
      <p>Grant a local client access to one project in the selected environment. Read access covers panes, saved command results and task definitions. You can separately allow reviewed named tasks in new tabs. Grants expire when qterm exits.</p>
      {(error || loadError) && <p role="alert">{error || loadError}</p>}
      {!review ? <form onSubmit={(e) => { e.preventDefault(); void perform(async () => { setReview(await reviewAgentAccess(folder, execution ? selectedShell : undefined,environment)); setConsent(false); setSelected([]); setExecuteConsent(false); }); }}>
        <label>Project environment<select aria-label="Agent access environment" disabled={busy} value={environment} onChange={e=>setEnvironment(e.target.value)}>{environments.map(env=><option key={env} value={env}>{env==="native"?"Windows":env}</option>)}</select></label>
        <label>Project folder<input aria-label="Agent access project folder" disabled={busy} value={folder} onChange={(e) => setFolder(e.target.value)} required /></label>
        <label>Client label<input aria-label="Agent access client label" disabled={busy} value={client} maxLength={128} onChange={(e) => setClient(e.target.value)} required /></label>
        <label className="agent-access-consent"><input type="checkbox" checked={execution} disabled={busy} onChange={(e) => setExecution(e.target.checked)} />Review named-task execution too</label>
        {execution && <label>Task execution shell<select aria-label="Task execution shell" disabled={busy} value={selectedShell} onChange={(e) => setShell(e.target.value)}>{shells.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>}
        <button type="submit" disabled={busy || !folder.trim() || !client.trim() || (execution&&!selectedShell)}>Review project access</button>
      </form> : <div aria-label="Agent access review"><p>Client: {client}</p><p>Environment: {review.environment}</p><p>Canonical project: {review.project}</p>
        <p>Saved output can contain source code or secrets. The connection file authorizes its holder; other programs running as your Windows user can read it.</p>
        <label className="agent-access-consent"><input type="checkbox" checked={consent} disabled={busy} onChange={(e) => setConsent(e.target.checked)} />Allow read access to this project for this qterm session</label>
        {review.execution && <section aria-label="Named-task execution review"><h3>Named tasks · {review.execution.profileName}</h3><p>Only selected commands can be requested. A changed manifest, launch command, directory or configured shell invalidates execution. Task tabs reserve input until launch or cancellation.</p>
          {review.execution.tasks.map((task) => <div key={task.id} className="agent-access-grant"><label className="agent-access-consent"><input type="checkbox" disabled={busy} checked={selected.includes(task.id)} onChange={(e) => { setSelected((current) => e.target.checked ? [...current, task.id] : current.filter((id) => id !== task.id)); setExecuteConsent(false); }} />Allow task {task.name} from {task.source}</label><p>{task.directory}</p><pre>{task.command}</pre><p>Manifest SHA-256: {task.manifestDigest}</p></div>)}
          {review.execution.manifests.map((m) => <details key={m.path}><summary>Review manifest: {m.path}</summary><pre className="handoff-preview">{m.preview}</pre>{m.truncated && <p>Manifest preview truncated to 16000 characters. Inspect the full source file before granting it.</p>}</details>)}
          <label className="agent-access-consent"><input type="checkbox" disabled={busy || !selected.length} checked={executeConsent} onChange={(e) => setExecuteConsent(e.target.checked)} />Allow the selected named tasks to run in new tabs for this qterm session</label>
        </section>}
        <div className="settings-actions"><button disabled={busy} onClick={() => { void cancelAgentAccessReview(review.id).catch(() => {}); setReview(undefined); setConsent(false); }}>Edit project access</button><button disabled={busy || !consent || (!!selected.length && !executeConsent)} onClick={() => void perform(async () => { await onGrant(review.id, client, selected); setReview(undefined); setConsent(false); setSelected([]); setExecuteConsent(false); })}>{selected.length ? "Create session task grant" : "Create session read grant"}</button></div>
      </div>}
      <div role="list" aria-label="Active agent grants">{snapshot.grants.map((grant) => <div role="listitem" key={grant.id} className="agent-access-grant"><h3>{grant.client}</h3><p>Environment: {grant.environment}</p><p>{grant.project}</p><p>Read panes, saved command results and task definitions · Expires when qterm exits</p>
        {grant.tasks.length > 0 && <><p>Named tasks allowed in shell {profiles.find((p) => p.id === grant.profileId)?.name ?? grant.profileId}:</p><ul>{grant.tasks.map((task) => <li key={task.id}>{task.name} · {task.source}<pre>{task.command}</pre><span>{task.directory}</span></li>)}</ul></>}
        <p>Connection file: <code aria-label={`Connection file for ${grant.client}`}>{grant.connectionFile}</code></p>
        <div className="settings-actions"><button disabled={busy} onClick={() => void perform(async () => { await writeText(grant.connectionFile); setCopied(grant.id); })}>{copied === grant.id ? "Connection path copied" : `Copy connection path for ${grant.client}`}</button><button disabled={busy} onClick={() => void perform(() => onRevoke(grant.id))}>Revoke access for {grant.client}</button></div>
      </div>)}</div>
      {snapshot.invocations.length > 0 && <section aria-label="Requested agent tasks"><h3>Requested tasks</h3>{snapshot.invocations.map((job) => <div key={job.id} className="agent-access-grant" aria-label={`Task run ${job.requester.requestId}`}><h4>{job.requester.client} · {job.task.name}</h4><p aria-label="Task run state">{job.state}{job.exitCode !== null ? ` · Exit ${job.exitCode}` : ""}</p><p>{job.task.directory}</p><p>Run: {job.id} · Request: {job.requester.requestId}</p>{job.error && <p>{job.error}</p>}{job.evidenceWarning && <p>Repository evidence unavailable: {job.evidenceWarning}</p>}
        <div className="settings-actions">{job.paneId && <button onClick={() => onGo(job.paneId!)}>Go to task pane</button>}<button disabled={!recordedIds.has(job.id)} onClick={() => onInspect(job)}>Inspect task result</button>{["queued", "launching", "running", "stopping", "unknown"].includes(job.state) && <button disabled={busy} onClick={() => void perform(() => onStop(job))}>Stop task {job.requester.requestId}</button>}</div></div>)}</section>}
      <details><summary>Use the local CLI</summary><p>Run this qterm executable with <code>--agent-client &lt;connection-file&gt; &lt;method&gt; [JSON-parameters]</code>. Read JSON from stdout; errors return a nonzero exit code. Pipe stdout when invoking a Windows GUI executable from PowerShell.</p><p>Executable: <code>{snapshot.executable}</code></p><p>Methods: <code>panes.list</code>, <code>commands.list</code>, <code>commands.result</code>, <code>tasks.list</code>, <code>tasks.run</code>, <code>tasks.status</code>. Launch uses a granted <code>taskId</code> and a stable client <code>requestId</code>; retrying the same ID returns the same run. No method accepts shell commands or terminal keystrokes.</p></details>
    </section>
  </div>;
}
