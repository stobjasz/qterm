// R87: real Linux foreground/background/adopted programs and targeted UI actions.
import {expect,test} from "./qterm";
import {wslLaunchFixture} from "./wsl-launch-fixture";
const fixture=wslLaunchFixture();
test.skip(!fixture.distro,"Requires an installed WSL distribution");
test.use({settings:fixture.settings});
test.beforeAll(()=>{
  if(!fixture.distro)return;
  fixture.seed();
  const script=`import os,sys,ctypes,json,signal,threading
root=${JSON.stringify(fixture.root)};tag=sys.argv[1]
def record(name):
    ctypes.CDLL(None).prctl(15,name.encode(),0,0,0)
    with open(root+'/'+tag+'-'+name+'.json','w') as f:json.dump({'pid':os.getpid(),'start':open('/proc/self/stat').read().rsplit(')',1)[1].split()[19]},f)
record('qterm-main')
if os.fork()==0:
    os.setsid()
    if os.fork():os._exit(0)
    record('qterm-orphan')
    null=os.open('/dev/null',os.O_RDWR)
    for fd in (0,1,2):os.dup2(null,fd)
else:
    def worker():
        if os.fork()==0:
            record('qterm-thread')
        while True:signal.pause()
    threading.Thread(target=worker,daemon=True).start()
    print('LINUX_PROGRAM_READY_'+str(6*7),flush=True)
while True:signal.pause()
`;
  fixture.python(`open(${JSON.stringify(`${fixture.root}/programs.py`)},'w').write(${JSON.stringify(script)})`);
});
test.afterAll(()=>{if(fixture.distro)fixture.cleanup();});
function alive(tag:string,name:string){return fixture.python(`import json,os
try:
    info=json.load(open(${JSON.stringify(`${fixture.root}/${tag}-${name}.json`)}));fields=open('/proc/'+str(info['pid'])+'/stat').read().rsplit(')',1)[1].split();print(fields[0]!='Z' and fields[19]==info['start'])
except FileNotFoundError:print(False)`)==="True";}
test("WSL close names Linux programs and Stop preserves its shell and another pane",async({qterm})=>{
  try{
    const first=await fixture.ready(qterm);await qterm.run(first,`python3 '${fixture.root}/programs.py' first &`);
    await expect.poll(()=>alive("first","qterm-orphan")).toBe(true);
    await qterm.page.getByRole("button",{name:"New tab",exact:true}).click();await expect.poll(()=>qterm.activePane()).not.toBe(first);
    const second=await fixture.ready(qterm);await qterm.run(second,`python3 '${fixture.root}/programs.py' second`);
    await expect.poll(()=>alive("second","qterm-orphan")).toBe(true);await expect.poll(()=>alive("second","qterm-thread")).toBe(true);await expect.poll(()=>qterm.terminalText(second)).toContain("LINUX_PROGRAM_READY_42");
    await qterm.pane(second).getByRole("textbox",{name:"Terminal input",exact:true}).focus();await qterm.page.keyboard.press("Control+Shift+W");
    const dialog=qterm.page.getByRole("alertdialog",{name:"Close this pane?",exact:true});await expect(dialog).toContainText("qterm-main");await expect(dialog).toContainText("qterm-orphan");await expect(dialog).toContainText("qterm-thread");await dialog.getByRole("button",{name:"Cancel",exact:true}).click();
    await qterm.page.keyboard.press("Control+Shift+P");const palette=qterm.page.getByRole("dialog",{name:"Command palette",exact:true});await palette.getByRole("combobox",{name:"Command",exact:true}).fill("stop what runs");await palette.getByRole("option",{name:/Stop what runs in this pane/}).click();
    await expect.poll(()=>alive("second","qterm-main")).toBe(false);await expect.poll(()=>alive("second","qterm-orphan")).toBe(false);await expect.poll(()=>alive("second","qterm-thread")).toBe(false);
    expect(alive("first","qterm-main")).toBe(true);expect(alive("first","qterm-orphan")).toBe(true);
    await qterm.run(second,"printf 'KEPT_LINUX_SHELL_%s\\n' \"$((6*7))\"");await expect.poll(()=>qterm.terminalText(second)).toContain("KEPT_LINUX_SHELL_42");
    // A verified idle shell closes immediately; the other pane remains owned.
    await qterm.pane(second).getByRole("textbox",{name:"Terminal input",exact:true}).focus();await qterm.page.keyboard.press("Control+Shift+W");await expect.poll(async()=>Boolean((await qterm.workspace()).panes[second])).toBe(false);expect(alive("first","qterm-main")).toBe(true);await expect(dialog).toHaveCount(0);
  }finally{await qterm.stop();await expect.poll(()=>alive("first","qterm-main")).toBe(false);await expect.poll(()=>alive("first","qterm-orphan")).toBe(false);await expect.poll(()=>alive("first","qterm-thread")).toBe(false);}
});
