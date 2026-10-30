import { useEffect, useRef, useState } from "react";
import { cancelWorktreePreview, previewWorktreeTask, worktreeTaskDetails, type Profile, type WorktreeDetails, type WorktreeDraft, type WorktreePreview, type WorktreeSnapshot, type WorktreeTask } from "../ipc";
import type { CommandRun } from "../problems/runs";
import { useModalFocus } from "../tabs/useModalFocus";
import { worktreeRuns } from "./worktreeRuns";

interface Props {
  cwd?: string; profileId?: string; profiles: Profile[]; snapshot: WorktreeSnapshot; saveError?: string | null; runs: readonly CommandRun[];
  onCreate(token: string): Promise<WorktreeSnapshot>;
  onAction(action: "retry" | "recover" | "complete" | "reopen", taskId?: string): Promise<unknown>;
  onOpen(task: WorktreeTask, agent: boolean): Promise<void>;
  onInspect(run: CommandRun): void; onClose(): void;
}
export function WorktreePanel({ cwd, profileId, profiles, snapshot, saveError, runs, onCreate, onAction, onOpen, onInspect, onClose }: Props) {
  const root = useRef<HTMLElement>(null); useModalFocus(root);
  const [draft, setDraft] = useState<WorktreeDraft>({ cwd: cwd ?? "", title: "", request: "", branch: "", base: "HEAD", directory: "", provider: "codex", profileId: profiles.find((p) => p.id === profileId)?.id ?? profiles[0]?.id ?? "" });
  const [form, setForm] = useState(false); const [preview, setPreview] = useState<WorktreePreview>();
  const previewRef = useRef(preview); previewRef.current = preview;
  useEffect(() => () => { if (previewRef.current) void cancelWorktreePreview(previewRef.current.token).catch(() => {}); }, []);
  const [selected, setSelected] = useState<string>(); const [busy, setBusy] = useState(false); const [error, setError] = useState<string>(); const [recover, setRecover] = useState(false);
  const task = snapshot.tasks.find((t) => t.id === selected) ?? snapshot.tasks[0];
  const perform = async (fn: () => Promise<unknown>) => { setBusy(true); setError(undefined); try { await fn(); } catch (e) { setError(String(e)); } finally { setBusy(false); } };
  const edit = (key: keyof WorktreeDraft, value: string) => setDraft((d) => ({ ...d, [key]: value }));
  return <div className="palette-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
    <section ref={root} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Worktree tasks" className="palette problems-panel worktree-panel" onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Escape" && !busy) { e.preventDefault(); onClose(); } }}>
      <div className="inbox-heading"><h2>Worktree tasks</h2><button disabled={busy} onClick={onClose}>Close worktree tasks</button></div>
      <p>Create a separate checkout on a new branch, then open a shell or an agent with a reviewed request. Source edits stay in the source checkout.</p>
      {(error || saveError) && <div role="alert"><p>{error || saveError}</p>{saveError && <button disabled={busy} onClick={() => void perform(() => onAction("retry"))}>Retry worktree save</button>}
        {snapshot.recoveryRequired && <><button disabled={busy} onClick={() => setRecover(true)}>Recover worktree history</button>{recover && <p>Preserve unreadable history as a backup before starting fresh. <button disabled={busy} onClick={() => void perform(async () => { await onAction("recover"); setRecover(false); })}>Keep backup and recover worktree history</button><button onClick={() => setRecover(false)}>Cancel recovery</button></p>}</>}
      </div>}
      {snapshot.backupPath && <p>Original worktree history preserved at {snapshot.backupPath}</p>}
      {!form ? <button disabled={busy || !!saveError} onClick={() => setForm(true)}>New worktree task</button> : !preview ? <form className="worktree-form" onSubmit={(e) => { e.preventDefault(); void perform(async () => setPreview(await previewWorktreeTask(draft))); }}>
        <label>Source folder<input aria-label="Worktree source folder" value={draft.cwd} onChange={(e) => edit("cwd", e.target.value)} disabled={busy} required /></label>
        <label>Task title<input aria-label="Worktree task title" value={draft.title} onChange={(e) => edit("title", e.target.value)} maxLength={200} disabled={busy} required /></label>
        <label>Base revision<input aria-label="Worktree base revision" value={draft.base} onChange={(e) => edit("base", e.target.value)} disabled={busy} required /></label>
        <label>New branch<input aria-label="Worktree new branch" value={draft.branch} onChange={(e) => edit("branch", e.target.value)} disabled={busy} required /></label>
        <label>New directory (existing parent)<input aria-label="Worktree new directory" value={draft.directory} onChange={(e) => edit("directory", e.target.value)} disabled={busy} required /></label>
        <label>Agent<select aria-label="Worktree agent" value={draft.provider} onChange={(e) => edit("provider", e.target.value)} disabled={busy}><option value="codex">Codex</option><option value="claude">Claude Code</option><option value="shell">Shell only</option></select></label>
        <label>Shell<select aria-label="Worktree shell" value={draft.profileId} onChange={(e) => edit("profileId", e.target.value)} disabled={busy}>{profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label className="worktree-request">Request<textarea aria-label="Worktree task request" value={draft.request} onChange={(e) => edit("request", e.target.value)} maxLength={8000} disabled={busy} required /></label>
        <div className="settings-actions"><button type="button" disabled={busy} onClick={() => setForm(false)}>Cancel new task</button><button type="submit" disabled={busy || !draft.profileId}>Preview worktree task</button></div>
      </form> : <div aria-label="Worktree creation preview">
        <h3>{preview.task.title}</h3><p>Repository: {preview.task.repository}</p><p>Base: {preview.task.base} at {preview.task.commit}</p><p>New branch: {preview.task.branch}</p><p>New directory: {preview.task.directory}</p>
        <p>Agent: {preview.task.provider} · Shell: {profiles.find((p) => p.id === preview.task.profileId)?.name ?? "Unavailable"}</p><pre className="handoff-preview">{preview.task.request}</pre>
        {preview.sourceDirty && <p role="status">The source checkout has local changes. They stay there and are not copied into the new worktree.</p>}
        <p>Creation uses the reviewed commit with Git hooks and checkout filters disabled. Filter-managed files may remain pointers. No dependencies are installed. Opening the agent is a separate action after creation.</p>
        <div className="settings-actions"><button disabled={busy} onClick={() => { void cancelWorktreePreview(preview.token).catch(() => {}); setPreview(undefined); }}>Edit task</button><button disabled={busy || !!saveError} onClick={() => void perform(async () => { const value = await onCreate(preview.token); setSelected(preview.task.id); setPreview(undefined); setForm(false); if (value.error) setError(value.error); })}>{busy ? "Creating worktree…" : "Create reviewed worktree"}</button></div>
      </div>}
      {!form && <div className="inbox-content"><div className="inbox-list" role="list" aria-label="Saved worktree tasks">{snapshot.tasks.length === 0 && <p>No worktree tasks yet.</p>}{snapshot.tasks.map((t) => <div role="listitem" key={t.id}><button disabled={busy} aria-label={`Inspect worktree task: ${t.title}`} className={`inbox-event${t.id === task?.id ? " selected" : ""}`} onClick={() => { setSelected(t.id); setError(undefined); }}><strong>{t.title}</strong><span>{t.branch} · {t.status}</span><span>{t.directory}</span></button></div>)}</div>
        <div className="inbox-detail">{task && <TaskDetail key={`${task.id}:${snapshot.revision}`} task={task} runs={runs} busy={busy} perform={perform} onOpen={onOpen} onAction={onAction} onInspect={onInspect} />}</div></div>}
    </section>
  </div>;
}
function TaskDetail({ task, runs, busy, perform, onOpen, onAction, onInspect }: { task: WorktreeTask; runs: readonly CommandRun[]; busy: boolean; perform(fn: () => Promise<unknown>): Promise<void>; onOpen: Props["onOpen"]; onAction: Props["onAction"]; onInspect: Props["onInspect"] }) {
  const [details, setDetails] = useState<WorktreeDetails>(); const [error, setError] = useState<string>();
  const refresh = async () => { try { setDetails(await worktreeTaskDetails(task.id)); setError(undefined); } catch (e) { setDetails(undefined); setError(String(e)); } };
  useEffect(() => { let active = true; void worktreeTaskDetails(task.id).then((d) => active && setDetails(d), (e) => active && setError(String(e))); return () => { active = false; }; }, [task.id]);
  const associated = worktreeRuns(task.directory, task.createdAt, runs);
  return <div aria-label="Worktree task details"><h3>{task.title}</h3><p>{task.status} · {task.provider}</p><p>{task.directory}</p><p>Source: {task.repository}</p><p>Created from {task.base} at {task.commit}</p><pre className="handoff-preview">{task.request}</pre>
    {task.error && <p role="alert">{task.error}</p>}{error && <p role="status">Worktree inspection unavailable: {error}</p>}
    {details && <><p role="status" aria-label="Worktree change summary">{details.branch} · {details.changed} changed · {details.untracked} untracked · {details.commits} commits after the task base</p><p>HEAD: {details.head}</p><pre aria-label="Worktree diff summary">{details.summary || "No tracked differences from the task base."}</pre>{details.summaryTruncated && <p role="status">Tracked diff summary truncated to 12000 characters.</p>}</>}
    <div className="settings-actions"><button disabled={busy} onClick={() => void perform(refresh)}>Refresh worktree</button><button disabled={busy || !details} onClick={() => void perform(() => onOpen(task, false))}>Open worktree shell</button>{task.provider !== "shell" && <button disabled={busy || !details || task.status === "failed"} onClick={() => void perform(() => onOpen(task, true))}>Open task agent</button>}
      {(task.status === "active" || task.status === "completed") && <button disabled={busy} onClick={() => void perform(() => onAction(task.status === "active" ? "complete" : "reopen", task.id))}>{task.status === "active" ? "Mark task completed" : "Reopen task"}</button>}</div>
    <p>Completing a task changes its label only. Branches, files and running programs are preserved.</p>
    <h4>Saved command runs in this folder</h4>{associated.length === 0 && <p>No retained command runs in this worktree yet.</p>}{associated.map((r) => <button key={r.id} className="inbox-event" onClick={() => onInspect(r)}><strong>{r.command}</strong><span>{r.exitCode === undefined ? "Exit unknown" : `Exit ${r.exitCode}`} · {r.verification?.status ?? "No repository evidence"}</span></button>)}
  </div>;
}
