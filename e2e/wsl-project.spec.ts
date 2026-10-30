// R69: actual installed WSL, Linux files/Git, ConPTY and a real editor process.
// Set QTERM_E2E_WSL_DISTRIBUTION=Ubuntu on a WSL-capable runner.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {execFileSync} from "node:child_process";
import {expect,IDENTIFIER,test} from "./qterm";
const distro=process.env.QTERM_E2E_WSL_DISTRIBUTION;
const shellCommand=`wsl.exe --distribution "${distro??"unavailable"}" --exec /bin/bash --noprofile --norc -i`;
const marker=`${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
const linuxRoot=`/tmp/qterm-wsl-e2e-${marker}`,project=`${linuxRoot}/Case project`;
const winParent=fs.realpathSync.native(os.tmpdir()),winRoot=path.join(winParent,`qterm-wsl-editor-${marker}`),editor=path.join(winRoot,"editor.cjs"),opened=path.join(winRoot,"opened.json");
const windowsFile=(linux:string)=>`\\\\wsl.localhost\\${distro}${linux.replaceAll("/","\\")}`;
const python=(source:string)=>execFileSync("wsl.exe",["--distribution",distro!,"--exec","/usr/bin/python3","-c",source],{encoding:"utf8",timeout:30000,windowsHide:true});
test.skip(!distro,"Set QTERM_E2E_WSL_DISTRIBUTION to an installed distribution to validate WSL boundaries");
test.use({settings:{values:{default_profile:'"custom:E2E WSL"',editor:JSON.stringify(`"${process.execPath}" "${editor}" "{file}" "{line}" "{col}"`)},extra:['[[profiles]]','id = "custom:E2E WSL"','name = "E2E WSL"',`command = ${JSON.stringify(shellCommand)}`,`cwd = ${JSON.stringify(project)}`].join("\n")}});
test.beforeAll(()=>{
  if(!distro)return;fs.mkdirSync(winRoot);fs.writeFileSync(editor,`require('fs').writeFileSync(${JSON.stringify(opened)},JSON.stringify(process.argv.slice(2)));`);
  python(`import os,json,subprocess,shlex
root=${JSON.stringify(linuxRoot)}; cwd=${JSON.stringify(project)}; os.mkdir(root,0o700);os.mkdir(cwd)
files={'Case.py':'UPPER_CASE','case.py':'lower_case','tracked.txt':'original','package.json':json.dumps({'scripts':{'proof':'python3 check.py'}}),'.qterm.toml':'name = "WSL pane proof"\\n[[snippets]]\\nname = "Linux diagnostic"\\ncommand = "python3 check.py"\\nrun = true\\n','check.py':'import sys\\nprint("Case.py(1,1): error TS4242: linux-proof-"+str(6*7))\\nsys.exit(1)\\n'}
for name,text in files.items():
    with open(os.path.join(cwd,name),'w') as f:f.write(text)
env={**os.environ,'GIT_CONFIG_GLOBAL':'/dev/null','GIT_CONFIG_SYSTEM':'/dev/null'}
def git(*args):subprocess.run(['/usr/bin/git','-c','core.hooksPath=/dev/null','-c','core.fsmonitor=false','-c','commit.gpgSign=false',*args],cwd=cwd,env=env,check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
git('init','--quiet','--initial-branch=wsl-proof');git('config','user.email','fixture@example.invalid');git('config','user.name','qterm fixture');git('add','.');git('commit','--quiet','-m','fixture')
hook=os.path.join(root,'forbidden.sh');sentinel=os.path.join(root,'must-not-run')
with open(hook,'w') as f:f.write('#!/bin/sh\\ntouch '+shlex.quote(sentinel)+'\\ncat\\n')
os.chmod(hook,0o700);git('config','core.fsmonitor',hook);git('config','filter.qterm.clean',hook);git('config','filter.qterm.process',hook);git('config','filter.qterm.required','true')
with open(os.path.join(cwd,'.gitattributes'),'w') as f:f.write('tracked.txt filter=qterm\\n')
with open(os.path.join(cwd,'tracked.txt'),'w') as f:f.write('edited')`);
});
test.afterAll(()=>{
  if(!distro)return;
  python(`import os,shutil; root=os.path.realpath(${JSON.stringify(linuxRoot)}); assert os.path.dirname(root)=='/tmp' and os.path.basename(root).startswith('qterm-wsl-e2e-'); shutil.rmtree(root) if os.path.exists(root) else None`);
  if(fs.existsSync(winRoot)){const target=fs.realpathSync.native(winRoot);if(path.dirname(target).toLowerCase()!==winParent.toLowerCase()||!path.basename(target).startsWith("qterm-wsl-editor-"))throw new Error("Unexpected WSL editor fixture cleanup target");fs.rmSync(target,{recursive:true,force:true});}
});
test("a real WSL pane discovers its Linux project safely and diagnostic links keep the original distribution",async({qterm},info)=>{
  const pane=await qterm.activePane();await expect.poll(async()=>(await qterm.workspace()).panes[pane]?.cwd).toBe(project);await expect(qterm.page.getByRole("tab").first()).toContainText("WSL pane proof");await expect(qterm.page.getByRole("tab").first()).toHaveAccessibleDescription(/⎇ wsl-proof/);expect(fs.existsSync(windowsFile(`${linuxRoot}/must-not-run`))).toBe(false);
  await qterm.run(pane,"printf 'WSL_READY_%s\\n' \"$((6*7))\"");await expect.poll(()=>qterm.terminalText(pane)).toContain("WSL_READY_42");
  await qterm.page.keyboard.press("Control+Shift+P");let palette=qterm.page.getByRole("dialog",{name:"Command palette",exact:true});await palette.getByRole("combobox",{name:"Command",exact:true}).fill("proof");await expect(palette).toContainText("npm run proof");await qterm.page.keyboard.press("Escape");
  await qterm.page.keyboard.press("Control+Shift+P");palette=qterm.page.getByRole("dialog",{name:"Command palette",exact:true});await palette.getByRole("combobox",{name:"Command",exact:true}).fill("Linux diagnostic");await palette.getByRole("option").filter({hasText:"Linux diagnostic"}).click();await expect.poll(()=>qterm.terminalText(pane)).toContain("linux-proof-42");
  await qterm.run(pane,"cd /tmp");await expect.poll(async()=>(await qterm.workspace()).panes[pane]?.cwd).toBe("/tmp");
  const config=path.join(process.env.APPDATA!,IDENTIFIER,"config.toml"),original=qterm.settingsOnDisk();
  try{
    const changedCommand=shellCommand.replace(`"${distro}"`,'"qterm-unavailable-distro"');const updated=original.replace('name = "E2E WSL"','name = "Retargeted WSL"').replace(JSON.stringify(shellCommand),JSON.stringify(changedCommand));expect(updated).toContain(`command = ${JSON.stringify(changedCommand)}`);fs.writeFileSync(config,updated);
    await qterm.page.keyboard.press("Control+Shift+P");palette=qterm.page.getByRole("dialog",{name:"Command palette",exact:true});await palette.getByRole("combobox",{name:"Command",exact:true}).fill("Retargeted WSL");await expect(palette.getByRole("option").first()).toContainText("Retargeted WSL");await qterm.page.keyboard.press("Escape");
    await qterm.page.getByRole("button",{name:"Problems and command runs",exact:true}).click();const dialog=qterm.page.getByRole("dialog",{name:"Problems and command runs",exact:true});await dialog.getByRole("button",{name:"Inspect run: python3 check.py",exact:true}).click();await expect(dialog.getByLabel("Run details",{exact:true})).toContainText(`Environment: wsl:${distro!.toLowerCase()}`);await dialog.getByRole("button",{name:"Open Case.py:1",exact:true}).click();await expect.poll(()=>{try{return JSON.parse(fs.readFileSync(opened,"utf8"));}catch{return[];}}).toEqual([windowsFile(`${project}/Case.py`),"1","1"]);expect(fs.readFileSync(windowsFile(`${project}/Case.py`),"utf8")).toBe("UPPER_CASE");expect(fs.existsSync(windowsFile(`${linuxRoot}/must-not-run`))).toBe(false);await qterm.page.screenshot({path:info.outputPath("wsl-project.png")});
  }finally{fs.writeFileSync(config,original);}
});
