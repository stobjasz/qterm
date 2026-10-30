import {describe,it,expect} from "vitest";
import {prepareFilePaste,deliverFilePaste,type FileDestination} from "./filePaste";
const windows:FileDestination={id:"windows",session:1,submission:0,environment:"native",kind:"powershell"};
const linux:FileDestination={id:"linux",session:2,submission:0,environment:"wsl:ubuntu",kind:"wsl"};
describe("broadcast file paths",()=>{
  it("quotes each actual destination once and shares translation only within the same distribution",async()=>{
    const paths=["C:\\My files\\it's $data.png"],calls:string[]=[];
    const targets=[windows,linux,{...linux,id:"second",session:3},{...linux,id:"debian",session:4,environment:"wsl:debian"}];
    const prepared=await prepareFilePaste(paths,targets,async(distro)=>{calls.push(distro);return[`/drives/${distro}/it's $data.png`];});
    expect(calls).toEqual(["ubuntu","debian"]);
    expect(prepared).toEqual([{id:"windows",text:"'C:\\My files\\it''s $data.png' "},{id:"linux",text:"'/drives/ubuntu/it'\\''s $data.png' "},{id:"second",text:"'/drives/ubuntu/it'\\''s $data.png' "},{id:"debian",text:"'/drives/debian/it'\\''s $data.png' "}]);
    const delivered:unknown[]=[];deliverFilePaste(prepared,targets,targets,(...item)=>delivered.push(item));expect(delivered).toHaveLength(4);
  });
  it("delivers nothing after any destination identity, input turn or broadcast membership changes",async()=>{
    const targets=[windows,linux],prepared=await prepareFilePaste(["C:\\image.png"],targets,async()=>["/drives/image.png"]);
    for(const changed of [[windows], [windows,{...linux,session:3}], [windows,{...linux,submission:1}], [windows,{...linux,environment:"wsl:debian"}], [windows,{...linux,kind:"bash" as const}]]){
      const delivered:unknown[]=[];expect(()=>deliverFilePaste(prepared,targets,changed,(...item)=>delivered.push(item))).toThrow("nothing was pasted");expect(delivered).toEqual([]);
    }
  });
  it("fails the preparation when any file cannot be translated or the destination is unknown",async()=>{
    await expect(prepareFilePaste(["C:\\image.png"],[windows,linux],async()=>{throw Error("foreign distro");})).rejects.toThrow("foreign distro");
    await expect(prepareFilePaste(["C:\\image.png"],[{...windows,environment:"unknown"}],async()=>[])).rejects.toThrow("unknown");
    await expect(prepareFilePaste(["C:\\image.png"],[linux],async()=>[])).rejects.toThrow("different file count");
  });
});
