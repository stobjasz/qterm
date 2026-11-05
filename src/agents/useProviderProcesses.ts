import {useEffect,useRef,useState} from "react";
import {providerProcesses,type ProviderProcessObservation} from "../ipc";
import type {TerminalRegistry} from "../terminal/registry";
import type {Workspace} from "../workspace/workspace";
import {expireProcessEvidence} from "./processEvidence";

export type ProcessSnapshot=ReadonlyMap<number,ProviderProcessObservation>;
/** One bounded process poll shared by both provider adapters. */
export function useProviderProcesses(enabled:boolean,registry:TerminalRegistry,workspace:Workspace):ProcessSnapshot {
  const latest=useRef(workspace);latest.current=workspace;
  const [snapshot,setSnapshot]=useState<ProcessSnapshot>(new Map());
  useEffect(()=>{
    if(!enabled){setSnapshot(new Map());return;}
    let disposed=false,timer:number;
    const poll=async()=>{
      const ids=[...new Set(Object.keys(latest.current.panes).flatMap(id=>{const session=registry.sessionOf(id);return session===undefined?[]:[session];}))];
      const next=new Map<number,ProviderProcessObservation>();
      for(let at=0;at<ids.length;at+=256){
        const chunk=ids.slice(at,at+256);
        try{for(const value of await providerProcesses(chunk))next.set(value.session,value);}
        catch(error){for(const session of chunk){const pane=Object.keys(latest.current.panes).find(id=>registry.sessionOf(id)===session);next.set(session,{session,environment:pane?registry.environmentOf(pane)??"unknown":"unknown",providers:null,error:String(error),observedAt:Date.now(),ended:false});}}
        if(disposed)return;
      }
      if(!disposed){setSnapshot(next);timer=window.setTimeout(()=>void poll(),2500);}
    };
    // A slow OS/WSL request must not leave the preceding observation fresh in
    // the UI. This clock never issues another request or overlaps the poll.
    const freshness=window.setInterval(()=>setSnapshot(current=>expireProcessEvidence(current)),1000);
    void poll();return()=>{disposed=true;window.clearTimeout(timer);window.clearInterval(freshness);};
  },[enabled,registry]);
  return snapshot;
}
