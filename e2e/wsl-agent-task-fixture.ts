import {EXE,expect,type Qterm} from './qterm';
import {wslVerificationFixture} from './wsl-verification-fixture';
import {execFile} from 'node:child_process';
export function wslAgentTaskFixture(){
  const base=wslVerificationFixture();
  const settings={...base.settings,values:{...base.settings.values,claude_sessions:'false',codex_sessions:'false',wsl_sources:'[]'}};
  function seed(){
    base.seed();if(!base.distro)return;
    const module=`import os,pathlib,json,signal
def check():
    root=pathlib.Path(__file__).resolve().parent
    with open(root/'target/task-count','a') as f:f.write('run\\n')
    print('LINUX_GRANTED_TASK_'+str(int((root/'value.txt').read_text())*2),flush=True)
def wait(name):
    root=pathlib.Path(__file__).resolve().parent
    fields=pathlib.Path('/proc/self/stat').read_text().rpartition(') ')[2].split()
    (root/('target/'+name+'.json')).write_text(json.dumps({'pid':os.getpid(),'start':fields[19]}))
    print('LINUX_'+name.upper()+'_WAITING_'+str(6*7),flush=True)
    signal.pause()
def watch():wait('task')
def source():wait('source')
`;
    const entry=`#!/usr/bin/python3
import sys
sys.path.insert(0,${JSON.stringify(base.project)})
from agent_tasks import check
check()
`;
    base.python(`import os,subprocess
p=${JSON.stringify(base.project)};os.mkdir(p+'/target')
open(p+'/agent_tasks.py','w').write(${JSON.stringify(module)})
open(p+'/pyproject.toml','w').write('[project.scripts]\\nqterm-fixture-check = "agent_tasks:check"\\nqterm-fixture-watch = "agent_tasks:watch"\\n')
entry=${JSON.stringify(`${base.root}/bin/qterm-fixture-check`)}
open(entry,'w').write(${JSON.stringify(entry)});os.chmod(entry,0o700)
for name,function in [('watch','watch'),('source','source')]:
    launch=${JSON.stringify(entry)}.replace('import check','import '+function).replace('check()',function+'()')
    path=${JSON.stringify(`${base.root}/bin/qterm-fixture-`)}+name
    open(path,'w').write(launch);os.chmod(path,0o700)
subprocess.run(['/usr/bin/git','-C',p,'-c','core.hooksPath=/dev/null','add','.'],check=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
subprocess.run(['/usr/bin/git','-C',p,'-c','core.hooksPath=/dev/null','-c','user.name=Fixture','-c','user.email=fixture@example.invalid','-c','commit.gpgsign=false','commit','-m','Named task fixture'],check=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE)`);
  }
  const clientScript=(file:string,method:string,params:unknown)=>`import subprocess,json
exe=subprocess.check_output(['/usr/bin/wslpath','-u',${JSON.stringify(EXE)}],text=True).strip()
result=subprocess.run([exe,'--agent-client',${JSON.stringify(file)},${JSON.stringify(method)},${JSON.stringify(JSON.stringify(params))}],capture_output=True,text=True,timeout=25)
assert result.stdout.strip(),(result.returncode,result.stderr)
print(json.dumps({'status':result.returncode,'body':json.loads(result.stdout)}))`;
  function cli(file:string,method:string,params:unknown={}){
    const response=base.python(clientScript(file,method,params));
    return JSON.parse(response) as {status:number;body:any};
  }
  function cliAsync(file:string,method:string,params:unknown={}){
    return new Promise<ReturnType<typeof cli>>((resolve,reject)=>{
      const child=execFile('wsl.exe',['--distribution',base.distro!,'--exec','/usr/bin/python3','-I','-S','-'],{encoding:'utf8',timeout:30000,windowsHide:true},(error,stdout)=>{if(error){reject(error);return;}try{resolve(JSON.parse(stdout));}catch(failure){reject(failure);}});
      child.stdin!.end(clientScript(file,method,params));
    });
  }
  const executions=()=>Number(base.python(`import os
p=${JSON.stringify(`${base.project}/target/task-count`)}
print(len(open(p).readlines()) if os.path.exists(p) else 0)`));
  function gateStartup(){base.python(`import os
p=${JSON.stringify(`${base.root}/rc`)};text=open(p).read();assert text.count('read -r release;')==1
os.mkfifo(${JSON.stringify(`${base.root}/startup-release`)},0o600)
open(p,'w').write(text.replace('read -r release;',${JSON.stringify(`read -r release < '${base.root}/startup-release';`)}))`);}
  const releaseStartup=()=>base.python(`with open(${JSON.stringify(`${base.root}/startup-release`)},'w') as f:f.write('continue\\n')`);
  async function grant(qterm:Qterm,tasks:string[]=[],project=base.project,client='Linux client'){
    await qterm.page.getByRole('button',{name:'Agent access',exact:true}).click();
    const panel=qterm.page.getByRole('dialog',{name:'Agent access',exact:true});
    await panel.getByLabel('Agent access project folder',{exact:true}).fill(project);
    await panel.getByRole('combobox',{name:'Agent access environment',exact:true}).selectOption(base.environment);
    await panel.getByLabel('Agent access client label',{exact:true}).fill(client);
    if(tasks.length)await panel.getByRole('checkbox',{name:'Review named-task execution too',exact:true}).check();
    await panel.getByRole('button',{name:'Review project access',exact:true}).click();
    await expect(panel.getByLabel('Agent access review',{exact:true})).toContainText(`Environment: ${base.environment}`);
    await panel.getByRole('checkbox',{name:'Allow read access to this project for this qterm session',exact:true}).check();
    for(const task of tasks)await panel.getByRole('checkbox',{name:`Allow task ${task} from pyproject.toml`,exact:true}).check();
    if(tasks.length)await panel.getByRole('checkbox',{name:'Allow the selected named tasks to run in new tabs for this qterm session',exact:true}).check();
    await panel.getByRole('button',{name:tasks.length?'Create session task grant':'Create session read grant',exact:true}).click();
    const connection=panel.getByLabel(`Connection file for ${client}`,{exact:true});await expect(connection).toBeVisible();
    return {panel,file:(await connection.textContent())!};
  }
  const alive=(name:'task'|'source')=>base.python(`import os,json
p=${JSON.stringify(`${base.project}/target/`)}+${JSON.stringify(name)}+'.json'
try:
    owner=json.load(open(p));fields=open('/proc/'+str(owner['pid'])+'/stat').read().rpartition(') ')[2].split()
    print(fields[0]!='Z' and fields[19]==owner['start'])
except FileNotFoundError:print(False)`)==='True';
  return {...base,settings,seed,cli,cliAsync,executions,grant,alive,gateStartup,releaseStartup};
}
