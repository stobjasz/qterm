// R91: actual delayed Linux inspection, terminal input and UI layout changes.
import {expect,test} from "./qterm";
import {wslLaunchFixture} from "./wsl-launch-fixture";
import {signalOwner} from "./wsl-owner-signal";
const fixture=wslLaunchFixture();test.skip(!fixture.distro,"Requires an installed WSL distribution");test.use({settings:fixture.settings});test.beforeAll(fixture.seed);test.afterAll(()=>{if(fixture.distro)fixture.cleanup();});
for(const change of ["input","split","exit"] as const)test(`a delayed close ignores obsolete ${change} context`,async({qterm})=>{
  let paused=false;
  try{
    const pane=await fixture.ready(qterm);await qterm.run(pane,`printf '%s' "$PPID" > '${fixture.root}/owner.pid'; printf 'CLOSE_OWNER_%s\\n' "$((6*7))"`);await expect.poll(()=>qterm.terminalText(pane)).toContain("CLOSE_OWNER_42");
    signalOwner(fixture,true);paused=true;
    if(change==="split")await qterm.page.getByRole("tab").first().getByRole("button",{name:/^Close /}).click();
    else {await qterm.pane(pane).getByRole("textbox",{name:"Terminal input",exact:true}).focus();await qterm.page.keyboard.press("Control+Shift+W");}
    if(change==="input"){
      await qterm.run(pane,"sleep 1000 & printf 'NEW_CLOSE_INPUT_%s\\n' \"$((6*7))\"");await expect.poll(()=>qterm.terminalText(pane)).toContain("NEW_CLOSE_INPUT_42");
    }else if(change==="split"){
      await qterm.pane(pane).getByRole("textbox",{name:"Terminal input",exact:true}).focus();await qterm.page.keyboard.press("Alt+Shift+=");await expect.poll(async()=>Object.keys((await qterm.workspace()).panes).length).toBe(2);
    }else{
      await qterm.run(pane,"exit");signalOwner(fixture,false);paused=false;await expect.poll(async()=>Boolean((await qterm.workspace()).panes[pane])).toBe(false);
    }
    await expect(qterm.page.getByRole("status")).toContainText("changed while checking running programs");await expect(qterm.page.getByRole("alertdialog")).toHaveCount(0);
    if(change!=="exit")expect((await qterm.workspace()).panes[pane]).toBeTruthy();if(change==="split")expect(Object.keys((await qterm.workspace()).panes)).toHaveLength(2);
  }finally{if(paused)signalOwner(fixture,false);await qterm.stop();}
});
test("accepting a close confirmation cannot act after its original session exits",async({qterm})=>{
  try{
    const child=`import os,sys,signal; signal.signal(signal.SIGUSR1,lambda *_:sys.exit(0)); open("${fixture.root}/release.pid","w").write(str(os.getpid())); print("CLOSE_CHILD_READY_"+str(6*7),flush=True); signal.pause()`;
    const pane=await fixture.ready(qterm);await qterm.page.getByRole("button",{name:"New tab",exact:true}).click();await expect.poll(()=>qterm.activePane()).not.toBe(pane);const kept=await fixture.ready(qterm);await qterm.page.getByRole("tab").first().click();
    await qterm.run(pane,`python3 -c '${child}'; exit`);await expect.poll(()=>qterm.terminalText(pane)).toContain("CLOSE_CHILD_READY_42");
    await qterm.page.getByRole("tab").first().getByRole("button",{name:/^Close /}).click();const dialog=qterm.page.getByRole("alertdialog",{name:"Close this tab?",exact:true});await expect(dialog).toContainText("python");
    fixture.python(`import os,signal;pid=int(open(${JSON.stringify(`${fixture.root}/release.pid`)}).read());handle=os.pidfd_open(pid)
try:
    assert open('/proc/'+str(pid)+'/cmdline','rb').read().rstrip(b'\\0').split(b'\\0')[-1]==${JSON.stringify(child)}.encode()
    signal.pidfd_send_signal(handle,signal.SIGUSR1)
finally:os.close(handle)`);await expect.poll(async()=>Boolean((await qterm.workspace()).panes[pane])).toBe(false);await expect.poll(()=>qterm.activePane()).not.toBe(pane);const replacement=await qterm.activePane();
    expect(replacement).toBe(kept);await dialog.getByRole("button",{name:"Close tab",exact:true}).click();await expect(qterm.page.getByRole("status")).toContainText("changed while checking running programs");expect((await qterm.workspace()).panes[replacement]).toBeTruthy();
  }finally{await qterm.stop();}
});
