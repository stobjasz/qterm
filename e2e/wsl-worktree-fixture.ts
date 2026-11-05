import {expect,type Qterm} from "./qterm";
import {wslLaunchFixture} from "./wsl-launch-fixture";
export function wslWorktreeFixture(){
  const fixture=wslLaunchFixture(),target=`${fixture.root}/Task`;
  function seed(){fixture.seed();if(!fixture.distro)return;fixture.python(`import os,subprocess
repo=${JSON.stringify(fixture.project)}
env={k:v for k,v in os.environ.items() if not k.startswith('GIT_')}
def git(*args):subprocess.run(['/usr/bin/git','-c','core.hooksPath=/dev/null','-c','core.fsmonitor=false','-c','commit.gpgSign=false',*args],cwd=repo,env=env,check=True,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
git('init','--quiet','--initial-branch=source');git('config','user.name','fixture');git('config','user.email','fixture@example.invalid')
with open(repo+'/tracked.txt','w') as f:f.write('committed content')
git('add','.');git('commit','--quiet','-m','fixture')
with open(repo+'/tracked.txt','w') as f:f.write('dirty source')`);}
  const read=(path:string)=>fixture.python(`print(open(${JSON.stringify(path)},encoding='utf8').read())`);
  const exists=(path:string)=>fixture.python(`import os;print(os.path.lexists(${JSON.stringify(path)}))`)==="True";
  const panel=(qterm:Qterm)=>qterm.page.getByRole("dialog",{name:"Worktree tasks",exact:true});
  async function preview(qterm:Qterm,request="Inspect this task"){
    await fixture.ready(qterm);await qterm.page.getByRole("button",{name:"Worktree tasks",exact:true}).click();const dialog=panel(qterm);
    await dialog.getByRole("button",{name:"New worktree task",exact:true}).click();
    await dialog.getByLabel("Worktree task title",{exact:true}).fill("Linux parser repair");
    await dialog.getByLabel("Worktree new branch",{exact:true}).fill("qterm/linux-parser");
    await dialog.getByLabel("Worktree new directory",{exact:true}).fill(target);
    await dialog.getByLabel("Worktree task request",{exact:true}).fill(request);
    await dialog.getByRole("button",{name:"Preview worktree task",exact:true}).click();await expect(dialog.getByLabel("Worktree creation preview",{exact:true})).toContainText(`Environment: ${fixture.environment}`);
    return dialog;
  }
  return{...fixture,target,seed,read,exists,panel,preview};
}
