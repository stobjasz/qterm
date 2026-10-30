import { useRef, useState } from "react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import type { AgentProvider, Profile } from "../ipc";
import { briefText, MAX_OUTPUT, type HandoffContext } from "./handoff";
import { useModalFocus } from "../tabs/useModalFocus";
import {environmentLabel} from "./library";

interface Props {
  context: HandoffContext;
  sourceProfileId: string;
  profiles: Profile[];
  onSend(provider: AgentProvider, profileId: string, where: "new" | "current", text: string): Promise<void>;
  onCancel(): void;
}

export function HandoffDialog({ context, sourceProfileId, profiles, onSend, onCancel }: Props) {
  const root = useRef<HTMLElement>(null);
  useModalFocus(root);
  const [provider, setProvider] = useState<AgentProvider>("codex");
  const [profile, setProfile] = useState(profiles.find((p) => p.id === sourceProfileId)?.id ?? profiles[0]?.id ?? "");
  const [where, setWhere] = useState<"new" | "current">("new");
  const [request, setRequest] = useState("Explain the failure and suggest the smallest fix. Ask before changing files.");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string>();
  const [copied, setCopied] = useState(false);
  const text = briefText(context, request);
  const send = async () => {
    setSending(true); setError(undefined);
    try { await onSend(provider, profile, where, text); }
    catch (e) { setError(String(e)); }
    finally { setSending(false); }
  };
  return <div className="palette-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !sending && onCancel()}>
    <section ref={root} tabIndex={-1} className="palette agent-handoff" role="dialog" aria-modal="true" aria-label="Send output to an agent"
      onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Escape" && !sending) { e.preventDefault(); onCancel(); } }}>
      <h2>Send output to an agent</h2>
      <p>The agent receives a local brief containing the request and context below. Review it before opening a session.</p>
      <label>Request<textarea aria-label="Agent request" autoFocus disabled={sending} maxLength={8000} value={request} onChange={(e) => { setRequest(e.target.value); setCopied(false); }} /></label>
      <div className="handoff-choices">
        <label>Agent<select aria-label="Agent provider" disabled={sending} value={provider} onChange={(e) => setProvider(e.target.value as AgentProvider)}><option value="codex">Codex</option><option value="claude">Claude Code</option></select></label>
        <label>Shell<select aria-label="Agent shell" disabled={sending} value={profile} onChange={(e) => { setProfile(e.target.value); setWhere("new"); }}>{profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label>Destination<select aria-label="Agent destination" disabled={sending} value={where} onChange={(e) => setWhere(e.target.value as "new" | "current")}>
          <option value="new">New tab</option><option value="current" disabled={profile !== sourceProfileId}>Source shell pane, if idle</option>
        </select></label>
      </div>
      <p className="settings-hint">Folder: {context.cwd ?? "Not reported; the shell's default folder will be used."}{context.environment?` · ${environmentLabel(context.environment)}`:""}{context.exitCode !== undefined ? ` · Exit ${context.exitCode}` : ""}
        {context.output.length > MAX_OUTPUT ? ` · Output truncated to ${MAX_OUTPUT} characters.` : ""}</p>
      <pre className="handoff-preview" aria-label="Agent brief preview">{text}</pre>
      {error && <p role="alert">Could not open the agent: {error}</p>}
      <div className="settings-actions">
        <button disabled={sending} onClick={onCancel}>Cancel</button>
        <button disabled={sending} onClick={() => void writeText(text).then(() => setCopied(true), (e) => setError(String(e)))}>{copied ? "Brief copied" : "Copy brief"}</button>
        <button className="primary" disabled={sending || !profile || !request.trim()} onClick={() => void send()}>{sending ? "Opening…" : "Open agent with brief"}</button>
      </div>
    </section>
  </div>;
}
