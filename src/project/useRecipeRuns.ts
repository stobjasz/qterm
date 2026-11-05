import {useCallback,useEffect,useRef,useState} from "react";
import {cancelRecipeRun,failRecipeStep,launchRecipeStep,onRecipeRunsChanged,recipeRunsSnapshot,recipeStepOutput,stopRecipeRun,type RecipeRun,type RecipeStepRun} from "../ipc";
import type {TerminalRegistry} from "../terminal/registry";
import type {Workspace} from "../workspace/workspace";

export const recipeActive=(step:RecipeStepRun)=>["pending","running","ready","unknown","timed_out","stopping"].includes(step.state);
interface Pending {step:RecipeStepRun;profileId:string;profileKey?:string;observed?:boolean;submitted:boolean;launching:boolean;sequence:number;output:string;ready?:{session:number;cwd:string;resolve:()=>void;reject:(e:Error)=>void}}
export function useRecipeRuns(registry:TerminalRegistry,workspace:Workspace,notice:(message:string)=>void) {
  const [runs,setRuns]=useState<RecipeRun[]>([]),[error,setError]=useState<string>();
  const panes=useRef(new Map<string,Pending>()),latest=useRef({workspace,notice});latest.current={workspace,notice};
  const accept=useCallback((values:RecipeRun[])=>{setRuns(values);setError(undefined);},[]);
  const register=useCallback((run:RecipeRun)=>{for(const step of run.steps)panes.current.set(step.paneId,{step,profileId:run.profileId,profileKey:run.launchKey??undefined,submitted:false,launching:false,sequence:0,output:""});accept([...runs.filter(r=>r.id!==run.id),run]);},[runs,accept]);
  const fail=useCallback((paneId:string,message:string)=>{const pending=panes.current.get(paneId);if(!pending)return;panes.current.delete(paneId);registry.cancelStartup(paneId);pending.ready?.reject(new Error(message));void failRecipeStep(pending.step.id,message).catch(e=>latest.current.notice(String(e)));},[registry]);
  const hasPane=useCallback((id:string)=>panes.current.has(id),[]);
  const profileKey=useCallback((id:string)=>panes.current.get(id)?.profileKey,[]);
  const authorize=useCallback((paneId:string,session:number,cwd:string)=>new Promise<void>((resolve,reject)=>{const pending=panes.current.get(paneId);if(!pending){reject(new Error("Workflow launch is no longer pending"));return;}pending.ready={session,cwd,resolve,reject};}),[]);
  const finished=useCallback((paneId:string,command:string)=>{const pending=panes.current.get(paneId);if(!pending?.submitted)return undefined;panes.current.delete(paneId);if(command.trim()!==pending.step.command.trim()){void failRecipeStep(pending.step.id,"The shell reported another command; saved as an ordinary run").catch(()=>{});return undefined;}return pending.step.id;},[]);
  useEffect(()=>{
    for(const [pane,pending] of panes.current){const profile=workspace.panes[pane]?.profileId;if(profile!==undefined)pending.observed=true;if((pending.observed||profile!==undefined)&&profile!==pending.profileId)fail(pane,"Workflow pane closed or changed shell");}
  },[workspace.panes,fail]);
  useEffect(()=>{
    let active=true,busy=false;
    const poll=async()=>{
      if(busy || !active)return;busy=true;
      try {
        const values=await recipeRunsSnapshot();if(!active)return;accept(values);
        for(const [paneId,pending] of panes.current){
          const step=values.flatMap(r=>r.steps).find(s=>s.id===pending.step.id);if(!step)continue;pending.step=step;
          if(!recipeActive(step)){panes.current.delete(paneId);registry.cancelStartup(paneId);pending.ready?.reject(new Error(step.error ?? `Workflow step ${step.state}`));continue;}
          if(step.runnable && pending.ready && !pending.launching && !pending.submitted && [...panes.current.values()].filter(p=>p.submitted).length<16){
            pending.launching=true;pending.submitted=true;
            const ready=pending.ready;
            void launchRecipeStep(step.id,paneId,ready.session,ready.cwd).then(()=>ready.resolve()).catch(async e=>{try{const current=(await recipeRunsSnapshot()).flatMap(r=>r.steps).find(s=>s.id===step.id);if(current?.startedAt){ready.resolve();latest.current.notice(`Workflow launch needs inspection: ${e}`);}else{pending.submitted=false;fail(paneId,String(e));}}catch(observationError){latest.current.notice(`Workflow launch outcome is unknown; inspect before taking another action: ${observationError}`);ready.resolve();}}).finally(()=>{pending.launching=false;});
          }
          if(pending.submitted && pending.ready && step.readyOutput && step.state==="running"){
            const output=registry.runningCommandOutput(paneId);
            if(output?.command.trim()===step.command.trim() && output.output!==pending.output){pending.output=output.output;await recipeStepOutput({id:step.id,paneId,session:pending.ready.session,sequence:++pending.sequence,text:`\n${output.output}\n`});}
          }
        }
      }catch(e){if(active)setError(String(e));}finally{busy=false;}
    };
    const listener=onRecipeRunsChanged(()=>void poll());void listener.then(poll).catch(e=>setError(String(e)));
    const timer=window.setInterval(()=>{if(panes.current.size)void poll();},500);
    return()=>{active=false;window.clearInterval(timer);void listener.then(off=>off()).catch(()=>{});};
  },[accept,fail,registry]);
  const cancel=useCallback(async(id:string)=>{await cancelRecipeRun(id);accept(await recipeRunsSnapshot());},[accept]);
  const stop=useCallback(async(run:RecipeRun)=>{
    for(const step of run.steps.filter(s=>recipeActive(s) && s.startedAt))if(panes.current.get(step.paneId)?.step.id!==step.id)throw new Error("A workflow command already finished or its pane changed. Refresh before stopping it.");
    await stopRecipeRun(run.id);accept(await recipeRunsSnapshot());
  },[accept]);
  return{runs,error,register,hasPane,profileKey,authorize,fail,finished,cancel,stop};
}
