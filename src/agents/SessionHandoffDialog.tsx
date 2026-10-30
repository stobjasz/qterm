import {useRef,useState} from "react";
import {writeText} from "@tauri-apps/plugin-clipboard-manager";
import {createAgentBrief,type AgentProvider,type LibraryEntry,type Profile} from "../ipc";
import type {CommandRun} from "../problems/runs";
import {useModalFocus} from "../tabs/useModalFocus";
import {sessionHandoffText,type SessionHandoffDraft} from "./sessionHandoff";
import {environmentLabel} from "./library";
interface Props{source:LibraryEntry;enabled:boolean;profiles:Profile[];checks:CommandRun[];onValidate:()=>Promise<void>;onSend:(provider:AgentProvider,profileId:string,text:string)=>Promise<void>;onClose:()=>void}
export function SessionHandoffDialog({source,enabled,profiles,checks,onValidate,onSend,onClose}:Props){
  const root=useRef<HTMLElement>(null);useModalFocus(root);
  const [draft,setDraft]=useState<SessionHandoffDraft>({goals:"Continue the task using this reviewed context.",findings:"",files:"",nextSteps:"Review the findings and identify the next action.",includeExcerpt:false});
  const [ids,setIds]=useState<string[]>([]),[provider,setProvider]=useState<AgentProvider>(source.provider),[profile,setProfile]=useState(profiles.find(p=>p.id===source.profileId)?.id??profiles[0]?.id??""),[consent,setConsent]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState<string>(),[copied,setCopied]=useState(false),[exported,setExported]=useState<string>();
  const selected=checks.filter(run=>ids.includes(run.id)),text=sessionHandoffText(source,draft,selected),bytes=new TextEncoder().encode(text).length;
  const change=<K extends keyof SessionHandoffDraft>(field:K,value:SessionHandoffDraft[K])=>{setDraft(current=>({...current,[field]:value}));setConsent(false);setCopied(false);setExported(undefined);};
  const perform=async(fn:()=>Promise<void>)=>{setBusy(true);setError(undefined);try{await fn();}catch(e){setError(String(e));}finally{setBusy(false);}};
  const allowed=enabled&&bytes<=131072;
  return <div className="palette-backdrop" onMouseDown={e=>e.target===e.currentTarget&&!busy&&onClose()}><section ref={root} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Session handoff" className="palette agent-handoff session-handoff" onKeyDown={e=>{e.stopPropagation();if(e.key==="Escape"&&!busy){e.preventDefault();onClose();}}}>
    <div className="inbox-heading"><h2>Session handoff</h2><button disabled={busy} onClick={onClose}>Close session handoff</button></div>
    {!enabled?<p>Source history is disabled or its settings changed. Enable and refresh the source, then review it again before sharing.</p>:<><p>{source.provider} · {environmentLabel(source.environment)} · {source.id}</p><p>{source.cwd} · Reported branch: {source.branch??"Unknown"}</p>
      <p>Review every field before exporting or sharing. No conversation is synchronized automatically. Fields are limited to 4000 characters; saved check excerpts to 2000 each.</p>
      {([['goals','Goals'],['findings','Findings'],['files','Files'],['nextSteps','Next steps']] as const).map(([key,label])=><label key={key}>{label}<textarea aria-label={`Handoff ${label.toLowerCase()}`} value={draft[key]} maxLength={4000} disabled={busy} onChange={e=>change(key,e.target.value)}/></label>)}
      <label className="handoff-inline"><input type="checkbox" checked={draft.includeExcerpt} disabled={busy} onChange={e=>change("includeExcerpt",e.target.checked)}/>Include the latest source user prompt excerpt</label>
      <details><summary>Attach saved checks (up to five)</summary><p>These are historical results from their displayed folders. Selecting one does not run a check or verify the current checkout.</p>{checks.map(run=><label className="handoff-inline" key={run.id}><input type="checkbox" aria-label={`Attach check ${run.command} from ${run.cwd??"unknown folder"}`} disabled={busy||(!ids.includes(run.id)&&ids.length>=5)} checked={ids.includes(run.id)} onChange={e=>{setIds(current=>e.target.checked?[...current,run.id]:current.filter(id=>id!==run.id));setConsent(false);setExported(undefined);}}/>{run.command} · {run.cwd??"Folder unknown"} · Exit {run.exitCode??"unknown"} · {new Date(run.finishedAt).toLocaleString()}</label>)}</details>
      <div className="handoff-choices"><label>Destination provider<select aria-label="Session handoff provider" value={provider} disabled={busy} onChange={e=>{setProvider(e.target.value as AgentProvider);setConsent(false);}}><option value="claude">Claude</option><option value="codex">Codex</option></select></label><label>Shell<select aria-label="Session handoff shell" value={profile} disabled={busy} onChange={e=>{setProfile(e.target.value);setConsent(false);}}>{profiles.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label></div>
      <label className="handoff-inline"><input type="checkbox" checked={consent} disabled={busy} onChange={e=>setConsent(e.target.checked)}/>Share this reviewed handoff with {provider} in a new tab</label>
      <pre className="handoff-preview" aria-label="Session handoff preview">{text}</pre><p>{bytes} / 131072 UTF-8 bytes. Exported cache files are retained for up to seven days; copy the file elsewhere to keep it.</p>
      {bytes>131072&&<p role="alert">This handoff exceeds 128 KiB. Shorten fields or remove attached checks.</p>}
      {exported&&<p>Exported handoff file: <code aria-label="Exported session handoff file">{exported}</code></p>}
      <div className="settings-actions"><button disabled={busy||!allowed} onClick={()=>void perform(async()=>{await onValidate();await writeText(text);setCopied(true);})}>{copied?"Session handoff copied":"Copy session handoff"}</button><button disabled={busy||!allowed} onClick={()=>void perform(async()=>{await onValidate();setExported((await createAgentBrief(text)).path);})}>Export handoff file</button><button disabled={busy||!allowed||!consent||!profile||!draft.goals.trim()} onClick={()=>void perform(()=>onSend(provider,profile,text))}>Open agent with session handoff</button></div>
    </>}
    {error&&<p role="alert">{error}</p>}
  </section></div>;
}
