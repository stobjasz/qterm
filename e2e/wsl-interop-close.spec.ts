// R98: per-pane ownership cannot be substituted by app-wide termination.
import {expect,test} from "./qterm";
import {wslInteropFixture} from "./wsl-interop-fixture";
const fixture=wslInteropFixture();
test.skip(!fixture.distro,"Requires an installed WSL distribution");
test.use({settings:fixture.settings});test.beforeAll(fixture.seed);test.afterAll(()=>{if(fixture.distro)fixture.cleanup();});
test("closing one WSL pane ends its Windows descendants and preserves other Windows programs",async({qterm})=>{
  const unrelated=fixture.unrelated();
  try{
    const first=await fixture.ready(qterm);await qterm.run(first,fixture.command());await expect.poll(()=>qterm.terminalText(first)).toContain("INTEROP_PROGRAM_42");
    await qterm.page.getByRole("button",{name:"New tab",exact:true}).click();await expect.poll(()=>qterm.activePane()).not.toBe(first);
    const second=await fixture.ready(qterm);await qterm.run(second,fixture.command("other"));await expect.poll(()=>qterm.terminalText(second)).toContain("INTEROP_PROGRAM_42");
    await expect.poll(()=>fixture.inspect().map(p=>p.tag).sort()).toEqual(["other","other-child","owned","owned-child","unrelated","unrelated-child"]);
    const others=fixture.inspect().filter(p=>!p.tag.startsWith("owned")).sort((a,b)=>a.tag.localeCompare(b.tag));
    await qterm.page.getByRole("tab").nth(0).click();await qterm.pane(first).getByRole("textbox",{name:"Terminal input",exact:true}).focus();await qterm.page.keyboard.press("Control+Shift+W");
    const dialog=qterm.page.getByRole("alertdialog",{name:"Close this pane?",exact:true});
    await expect.poll(async()=>await dialog.isVisible()||!(await qterm.workspace()).panes[first]).toBe(true);
    if(await dialog.isVisible())await dialog.getByRole("button",{name:"Close pane",exact:true}).click();
    await expect.poll(async()=>Boolean((await qterm.workspace()).panes[first])).toBe(false);
    await expect.poll(()=>fixture.inspect().filter(p=>p.tag.startsWith("owned"))).toEqual([]);
    expect(fixture.inspect().filter(p=>!p.tag.startsWith("owned")).sort((a,b)=>a.tag.localeCompare(b.tag))).toEqual(others);
    expect((await qterm.workspace()).panes[second]).toBeTruthy();
  }finally{await qterm.stop();fixture.inspect(true);unrelated.kill();}
});
