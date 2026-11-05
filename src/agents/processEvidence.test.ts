import {describe,it,expect} from "vitest";
import {processEvidence,withProcessEvidence,expireProcessEvidence} from "./processEvidence";
import {hookObservation,resolveObservation} from "./status";
import type {ProviderProcessObservation} from "../ipc";
const snapshot:ProviderProcessObservation={session:7,environment:"wsl:ubuntu",providers:["codex"],error:null,observedAt:1000,ended:false};
describe("provider process evidence",()=>{
  it("expires a published observation while a later scan has not returned",()=>{
    const old=Object.freeze({...snapshot}),fresh=Object.freeze({...snapshot,session:8,observedAt:16000});
    const current=new Map([[7,old],[8,fresh]]);
    expect(expireProcessEvidence(current,16000)).toBe(current);
    const expired=expireProcessEvidence(current,16001);
    expect(expired.get(7)).toMatchObject({error:"Process evidence is stale",observedAt:1000});
    expect(expired.get(8)).toBe(fresh);expect(old.error).toBeNull();
    expect(expireProcessEvidence(expired,17000)).toBe(expired);
    expect(processEvidence(expired.get(7),"wsl:ubuntu","codex",true,true,false,true,16001)).toMatchObject({track:true,error:"Process evidence is stale"});
    expect(processEvidence({...snapshot,observedAt:17000},"wsl:ubuntu","codex",true,true,false,true,17001)).toEqual({track:true,observedAt:17000});
  });
  it("retains ended-session evidence and the original probe error as time passes",()=>{
    const ended={...snapshot,ended:true},failed={...snapshot,session:8,error:"timed out",providers:null};
    const current=new Map([[7,ended],[8,failed]]);
    expect(expireProcessEvidence(current,100000)).toBe(current);
    expect(processEvidence(current.get(7),"wsl:ubuntu","codex",true,true,false,true,100000)).toEqual({track:false});
  });
  it("recovers the retained lifecycle state after a transient probe failure",()=>{
    const hook=Object.freeze(hookObservation("busy","turn-start",4,"session",1000));
    const failed=withProcessEvidence(resolveObservation(hook,4,0,1100,2000),{error:"timed out"});
    expect(failed).toMatchObject({state:"unknown",reason:"timed out",source:"hook"});
    expect(hook.state).toBe("busy");
    expect(withProcessEvidence(resolveObservation(hook,4,0,1200,2000),{observedAt:1200})).toEqual(hook);
    const process=resolveObservation(undefined,4,0,1200,2000);
    expect(withProcessEvidence(process,{observedAt:1150}).updatedAt).toBe(1150);
    expect(process.updatedAt).toBe(1200);
  });
  it("does not convert another environment or stale observation into live process proof",()=>{
    expect(processEvidence(snapshot,"wsl:other","codex",false,false,false,true,1001)).toMatchObject({track:false,error:expect.any(String)});
    expect(processEvidence(snapshot,"wsl:ubuntu","codex",true,true,false,true,17000)).toMatchObject({track:true,error:"Process evidence is stale"});
  });
  it("keeps a failed scan unknown only for previously associated providers",()=>{
    const failed={...snapshot,providers:null,error:"timed out"};
    expect(processEvidence(failed,"wsl:ubuntu","codex",false,false,false,true,1001).track).toBe(false);
    expect(processEvidence(failed,"wsl:ubuntu","codex",false,true,false,true,1001)).toEqual({track:true,error:"timed out"});
  });
  it("needs a shell prompt to clear an unrecognized WSL hook association",()=>{
    const absent={...snapshot,providers:[]};
    expect(processEvidence(absent,"wsl:ubuntu","codex",true,true,false,true,1001)).toMatchObject({track:true,error:expect.any(String)});
    expect(processEvidence(absent,"wsl:ubuntu","codex",true,true,true,true,1001)).toEqual({track:false});
    expect(processEvidence({...snapshot,ended:true},"wsl:ubuntu","codex",true,true,false,true,1001)).toEqual({track:false});
  });
});
