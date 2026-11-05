// R107: observe actual fixture-scoped inotify owners; crash only the Windows app.
import {expect,test} from "./qterm";
import {wslVerificationFixture} from "./wsl-verification-fixture";
import {verificationMonitors} from "./wsl-verification-monitor";
for(const action of ["close","crash"] as const)test.describe(action,()=>{
  const fixture=wslVerificationFixture(),monitors=verificationMonitors(fixture);
  test.skip(!fixture.distro,"Requires an installed WSL distribution");
  test.use({settings:fixture.settings});test.beforeAll(fixture.seed);test.afterAll(fixture.cleanup);
  test(`a ${action==='close'?'closed verification pane':'direct qterm crash'} ends its pending Linux monitor`,async({qterm})=>{
    try{
      const preview=await fixture.preview(qterm),original=await qterm.activePane();fixture.flag("hold");
      await preview.getByRole("button",{name:"Run reviewed command",exact:true}).click();await expect(preview).toBeHidden();
      const pending=await qterm.activePane();expect(pending).not.toBe(original);
      await expect.poll(()=>qterm.terminalText(pending)).toContain("WSL_PROFILE_WAITING_42");
      await expect.poll(monitors.list).toHaveLength(1);const [owned]=monitors.list();
      if(action==="crash")await qterm.crash();
      else{
        await qterm.pane(pending).getByRole("textbox",{name:"Terminal input",exact:true}).focus();await qterm.page.keyboard.press("Control+Shift+W");
        const confirm=qterm.page.getByRole("alertdialog",{name:"Close this pane?",exact:true});
        await expect.poll(async()=>await confirm.isVisible()||!(await qterm.workspace()).panes[pending]).toBe(true);
        if(await confirm.isVisible())await confirm.getByRole("button",{name:"Close pane",exact:true}).click();
        await expect.poll(async()=>Boolean((await qterm.workspace()).panes[pending])).toBe(false);
      }
      await expect.poll(()=>monitors.list().filter(item=>item.pid===owned.pid&&item.start===owned.start),{message:"the observed Linux monitor to exit without test cleanup"}).toEqual([]);
      expect(fixture.executions()).toBe(1);
      if(action==="close"){
        expect(await qterm.activePane()).toBe(original);await qterm.run(original,"printf 'VERIFY_OTHER_PANE_%s\\n' \"$((6*7))\"");
        await expect.poll(()=>qterm.terminalText(original)).toContain("VERIFY_OTHER_PANE_42");
      }
    }finally{await qterm.stop();monitors.cleanup();}
  });
});
