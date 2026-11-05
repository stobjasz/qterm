import {expect,type Qterm} from "./qterm";
import {wslLaunchFixture} from "./wsl-launch-fixture";
export function wslVerificationFixture(){
  const base=wslLaunchFixture();
  const check=`import os
os.makedirs('target',exist_ok=True)
with open('target/executions','a') as f:f.write('check\\n')
open('target/artifact','w').write('build output')
if os.path.exists('target/pause'):
    print('VERIFY_WAITING_'+str(6*7),flush=True)
    with open('target/release') as f:f.readline()
print('VERIFIED_'+str(int(open('value.txt').read())*2),flush=True)
`;
  function seed(){
    base.seed();if(!base.distro)return;
    base.python(`import os,subprocess
os.chdir(${JSON.stringify(base.project)})
with open(${JSON.stringify(`${base.root}/rc`)},'a') as f:f.write("\\nif [ -f '${base.root}/exit-startup' ]; then printf 'VERIFY_STARTUP_EXIT_%s\\\\n' \\\"$((6*7))\\\"; exit 23; fi\\n")
open('value.txt','w').write('21')
open('.gitignore','w').write('target/\\n')
open('check.py','w').write(${JSON.stringify(check)})
def git(*args):subprocess.run(['/usr/bin/git','-c','core.hooksPath=/dev/null','-c','core.fsmonitor=false',*args],check=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
git('init');git('add','.');git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','-c','commit.gpgsign=false','commit','-m','Initial fixture')`);
  }
  const panel=(q:Qterm)=>q.page.getByRole("dialog",{name:"Problems and command runs",exact:true});
  async function inspect(q:Qterm){await q.page.getByRole("button",{name:"Problems and command runs",exact:true}).click();await panel(q).getByRole("button",{name:/Inspect run:.*python3 check\.py/}).click();return panel(q);}
  async function preview(q:Qterm){
    const pane=await base.ready(q);await q.run(pane,"python3 check.py");
    await expect.poll(()=>q.terminalText(pane)).toContain("VERIFIED_42");
    await expect.poll(async()=>(await q.terminalText(pane)).trimEnd().endsWith(`${base.project}$`)).toBe(true);
    const runs=await inspect(q);await expect(runs.getByRole("status",{name:"Verification freshness",exact:true})).toContainText("No before-run");
    await runs.getByRole("button",{name:"Run with repository tracking",exact:true}).click();
    return q.page.getByRole("dialog",{name:"Run with repository tracking",exact:true});
  }
  function pause(){base.python(`import os
p=${JSON.stringify(`${base.project}/target`)}
open(p+'/pause','w').close()
os.mkfifo(p+'/release',0o600)`);}
  function restoreAndRelease(){base.python(`p=${JSON.stringify(base.project)}
open(p+'/value.txt','w').write('99')
open(p+'/value.txt','w').write('21')
with open(p+'/target/release','w') as f:f.write('finish\\n')`);}
  const executions=()=>Number(base.python(`print(len(open(${JSON.stringify(`${base.project}/target/executions`)}).readlines()))`));
  return{...base,seed,panel,inspect,preview,pause,restoreAndRelease,executions};
}
