// R112: actual Bash startup enters a distinct case-sensitive Linux directory.
import {expect,test} from "./qterm";
import {wslVerificationFixture} from "./wsl-verification-fixture";
import {verificationMonitors} from "./wsl-verification-monitor";
const fixture=wslVerificationFixture(),monitors=verificationMonitors(fixture);
test.skip(!fixture.distro,"Requires an installed WSL distribution");test.use({settings:fixture.settings});
test.beforeAll(fixture.seed);test.afterAll(fixture.cleanup);
test("a differently cased startup folder cancels Linux verification and releases its monitor",async({qterm})=>{
  try{
    const preview=await fixture.preview(qterm);fixture.flag('hold');fixture.flag('wrong-case');
    fixture.python(`import shutil
for name in ('check.py','value.txt'):shutil.copyfile(${JSON.stringify(fixture.project)}+'/'+name,${JSON.stringify(`${fixture.root}/case`)}+'/'+name)`);
    await preview.getByRole('button',{name:'Run reviewed command',exact:true}).click();await expect(preview).toBeHidden();const pane=await qterm.activePane();
    await expect.poll(()=>qterm.terminalText(pane)).toContain('WSL_PROFILE_WAITING_42');await expect.poll(monitors.list).toHaveLength(1);
    await qterm.pane(pane).getByRole('textbox',{name:'Terminal input',exact:true}).press('Enter');
    const error=qterm.page.getByRole('status').filter({hasText:'Startup command cancelled: the shell started in a different folder'});
    await expect.poll(async()=>await error.isVisible()||(await qterm.terminalText(pane)).includes('VERIFIED_42')).toBe(true);
    expect(fixture.python(`import os;print(os.path.exists(${JSON.stringify(`${fixture.root}/case/target/executions`)}))`)).toBe('False');
    await expect(error).toBeVisible();
    await expect.poll(monitors.list).toEqual([]);await qterm.run(pane,"printf 'CASE_SHELL_KEPT_%s\\n' \"$((6*7))\"");
    await expect.poll(()=>qterm.terminalText(pane)).toContain('CASE_SHELL_KEPT_42');expect(fixture.executions()).toBe(1);expect(await qterm.terminalText(pane)).not.toContain('VERIFIED_42');
  }finally{await qterm.stop();monitors.cleanup();}
});
