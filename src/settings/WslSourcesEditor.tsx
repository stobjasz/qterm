import {useState} from "react";
import {wslDistributions,type WslSource} from "../ipc";
export function WslSourcesEditor({sources,onChange}:{sources:WslSource[];onChange:(sources:WslSource[])=>void}){
  const [installed,setInstalled]=useState<string[]>(),[error,setError]=useState<string>(),[busy,setBusy]=useState(false);
  const update=(index:number,change:Partial<WslSource>)=>onChange(sources.map((source,i)=>i===index?{...source,...change}:source));
  return <>
    <p>Transcript discovery is off until enabled for a named distribution and refreshed in Sessions. Provider history settings are additional gates. These controls do not install hooks or change provider files.</p>
    <button type="button" disabled={busy} onClick={()=>{setBusy(true);setError(undefined);void wslDistributions().then(setInstalled,e=>setError(String(e))).finally(()=>setBusy(false));}}>List installed WSL distributions</button>
    {installed&&<p>Installed distributions: {installed.join(", ")||"none"}</p>}{error&&<p role="alert">{error}</p>}
    {sources.map((source,index)=><fieldset key={index} style={{minWidth:0,margin:"12px 0",padding:10,border:"1px solid var(--line)",borderRadius:4,display:"flex",flexDirection:"column",gap:10}}><legend>WSL source {index+1}</legend>
      <label className="settings-field"><span className="settings-label">Distribution name</span><input type="text" spellCheck={false} aria-label={`WSL source ${index+1} distribution`} value={source.distribution} onChange={e=>update(index,{distribution:e.target.value})}/></label>
      <label className="settings-toggle"><input type="checkbox" checked={source.enabled} onChange={e=>update(index,{enabled:e.target.checked})}/><span>Enable discovery for this WSL source</span></label>
      <label className="settings-field"><span className="settings-label">Claude home in Linux</span><input type="text" spellCheck={false} aria-label={`WSL source ${index+1} Claude home`} placeholder="Distro default" value={source.claudeHome} onChange={e=>update(index,{claudeHome:e.target.value})}/></label>
      <label className="settings-field"><span className="settings-label">Codex home in Linux</span><input type="text" spellCheck={false} aria-label={`WSL source ${index+1} Codex home`} placeholder="Distro default" value={source.codexHome} onChange={e=>update(index,{codexHome:e.target.value})}/></label>
      <p className="settings-hint">Use absolute Linux paths, or leave homes empty. Shell startup files are not sourced to resolve homes.</p>
      <button type="button" onClick={()=>onChange(sources.filter((_,i)=>i!==index))}>Remove WSL source {index+1}</button>
    </fieldset>)}
    <button type="button" disabled={sources.length>=16} onClick={()=>onChange([...sources,{distribution:"",enabled:false,claudeHome:"",codexHome:""}])}>Add WSL source</button>
  </>;
}
