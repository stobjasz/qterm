// R100: real paused supervisor, real keyboard input, no mocked pending invocation.
import {expect,test} from "./qterm";
import {wslLaunchFixture} from "./wsl-launch-fixture";
import {signalOwner} from "./wsl-owner-signal";
const fixture=wslLaunchFixture();
test.skip(!fixture.distro,"Requires an installed WSL distribution");
test.use({settings:fixture.settings});test.beforeAll(fixture.seed);test.afterAll(()=>{if(fixture.distro)fixture.cleanup();});
test("a pending Stop reserves only its pane's input and releases it after failure",async({qterm})=>{
  let paused=false;
  const blocked=()=>fixture.python(`import os;print(os.path.exists(${JSON.stringify(`${fixture.root}/blocked-input`)}))`)==="True";
  try{
    const first=await fixture.ready(qterm);await qterm.run(first,`printf '%s' "$PPID" > '${fixture.root}/owner.pid'; printf 'STOP_OWNER_%s\\n' "$((6*7))"`);await expect.poll(()=>qterm.terminalText(first)).toContain("STOP_OWNER_42");
    await qterm.page.getByRole("button",{name:"New tab",exact:true}).click();await expect.poll(()=>qterm.activePane()).not.toBe(first);const second=await fixture.ready(qterm);
    await qterm.page.getByRole("tab").nth(0).click();signalOwner(fixture,true);paused=true;
    await qterm.page.keyboard.press("Control+Shift+P");const palette=qterm.page.getByRole("dialog",{name:"Command palette",exact:true});await palette.getByRole("combobox",{name:"Command",exact:true}).fill("stop what runs");await palette.getByRole("option",{name:/Stop what runs in this pane/}).click();
    await expect(qterm.page.getByRole("status").filter({hasText:"Stopping programs;"})).toBeVisible();
    await qterm.run(first,`printf '%s' "$((6*7))" > '${fixture.root}/blocked-input'`);
    await qterm.page.getByRole("tab").nth(1).click();await qterm.run(second,"printf 'OTHER_INPUT_%s\\n' \"$((6*7))\"");await expect.poll(()=>qterm.terminalText(second)).toContain("OTHER_INPUT_42");
    await expect(qterm.page.getByRole("status").filter({hasText:"Could not stop it:"})).toBeVisible();expect(blocked()).toBe(false);
    signalOwner(fixture,false);paused=false;
    await qterm.page.getByRole("tab").nth(0).click();await qterm.run(first,"printf 'INPUT_RELEASED_%s\\n' \"$((6*7))\"");await expect.poll(()=>qterm.terminalText(first)).toContain("INPUT_RELEASED_42");expect(blocked()).toBe(false);
  }finally{if(paused)signalOwner(fixture,false);await qterm.stop();}
});
