// R110: the actual Linux view of Windows source and Windows shared metadata.
import fs from "node:fs";
import path from "node:path";
import {expect,test} from "./qterm";
import {wslVerificationFixture} from "./wsl-verification-fixture";
for(const boundary of ["source","shared metadata"] as const)test.describe(boundary,()=>{
  const fixture=wslVerificationFixture();let windowsRoot="",folder="";
  test.skip(!fixture.distro,"Requires an installed WSL distribution");test.use({settings:fixture.settings});
  test.beforeAll(()=>{
    fixture.seed();if(!fixture.distro)return;
    windowsRoot=fs.mkdtempSync(path.resolve(".tools.local/wsl-verification-ui-mount-"));
    folder=fixture.python(`import os,subprocess,shutil
source=subprocess.check_output(['/usr/bin/wslpath','-u','-a',${JSON.stringify(windowsRoot)}],text=True).strip()
def git(*args):subprocess.run(['/usr/bin/git','-C',source,'-c','core.hooksPath=/dev/null','-c','core.fsmonitor=false',*args],check=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
for name in ('value.txt','check.py','.gitignore'):shutil.copyfile(${JSON.stringify(fixture.project)}+'/'+name,source+'/'+name)
git('init');git('add','.');git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','-c','commit.gpgsign=false','commit','-m','Mounted source fixture')
folder=source
if ${boundary==="shared metadata"?"True":"False"}:
    folder=${JSON.stringify(`${fixture.root}/linked`)}
    git('worktree','add','-b','linux-task',folder)
print(folder)`);
  });
  test.afterAll(()=>{
    fixture.cleanup();if(!windowsRoot)return;
    const target=fs.realpathSync.native(windowsRoot),parent=fs.realpathSync.native('.tools.local');
    if(path.dirname(target).toLowerCase()!==parent.toLowerCase()||!path.basename(target).startsWith('wsl-verification-ui-mount-'))throw Error('Unexpected mounted fixture cleanup target');
    fs.rmSync(target,{recursive:true,force:true});
  });
  test(`Windows-mounted ${boundary} cannot acquire Linux-only evidence through the UI`,async({qterm})=>{
    const pane=await fixture.ready(qterm);await qterm.run(pane,`cd -- '${folder}'`);
    await expect.poll(async()=>(await qterm.workspace()).panes[pane]?.cwd).toBe(folder);
    await expect.poll(async()=>(await qterm.terminalText(pane)).trimEnd().endsWith(`${folder}$`)).toBe(true);
    await qterm.run(pane,'python3 check.py');await expect.poll(()=>qterm.terminalText(pane)).toContain('VERIFIED_42');
    const panel=await fixture.inspect(qterm);await panel.getByRole('button',{name:'Run with repository tracking',exact:true}).click();
    const preview=qterm.page.getByRole('dialog',{name:'Run with repository tracking',exact:true});
    await preview.getByRole('button',{name:'Run reviewed command',exact:true}).click();
    await expect.poll(async()=>await preview.getByRole('alert').isVisible()||!await preview.isVisible()).toBe(true);
    expect((await qterm.workspace()).tabs).toHaveLength(1);
    await expect(preview.getByRole('alert')).toContainText('cannot establish event coverage on filesystem');
    expect(fixture.python(`print(len(open(${JSON.stringify(`${folder}/target/executions`)}).readlines()))`)).toBe('1');
    await preview.getByRole('button',{name:'Cancel verification',exact:true}).click();
    await panel.getByRole('button',{name:'Close problems',exact:true}).click();
    await qterm.run(pane,"printf 'MOUNT_SHELL_KEPT_%s\\n' \"$((6*7))\"");await expect.poll(()=>qterm.terminalText(pane)).toContain('MOUNT_SHELL_KEPT_42');
  });
});
