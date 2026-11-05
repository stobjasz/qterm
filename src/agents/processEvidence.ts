import type {ProviderProcessObservation} from "../ipc";
import type {AgentObservation} from "./status";

const PROCESS_MAX_AGE=15_000;

/** Expire published evidence even while the next backend request is pending. */
export function expireProcessEvidence(current:ReadonlyMap<number,ProviderProcessObservation>,now=Date.now()):ReadonlyMap<number,ProviderProcessObservation>{
  let next:Map<number,ProviderProcessObservation>|undefined;
  for(const [session,value] of current){
    if(!value.ended&&value.error===null&&now-value.observedAt>PROCESS_MAX_AGE){
      next??=new Map(current);
      next.set(session,{...value,error:"Process evidence is stale"});
    }
  }
  return next??current;
}

/** A failed probe changes this view, never the retained lifecycle event. */
export function withProcessEvidence(observation:AgentObservation,evidence:{error?:string;observedAt?:number}):AgentObservation {
  if(evidence.error)return{...observation,state:"unknown",reason:evidence.error};
  if(observation.source==="process"&&evidence.observedAt!==undefined)return{...observation,updatedAt:evidence.observedAt};
  return{...observation};
}

/** Absence is not an idle lifecycle event; failed/stale reads preserve uncertainty. */
export function processEvidence(value:ProviderProcessObservation|undefined,environment:string|undefined,provider:"claude"|"codex",known:boolean,previous:boolean,emptyPrompt:boolean,supported:boolean,now=Date.now()):{track:boolean;error?:string;observedAt?:number} {
  if(value?.ended)return{track:false};
  if(!supported)return{track:known||previous};
  const error=!value?"Process scan has not completed":value.environment!==environment?"Process evidence belongs to another environment":now-value.observedAt>PROCESS_MAX_AGE?"Process evidence is stale":value.error??(value.providers===null?"Process scan returned no evidence":undefined);
  if(error)return{track:known||previous,error};
  if(value?.providers?.includes(provider))return{track:true,observedAt:value.observedAt};
  if(environment?.startsWith("wsl:")&&known&&!emptyPrompt)return{track:true,error:"No recognized provider process was found; no shell prompt confirms that the session ended."};
  return{track:false};
}
