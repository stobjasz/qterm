// R80: actual double-forked/setsid Linux processes and real Windows app exit.
import {expect,test} from "./qterm";
import {wslLaunchFixture} from "./wsl-launch-fixture";
const fixture=wslLaunchFixture();test.skip(!fixture.distro,"Requires an installed WSL distribution");test.use({settings:fixture.settings});
const daemon=`import os,sys,json,signal
root=${JSON.stringify(fixture.root)};tag=sys.argv[1]
if os.fork():sys.exit(0)
os.setsid()
if os.fork():os._exit(0)
null=os.open('/dev/null',os.O_RDWR)
for fd in (0,1,2):os.dup2(null,fd)
info={'pid':os.getpid(),'start':open('/proc/self/stat').read().rsplit(')',1)[1].split()[19]}
with open(root+'/'+tag+'.tmp','w') as f:json.dump(info,f)
os.replace(root+'/'+tag+'.tmp',root+'/'+tag+'.json')
while True:signal.pause()
`;
const alive=(tag:string)=>fixture.python(`import os,json;p=${JSON.stringify(fixture.root)}+'/'+${JSON.stringify(tag)}+'.json'
try:
    info=json.load(open(p));fields=open('/proc/'+str(info['pid'])+'/stat').read().rsplit(')',1)[1].split();print(fields[0]!='Z' and fields[19]==info['start'])
except FileNotFoundError:print(False)`)==="True";
function cleanup(){fixture.python(`import os,json,signal;root=${JSON.stringify(fixture.root)}
for tag in ('first','second','unrelated'):
    handle=None
    try:
        info=json.load(open(root+'/'+tag+'.json'));pid=info['pid'];handle=os.pidfd_open(pid)
        fields=open('/proc/'+str(pid)+'/stat').read().rsplit(')',1)[1].split()
        args=open('/proc/'+str(pid)+'/cmdline','rb').read().rstrip(b'\\0').split(b'\\0')
        if fields[19]==info['start'] and args[-2:]==[(root+'/daemon.py').encode(),tag.encode()]:signal.pidfd_send_signal(handle,signal.SIGKILL)
    except (FileNotFoundError,ProcessLookupError):pass
    finally:
        if handle is not None:os.close(handle)`);}
test.beforeAll(()=>{if(!fixture.distro)return;fixture.seed();fixture.python(`open(${JSON.stringify(`${fixture.root}/daemon.py`)},'w').write(${JSON.stringify(daemon)})`);});
test.afterAll(()=>{if(!fixture.distro)return;cleanup();fixture.cleanup();});test.beforeEach(()=>{cleanup();fixture.python(`import os
for tag in ('first','second','unrelated'):
    p=${JSON.stringify(fixture.root)}+'/'+tag+'.json'
    if os.path.exists(p):os.unlink(p)`);});
for(const exit of ["quit","crash"] as const)test(`closing one WSL pane and a later ${exit} ends only qterm-owned detached Linux processes`,async({qterm})=>{
  try{
    const first=await fixture.ready(qterm);await qterm.run(first,`python3 '${fixture.root}/daemon.py' first`);await expect.poll(()=>alive("first")).toBe(true);
    await qterm.page.getByRole("button",{name:"New tab",exact:true}).click();await expect.poll(()=>qterm.activePane()).not.toBe(first);const second=await fixture.ready(qterm);await qterm.run(second,`python3 '${fixture.root}/daemon.py' second`);await expect.poll(()=>alive("second")).toBe(true);
    fixture.python(`import subprocess;subprocess.run(['/usr/bin/python3',${JSON.stringify(`${fixture.root}/daemon.py`)},'unrelated'],check=True,stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)`);await expect.poll(()=>alive("unrelated")).toBe(true);
    await qterm.page.getByRole("tab").nth(0).click();await qterm.pane(first).getByRole("textbox",{name:"Terminal input",exact:true}).focus();await qterm.page.keyboard.press("Control+Shift+W");const confirm=qterm.page.getByRole("alertdialog",{name:"Close this pane?",exact:true});await expect.poll(async()=>await confirm.isVisible()||!(await qterm.workspace()).panes[first]).toBeTruthy();if(await confirm.isVisible())await confirm.getByRole("button",{name:"Close pane",exact:true}).click();await expect.poll(async()=>Boolean((await qterm.workspace()).panes[first])).toBe(false);await expect.poll(()=>alive("first")).toBe(false);expect(alive("second")).toBe(true);expect(alive("unrelated")).toBe(true);
    if(exit==="quit")await qterm.quit();else await qterm.stop();await expect.poll(()=>alive("second")).toBe(false);expect(alive("unrelated")).toBe(true);
  }finally{await qterm.stop();cleanup();}
});
