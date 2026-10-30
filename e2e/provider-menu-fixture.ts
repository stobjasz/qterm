import fs from "node:fs";import path from "node:path";
import {expect,type Qterm,type Settings} from "./qterm";
import {LIBRARY_ID} from "./session-library-fixture";
import {wslLaunchFixture} from "./wsl-launch-fixture";
export function providerMenuFixture(){
  const linux=wslLaunchFixture(),nativeHome=linux.settings.env!.CLAUDE_CONFIG_DIR,nativeRoot=path.dirname(nativeHome),nativeProject=path.join(nativeRoot,"project one"),nativeRecord=path.join(nativeRoot,"menu-result.json"),other="wsl:qterm-other";
  const quote=(value:string)=>`'${value.replaceAll("'","''")}'`;
  const stub=(provider:string)=>`function global:${provider} { [IO.File]::WriteAllText(${quote(nativeRecord)},(@{ provider='${provider}'; cwd=(Get-Location).Path; home=$env:${provider==="claude"?"CLAUDE_CONFIG_DIR":"CODEX_HOME"}; args=@($args) } | ConvertTo-Json -Depth 3)); Write-Output ('NATIVE_MENU_RESULT_'+(6*7)) }`;
  const nativeCommand=`powershell.exe -NoLogo -NoProfile -NoExit -Command "${stub("claude")}; ${stub("codex")}"`;
  const linuxCommand=`wsl.exe --distribution "${linux.distro}" --exec /bin/bash --noprofile --rcfile "${linux.root}/rc" -i`;
  const profile=(id:string,name:string,command:string)=>['[[profiles]]',`id=${JSON.stringify(id)}`,`name=${JSON.stringify(name)}`,`command=${JSON.stringify(command)}`].join("\n");
  const remembered=(provider:string)=>[
    {id:LIBRARY_ID,environment:linux.environment,cwd:linux.project,profileId:"custom:WSL launch",title:`Linux reference ${provider}`,seenAt:Date.now()},
    {id:LIBRARY_ID,environment:"native",cwd:nativeProject,profileId:"custom:Native menu",title:`Native reference ${provider}`,seenAt:Date.now()-1},
    {id:LIBRARY_ID,environment:other,cwd:linux.project,profileId:"wsl:qterm-other",title:`Other reference ${provider}`,seenAt:Date.now()-2},
  ];
  const settings:Settings={...linux.settings,files:{"claude-sessions.json":JSON.stringify(remembered("claude")),"codex-sessions.json":JSON.stringify(remembered("codex"))},extra:[linux.settings.extra,profile("custom:Native menu","Native menu",nativeCommand),profile("powershell","Native menu Windows",nativeCommand),profile("pwsh","Native menu PowerShell",nativeCommand),profile(`wsl:${linux.distro}`,"WSL menu distribution",linuxCommand)].join("\n")};
  function seed(){if(!linux.distro)return;linux.seed();fs.mkdirSync(path.join(nativeHome,"projects","fixture"),{recursive:true});fs.writeFileSync(path.join(nativeHome,"projects","fixture",`${LIBRARY_ID}.jsonl`),[{type:"user",cwd:nativeProject,message:{content:"Native menu source"}},{aiTitle:"Native menu claude"}].map(x=>JSON.stringify(x)).join("\n"));const codexDir=path.join(settings.env!.CODEX_HOME,"sessions","2026","10","30");fs.mkdirSync(codexDir,{recursive:true});fs.writeFileSync(path.join(codexDir,`rollout-menu-${LIBRARY_ID}.jsonl`),[{type:"session_meta",payload:{id:LIBRARY_ID,cwd:nativeProject}},{type:"response_item",payload:{type:"message",role:"user",content:[{type:"input_text",text:"Native menu codex"}]}}].map(x=>JSON.stringify(x)).join("\n"));}
  async function menu(qterm:Qterm,provider:"claude"|"codex"){const name=provider==="claude"?"Claude sessions":"Codex sessions";await qterm.page.getByRole("button",{name,exact:true}).click();const menu=qterm.page.getByRole("menu",{name,exact:true});await expect(menu).toBeVisible();return menu;}
  const group=(panel:Awaited<ReturnType<typeof menu>>,environment=linux.environment)=>panel.getByRole("region",{name:`Sessions in ${environment==="native"?"project one":"Case"} · ${environment==="native"?"Native Windows":`WSL · ${environment.slice(4)}`}`,exact:true});
  return{...linux,settings,seed,menu,group,other,nativeRoot,nativeProject,nativeRecord,reset(){linux.reset();fs.rmSync(nativeRecord,{force:true});}};
}
