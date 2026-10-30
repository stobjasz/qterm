// R74: isolated real provider homes on Windows and in actual WSL; no model calls.
import fs from "node:fs";import path from "node:path";import {execFileSync} from "node:child_process";
import {expect,IDENTIFIER,test} from "./qterm";
import {LIBRARY_ID,libraryFixture,openLibrary,discover,sessionRow} from "./session-library-fixture";
const distro=process.env.QTERM_E2E_WSL_DISTRIBUTION,fixture=libraryFixture();
const root=`/tmp/qterm-wsl-sources-${process.pid}-${Date.now()}`,environment=`wsl:${distro?.toLowerCase()}`;
const sources=(home="alpha",enabled=false,distribution=distro??"unavailable")=>`[{ distribution = ${JSON.stringify(distribution)}, enabled = ${enabled}, claude_home = ${JSON.stringify(`${root}/${home}/claude`)}, codex_home = ${JSON.stringify(`${root}/${home}/codex`)} }]`;
const python=(source:string)=>execFileSync("wsl.exe",["--distribution",distro!,"--exec","/usr/bin/python3","-c",source],{encoding:"utf8",timeout:30000,windowsHide:true});
test.skip(!distro,"Set QTERM_E2E_WSL_DISTRIBUTION to an installed distribution");
test.use({settings:{...fixture.settings,files:{},values:{...fixture.settings.values,wsl_sources:sources()}}});
let before:string;
const hashes=()=>python(`import os,hashlib,json;root=${JSON.stringify(root)};print(json.dumps({os.path.relpath(os.path.join(d,n),root):hashlib.sha256(open(os.path.join(d,n),'rb').read()).hexdigest() for d,_,names in os.walk(root) for n in names},sort_keys=True))`).trim();
test.beforeAll(()=>{
  if(!distro)return;fixture.seed();
  python(`import os,json;root=${JSON.stringify(root)};os.mkdir(root,0o700)
for home in ('alpha','beta'):
    project=os.path.join(root,home,'project');claude=os.path.join(root,home,'claude','projects','fixture');codex=os.path.join(root,home,'codex','sessions','2026','10','30')
    for folder in (project,claude,codex):os.makedirs(folder)
    with open(os.path.join(claude,${JSON.stringify(`${LIBRARY_ID}.jsonl`)}),'w') as f:f.write('\\n'.join(json.dumps(record) for record in [{'type':'user','cwd':project,'gitBranch':'wsl/'+home,'message':{'content':'PRIVATE_WSL_CLAUDE_'+home}},{'aiTitle':'WSL Claude '+home}]))
    with open(os.path.join(codex,${JSON.stringify(`rollout-fixture-${LIBRARY_ID}.jsonl`)}),'w') as f:f.write('\\n'.join(json.dumps(record) for record in [{'type':'session_meta','payload':{'id':${JSON.stringify(LIBRARY_ID)},'cwd':project,'git':{'branch':'wsl/'+home}}},{'type':'response_item','payload':{'type':'message','role':'user','content':[{'type':'input_text','text':'WSL Codex '+home}]}}]))`);
  before=hashes();
});
test.afterAll(()=>{
  fixture.cleanup();if(!distro)return;
  python(`import os,shutil;root=os.path.realpath(${JSON.stringify(root)});assert os.path.dirname(root)=='/tmp' and os.path.basename(root).startswith('qterm-wsl-sources-');shutil.rmtree(root) if os.path.exists(root) else None`);
});
test("WSL sources need explicit opt-in and isolate colliding sessions while source changes and history gates erase cached context",async({qterm},info)=>{
  const config=path.join(process.env.APPDATA!,IDENTIFIER,"config.toml"),base=qterm.settingsOnDisk();
  const write=(source:string,codex=true)=>fs.writeFileSync(config,base.replace(/^wsl_sources\s*=.*$/m,`wsl_sources = ${source}`).replace(/^codex_sessions\s*=.*$/m,`codex_sessions = ${codex}`));
  try{
    await qterm.waitForPrompt(await qterm.activePane());let panel=await openLibrary(qterm.page);await discover(panel);await expect(panel.getByRole("listitem")).toHaveCount(2);await expect(panel).toContainText("source disabled");await expect(sessionRow(panel,"codex",environment)).toHaveCount(0);await panel.getByRole("button",{name:"Close session library",exact:true}).click();
    await qterm.page.getByRole("button",{name:"Settings",exact:true}).click();const settings=qterm.page.getByRole("dialog",{name:"Settings",exact:true});await settings.getByRole("checkbox",{name:"Enable discovery for this WSL source",exact:true}).check();await qterm.page.screenshot({path:info.outputPath("wsl-sources-settings.png")});await settings.getByRole("button",{name:"Save",exact:true}).click();await expect(settings).toBeHidden();
    panel=await openLibrary(qterm.page);await panel.getByRole("checkbox",{name:"Include discovered sessions",exact:true}).check();await expect(panel.getByRole("listitem")).toHaveCount(2);await expect(panel).toContainText("not scanned");
    await discover(panel);await expect(panel.getByRole("listitem")).toHaveCount(4);await expect(sessionRow(panel,"claude",environment)).toContainText("WSL Claude alpha");await expect(sessionRow(panel,"codex",environment)).toContainText("WSL Codex alpha");await expect(sessionRow(panel,"codex")).toContainText("Codex library beta");
    await sessionRow(panel,"codex",environment).getByRole("button").click();await expect(panel.getByRole("region",{name:"Selected library session",exact:true})).toContainText(`${root}/alpha/project`);await panel.getByRole("button",{name:"Pin selected session",exact:true}).click();await expect(panel.getByRole("button",{name:"Unpin selected session",exact:true})).toBeVisible();await qterm.page.screenshot({path:info.outputPath("wsl-sources.png")});
    write(sources("beta",true));await expect(panel).toContainText(`${root}/beta/codex`);await expect(sessionRow(panel,"codex",environment)).not.toContainText("WSL Codex alpha");await expect(panel).not.toContainText("wsl/alpha");await discover(panel);await expect(sessionRow(panel,"codex",environment)).toContainText("WSL Codex beta");await expect(sessionRow(panel,"claude",environment)).toContainText("WSL Claude beta");
    write(sources("beta",true),false);await expect(sessionRow(panel,"codex",environment)).not.toContainText("WSL Codex beta");await expect(sessionRow(panel,"codex")).toHaveCount(0);await expect(panel).toContainText("history disabled");await expect(panel.getByRole("button",{name:"Resume selected session in new tab",exact:true})).toBeDisabled();
    write(sources("beta",false),false);await expect(sessionRow(panel,"claude",environment)).toHaveCount(0);await discover(panel);await expect(panel).not.toContainText("WSL Claude beta");
    write(sources("beta",true,"qterm-source-unavailable"));await expect(panel).toContainText("qterm-source-unavailable: not scanned");await discover(panel);await expect(panel).toContainText("no default distribution was substituted");await expect(sessionRow(panel,"codex",environment)).not.toContainText("WSL Codex beta");expect(hashes()).toBe(before);
  }finally{fs.writeFileSync(config,base);}
});
