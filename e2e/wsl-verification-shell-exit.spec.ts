// R109: nonzero shell exit leaves its visible error pane, not its monitor.
import {expect,test} from "./qterm";
import {wslVerificationFixture} from "./wsl-verification-fixture";
import {verificationMonitors} from "./wsl-verification-monitor";
const fixture=wslVerificationFixture(),monitors=verificationMonitors(fixture);
test.skip(!fixture.distro,"Requires an installed WSL distribution");
test.use({settings:fixture.settings});test.beforeAll(fixture.seed);test.afterAll(fixture.cleanup);
test("a failed verification shell releases its monitor and keeps its error visible",async({qterm})=>{
  try{
    const preview=await fixture.preview(qterm);fixture.flag("hold");
    await preview.getByRole("button",{name:"Run reviewed command",exact:true}).click();await expect(preview).toBeHidden();const pane=await qterm.activePane();
    await expect.poll(()=>qterm.terminalText(pane)).toContain("WSL_PROFILE_WAITING_42");await expect.poll(monitors.list).toHaveLength(1);
    fixture.flag("exit-startup");await qterm.pane(pane).getByRole("textbox",{name:"Terminal input",exact:true}).press("Enter");
    await expect.poll(()=>qterm.terminalText(pane)).toContain("process exited with code 23");
    expect((await qterm.workspace()).panes[pane]).toBeTruthy();expect(fixture.executions()).toBe(1);
    await expect.poll(monitors.list,{message:"the failed shell's verification monitor to exit without test cleanup"}).toEqual([]);
  }finally{await qterm.stop();monitors.cleanup();}
});
