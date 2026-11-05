// R88: a real stopped supervisor makes the authenticated data operation time out.
import fs from "node:fs";
import {expect,test} from "./qterm";
import {wslLaunchFixture} from "./wsl-launch-fixture";
const fixture=wslLaunchFixture();
const script=fs.readFileSync("src-tauri/src/wsl_owner.py","utf8");
test.skip(!fixture.distro,"Requires an installed WSL distribution");test.use({settings:fixture.settings});test.beforeAll(fixture.seed);test.afterAll(()=>{if(fixture.distro)fixture.cleanup();});
function signalOwner(pause:boolean){fixture.python(`import os,sys,signal
root=${JSON.stringify(fixture.root)};pid=int(open(root+'/owner.pid').read())
try:handle=os.pidfd_open(pid)
except ProcessLookupError:
    if ${pause?"True":"False"}:raise
    sys.exit(0)
try:
    args=open('/proc/'+str(pid)+'/cmdline','rb').read().rstrip(b'\\0').split(b'\\0')
    fields=open('/proc/'+str(pid)+'/stat').read().rsplit(')',1)[1].split()
    if ${pause?"True":"False"}:
        assert args[1:5]==[b'-I',b'-S',b'-c',${JSON.stringify(script)}.encode()]
        open(root+'/owner-start','w').write(fields[19])
    elif args[1:5]!=[b'-I',b'-S',b'-c',${JSON.stringify(script)}.encode()] or fields[19]!=open(root+'/owner-start').read():sys.exit(0)
    signal.pidfd_send_signal(handle,signal.SIGSTOP if ${pause?"True":"False"} else signal.SIGCONT)
except (FileNotFoundError,ProcessLookupError):
    if ${pause?"True":"False"}:raise
finally:os.close(handle)`);}
test("a failed Linux probe asks before close and Stop cannot claim the pane is idle",async({qterm})=>{
  let paused=false;
  try{
    const pane=await fixture.ready(qterm);await qterm.run(pane,`printf '%s' "$PPID" > '${fixture.root}/owner.pid'; printf 'OWNER_RECORDED_%s\\n' "$((6*7))"`);await expect.poll(()=>qterm.terminalText(pane)).toContain("OWNER_RECORDED_42");
    signalOwner(true);paused=true;
    await qterm.pane(pane).getByRole("textbox",{name:"Terminal input",exact:true}).focus();await qterm.page.keyboard.press("Control+Shift+W");
    const dialog=qterm.page.getByRole("alertdialog",{name:"Close this pane?",exact:true});await expect(dialog).toContainText("Could not check running programs");await expect(dialog.getByRole("alert")).toContainText("Could not inspect Linux programs");await dialog.getByRole("button",{name:"Cancel",exact:true}).click();expect((await qterm.workspace()).panes[pane]).toBeTruthy();
    await qterm.page.keyboard.press("Control+Shift+P");const palette=qterm.page.getByRole("dialog",{name:"Command palette",exact:true});await palette.getByRole("combobox",{name:"Command",exact:true}).fill("stop what runs");await palette.getByRole("option",{name:/Stop what runs in this pane/}).click();await expect(qterm.page.getByRole("status")).toContainText("Could not stop it: Could not stop Linux programs");
    // Start a new program while the old Stop is still queued at the suspended
    // supervisor. Resuming it must not execute that expired request.
    await qterm.run(pane,"sleep 1000 & printf 'AFTER_PROBE_FAILURE_%s\\n' \"$((6*7))\"");await expect.poll(()=>qterm.terminalText(pane)).toContain("AFTER_PROBE_FAILURE_42");
    signalOwner(false);paused=false;
    await qterm.pane(pane).getByRole("textbox",{name:"Terminal input",exact:true}).focus();await qterm.page.keyboard.press("Control+Shift+W");await expect(dialog).toContainText("sleep");await dialog.getByRole("button",{name:"Cancel",exact:true}).click();
  }finally{if(paused)signalOwner(false);await qterm.stop();}
});
