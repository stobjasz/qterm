import fs from "node:fs";
import {execFileSync} from "node:child_process";
import {expect,type Qterm,type Settings} from "./qterm";
import {LIBRARY_ID,libraryFixture,openLibrary,discover,sessionRow} from "./session-library-fixture";
export function wslLaunchFixture(){
  const distro=process.env.QTERM_E2E_WSL_DISTRIBUTION,native=libraryFixture();
  const root=`/tmp/qterm-wsl-launch-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,project=`${root}/Case`,home=`${root}/source home it's 🦀`,environment=`wsl:${distro?.toLowerCase()}`;
  const python=(code:string)=>execFileSync("wsl.exe",["--distribution",distro!,"--exec","/usr/bin/python3","-c",code],{encoding:"utf8",timeout:30000,windowsHide:true}).trim();
  const settings:Settings={env:{...native.settings.env,XDG_CACHE_HOME:`${root}/cache`,WSLENV:"XDG_CACHE_HOME/u"},values:{default_profile:'"custom:WSL launch"',claude_sessions:"true",codex_sessions:"true",wsl_sources:`[{distribution=${JSON.stringify(distro??"unavailable")},enabled=true,claude_home=${JSON.stringify(`${home}/claude`)},codex_home=${JSON.stringify(`${home}/codex`)}}]`},extra:['[[profiles]]','id="custom:WSL launch"','name="WSL launch"',`command=${JSON.stringify(`wsl.exe --distribution "${distro}" --exec /bin/bash --noprofile --rcfile "${root}/rc" -i`)}`,`cwd=${JSON.stringify(project)}`].join("\n")};
  function seed(){if(!distro)return;native.seed();fs.rmSync(native.claudeFile);fs.rmSync(native.codexFile);
    const stub=`#!/usr/bin/python3
import os,sys,json,re,hashlib
root=${JSON.stringify(root)}
provider=os.path.basename(sys.argv[0]);home=os.environ.get('CODEX_HOME' if provider=='codex' else 'CLAUDE_CONFIG_DIR','')
args=sys.argv[1:];record={'provider':provider,'args':args,'home':home,'cwd':os.getcwd()}
if 'resume' in args or '--resume' in args:
    assert home==${JSON.stringify(home)}+'/'+provider,(home,provider)
    assert args[-1]==${JSON.stringify(LIBRARY_ID)}
    record['mode']='resume'
elif not args or args==['--no-daemon']:
    record['mode']='fresh'
else:
    brief=re.search(r'Read the task brief at (.+?) and follow its Request section',args[-1]).group(1)
    assert os.path.realpath(brief).startswith(root+'/cache/qterm/briefs/')
    record.update(mode='handoff',brief=brief,text=open(brief,encoding='utf8').read())
with open(root+'/record.json','w',encoding='utf8') as f:json.dump(record,f)
print('WSL_AGENT_RESULT_'+str(6*7),flush=True)
`;
    const rc=`export PATH='${root}/bin:/usr/bin:/bin'\nexport CODEX_HOME='${root}/wrong/codex' CLAUDE_CONFIG_DIR='${root}/wrong/claude'\nif [ -f '${root}/hold' ]; then printf 'WSL_PROFILE_WAITING_%s\\n' "$((6*7))"; read -r release; fi\nif [ -f '${root}/wrong-case' ]; then cd '${root}/case'; fi\n`;
    python(`import os,json;root=${JSON.stringify(root)};os.mkdir(root,0o700)
for folder in ('Case','case','bin','cache','wrong/claude','wrong/codex'):os.makedirs(root+'/'+folder)
home=${JSON.stringify(home)}
for provider in ('claude','codex'):
    folder=home+('/claude/projects/fixture' if provider=='claude' else '/codex/sessions/2026/10/30');os.makedirs(folder)
    records=([{'type':'user','cwd':root+'/Case','message':{'content':'WSL source prompt'}},{'aiTitle':'WSL launch Claude'}] if provider=='claude' else [{'type':'session_meta','payload':{'id':${JSON.stringify(LIBRARY_ID)},'cwd':root+'/Case'}},{'type':'response_item','payload':{'type':'message','role':'user','content':[{'type':'input_text','text':'WSL launch Codex'}]}}])
    with open(folder+'/'+${JSON.stringify(LIBRARY_ID)}+'.jsonl','w',encoding='utf8') as f:f.write('\\n'.join(json.dumps(x) for x in records))
    with open(root+'/bin/'+provider,'w',encoding='utf8') as f:f.write(${JSON.stringify(stub)})
    os.chmod(root+'/bin/'+provider,0o700)
with open(root+'/rc','w',encoding='utf8') as f:f.write(${JSON.stringify(rc)})`);
  }
  function cleanup(){native.cleanup();if(distro)python(`import os,shutil;root=os.path.realpath(${JSON.stringify(root)});assert os.path.dirname(root)=='/tmp' and os.path.basename(root).startswith('qterm-wsl-launch-');shutil.rmtree(root) if os.path.exists(root) else None`);}
  function flag(name:string){python(`open(${JSON.stringify(root)}+'/'+${JSON.stringify(name)},'w').close()`);}
  function reset(){python(`import os
for name in ('record.json','hold','wrong-case'):
    p=${JSON.stringify(root)}+'/'+name
    if os.path.exists(p):os.unlink(p)`);}
  const record=()=>JSON.parse(python(`import json,os;p=${JSON.stringify(`${root}/record.json`)};print(open(p,encoding='utf8').read() if os.path.exists(p) else 'null')`));
  async function ready(qterm:Qterm){const pane=await qterm.activePane();await expect.poll(async()=>(await qterm.workspace()).panes[pane]?.cwd).toBe(project);await expect.poll(()=>qterm.terminalText(pane)).toContain(`${project}$`);return pane;}
  async function select(qterm:Qterm,provider:"codex"|"claude"){const panel=await openLibrary(qterm.page);await discover(panel);const row=sessionRow(panel,provider,environment);await expect(row).toContainText(`WSL launch ${provider==="codex"?"Codex":"Claude"}`);await row.getByRole("button").click();return panel;}
  return{distro,root,project,home,environment,settings,seed,cleanup,flag,reset,record,python,ready,select};
}
