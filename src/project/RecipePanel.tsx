import {useEffect,useRef,useState} from "react";
import {cancelRecipeReview,reviewRecipes,type Profile,type RecipeReview,type RecipeRun} from "../ipc";
import {useModalFocus} from "../tabs/useModalFocus";
import {recipeActive} from "./useRecipeRuns";
interface Props{cwd?:string;profiles:Profile[];profileId?:string;runs:RecipeRun[];error?:string;onLaunch:(review:RecipeReview,name:string)=>Promise<void>;onCancel:(id:string)=>Promise<void>;onStop:(run:RecipeRun)=>Promise<void>;onClose:()=>void;onGo:(pane:string)=>void;onInspect:(id:string)=>void;recordedIds:ReadonlySet<string>}
export function RecipePanel(props:Props){
  const root=useRef<HTMLElement>(null);useModalFocus(root);
  const [folder,setFolder]=useState(props.cwd??""),[shell,setShell]=useState(props.profiles.find(p=>p.id===props.profileId)?.id??props.profiles[0]?.id??"");
  const [review,setReview]=useState<RecipeReview>(),[name,setName]=useState(""),[consent,setConsent]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState<string>();
  const latest=useRef(review);latest.current=review;useEffect(()=>()=>{if(latest.current)void cancelRecipeReview(latest.current.id).catch(()=>{});},[]);
  const perform=async(fn:()=>Promise<void>)=>{setBusy(true);setError(undefined);try{await fn();}catch(e){setError(String(e));}finally{setBusy(false);}};
  const recipe=review?.recipes.find(r=>r.name===name);
  return <div className="palette-backdrop" onMouseDown={e=>e.target===e.currentTarget && !busy && props.onClose()}><section ref={root} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Workflow recipes" className="palette agent-handoff agent-access recipe-panel" onKeyDown={e=>{e.stopPropagation();if(e.key==="Escape" && !busy){e.preventDefault();props.onClose();}}}>
    <div className="inbox-heading"><h2>Workflow recipes</h2><button disabled={busy} onClick={props.onClose}>Close recipes</button></div>
    <p>Review a project's versioned .qterm.toml workflow, then launch it once. Restoring a workspace never replays its commands.</p>
    {(error??props.error) && <p role="alert">{error??props.error}</p>}
    {!review?<form onSubmit={e=>{e.preventDefault();void perform(async()=>{const next=await reviewRecipes(folder,shell);setReview(next);setName(next.recipes[0]?.name??"");setConsent(false);});}}>
      <label>Project folder<input aria-label="Recipe project folder" value={folder} disabled={busy} onChange={e=>setFolder(e.target.value)} required/></label>
      <label>Shell<select aria-label="Recipe shell" value={shell} disabled={busy} onChange={e=>setShell(e.target.value)}>{props.profiles.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label><button disabled={busy||!folder.trim()||!shell}>Review recipes</button>
    </form>:<section aria-label="Workflow launch review"><p>{review.source}</p><p>Project: {review.project} · Shell: {review.profileName}</p><p>Environment: {review.environment}</p><p>Source SHA-256: {review.digest}</p><label>Workflow<select aria-label="Workflow to launch" value={name} disabled={busy} onChange={e=>{setName(e.target.value);setConsent(false);}}>{review.recipes.map(r=><option key={r.name}>{r.name}</option>)}</select></label>
      <p>Layout: {recipe?.layout}. Each step starts at an empty prompt in a new reserved pane.</p>
      {recipe?.steps.map(step=><div className="agent-access-grant" key={step.name}><h3>{step.name}</h3><pre>{step.command}</pre><p>{step.directory}</p><p>After: {step.dependsOn.join(", ")||"none"} · Ready: {step.readyOutput?`literal output “${step.readyOutput}”`:"confirmed exit 0"} · Deadline: {step.timeoutSeconds}s</p></div>)}
      <p>Output markers are the program's own readiness claim. A timeout blocks pending dependents; running programs remain available for explicit Stop.</p>
      <label className="agent-access-consent"><input type="checkbox" disabled={busy} checked={consent} onChange={e=>setConsent(e.target.checked)}/>Run these reviewed commands once in new workflow panes</label>
      <div className="settings-actions"><button disabled={busy} onClick={()=>{void cancelRecipeReview(review.id);setReview(undefined);setConsent(false);}}>Edit recipe review</button><button disabled={busy||!consent||!recipe} onClick={()=>void perform(async()=>{await props.onLaunch(review,name);setReview(undefined);setConsent(false);})}>Launch reviewed workflow</button></div>
    </section>}
    <section aria-label="Workflow runs">{props.runs.map(run=><div key={run.id} className="agent-access-grant" aria-label={`Workflow run ${run.name}`}><h3>{run.name}</h3><p>{run.project}</p><p>Run: {run.id}</p><div className="settings-actions"><button disabled={busy||!run.steps.some(s=>s.state==="pending")} onClick={()=>void perform(()=>props.onCancel(run.id))}>Cancel pending steps</button><button disabled={busy||!run.steps.some(recipeActive)} onClick={()=>void perform(()=>props.onStop(run))}>Stop workflow</button></div>
      {run.steps.map(step=><div key={step.id} aria-label={`Workflow step ${step.name}`}><h4>{step.name} · <span aria-label="Recipe step state">{step.state}</span>{step.exitCode!==null?` · Exit ${step.exitCode}`:""}</h4>{step.error&&<p>{step.error}</p>}{step.evidenceWarning&&<p>Repository evidence unavailable: {step.evidenceWarning}</p>}<div className="settings-actions"><button onClick={()=>props.onGo(step.paneId)}>Go to {step.name}</button><button disabled={!props.recordedIds.has(step.id)} onClick={()=>props.onInspect(step.id)}>Inspect {step.name} result</button></div></div>)}
    </div>)}</section>
  </section></div>;
}
