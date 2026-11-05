// R108: kill only the fixture's pinned inotify helper, not its interactive shell.
import {expect,test} from "./qterm";
import {wslVerificationFixture} from "./wsl-verification-fixture";
import {verificationMonitors} from "./wsl-verification-monitor";
for(const stage of ["before","during"] as const)test.describe(stage,()=>{
  const fixture=wslVerificationFixture(),monitors=verificationMonitors(fixture);
  test.skip(!fixture.distro,"Requires an installed WSL distribution");
  test.use({settings:fixture.settings});test.beforeAll(fixture.seed);test.afterAll(fixture.cleanup);
  test(`losing Linux coverage ${stage} execution cannot produce matching evidence`,async({qterm})=>{
    try{
      const preview=await fixture.preview(qterm);
      if(stage==="before")fixture.flag("hold");else fixture.pause();
      await preview.getByRole("button",{name:"Run reviewed command",exact:true}).click();await expect(preview).toBeHidden();const pane=await qterm.activePane();
      await expect.poll(()=>qterm.terminalText(pane)).toContain(stage==="before"?"WSL_PROFILE_WAITING_42":"VERIFY_WAITING_42");
      await expect.poll(monitors.list).toHaveLength(1);monitors.end(monitors.list()[0]);await expect.poll(monitors.list).toEqual([]);
      if(stage==="before"){
        await qterm.pane(pane).getByRole("textbox",{name:"Terminal input",exact:true}).press("Enter");
        const error=qterm.page.getByRole("status").filter({hasText:"Source startup failed"});
        await expect.poll(async()=>await error.isVisible()||(await qterm.terminalText(pane)).includes("VERIFIED_42")).toBe(true);
        expect(fixture.executions()).toBe(1);await expect(error).toBeVisible();
        await qterm.run(pane,"printf 'VERIFY_LOST_SHELL_%s\\n' \"$((6*7))\"");await expect.poll(()=>qterm.terminalText(pane)).toContain("VERIFY_LOST_SHELL_42");
        expect(fixture.executions()).toBe(1);expect(await qterm.terminalText(pane)).not.toContain("VERIFIED_42");
      }else{
        fixture.python(`with open(${JSON.stringify(`${fixture.project}/target/release`)},'w') as f:f.write('finish\\n')`);
        await expect.poll(()=>qterm.terminalText(pane)).toContain("VERIFIED_42");const panel=await fixture.inspect(qterm);
        await expect(panel.getByRole("status",{name:"Verification freshness",exact:true})).toContainText("Freshness unknown");
        await expect(panel.getByLabel("Run details",{exact:true})).toContainText("Exit 0");expect(fixture.executions()).toBe(2);
      }
    }finally{await qterm.stop();monitors.cleanup();}
  });
});
