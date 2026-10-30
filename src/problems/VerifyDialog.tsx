import { useRef, useState } from "react";
import { useModalFocus } from "../tabs/useModalFocus";
import type { CommandRun } from "./runs";

export function VerifyDialog({ run, shell, onRun, onClose }: { run: CommandRun; shell: string; onRun(): Promise<void>; onClose(): void }) {
  const root = useRef<HTMLElement>(null); useModalFocus(root);
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string>();
  return <div className="palette-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
    <section ref={root} tabIndex={-1} className="palette agent-handoff" role="dialog" aria-modal="true" aria-label="Run with repository tracking" onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Escape" && !busy) { e.preventDefault(); onClose(); } }}>
      <h2>Run with repository tracking</h2><p>This reruns the shell command below in a new {shell} tab. Review it before running.</p>
      <p>Folder: {run.cwd ?? "Not reported"}</p><pre aria-label="Verification command" className="handoff-preview">{run.command}</pre>
      <p>qterm captures repository files and Git state before launch, then watches for edits during the check. Ignored files, external dependencies and environment are outside this evidence. A previous exit code does not validate later edits.</p>
      {error && <p role="alert">{error}</p>}
      <div className="settings-actions"><button disabled={busy} onClick={onClose}>Cancel verification</button><button disabled={busy || !run.cwd} className="primary" onClick={() => {
        setBusy(true); setError(undefined); void onRun().catch((e) => setError(String(e))).finally(() => setBusy(false));
      }}>{busy ? "Capturing repository state…" : "Run reviewed command"}</button></div>
    </section>
  </div>;
}
