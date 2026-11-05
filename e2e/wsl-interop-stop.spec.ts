// R99: keeping the pane's job alive must not leave detached Windows programs running.
import {expect,test} from "./qterm";
import {wslInteropFixture} from "./wsl-interop-fixture";
const fixture=wslInteropFixture();
test.skip(!fixture.distro,"Requires an installed WSL distribution");
test.use({settings:fixture.settings});test.beforeAll(fixture.seed);test.afterAll(()=>{if(fixture.distro)fixture.cleanup();});
test("Stop in a WSL pane ends its Windows descendants while its shell and other programs survive",async({qterm})=>{
  const unrelated=fixture.unrelated();
  try{
    const first=await fixture.ready(qterm);await qterm.run(first,fixture.command());await expect.poll(()=>qterm.terminalText(first)).toContain("INTEROP_PROGRAM_42");
    await qterm.page.getByRole("button",{name:"New tab",exact:true}).click();await expect.poll(()=>qterm.activePane()).not.toBe(first);
    const second=await fixture.ready(qterm);await qterm.run(second,fixture.command("other"));await expect.poll(()=>qterm.terminalText(second)).toContain("INTEROP_PROGRAM_42");
    await expect.poll(()=>fixture.inspect().map(p=>p.tag).sort()).toEqual(["other","other-child","owned","owned-child","unrelated","unrelated-child"]);
    const others=fixture.inspect().filter(p=>!p.tag.startsWith("owned")).sort((a,b)=>a.tag.localeCompare(b.tag));
    await qterm.page.getByRole("tab").nth(0).click();await qterm.pane(first).getByRole("textbox",{name:"Terminal input",exact:true}).focus();
    await qterm.page.keyboard.press("Control+Shift+P");const palette=qterm.page.getByRole("dialog",{name:"Command palette",exact:true});await palette.getByRole("combobox",{name:"Command",exact:true}).fill("stop what runs");await palette.getByRole("option",{name:/Stop what runs in this pane/}).click();
    let completion="";
    await expect.poll(async()=>{completion=(await qterm.page.getByRole("status").allTextContents()).find(text=>text.includes("Stopped ")||text.includes("Could not stop it:"))??"";return Boolean(completion);}).toBe(true);
    expect(completion).toContain("Stopped ");
    await expect.poll(()=>fixture.inspect().filter(p=>p.tag.startsWith("owned"))).toEqual([]);
    expect(fixture.inspect().filter(p=>!p.tag.startsWith("owned")).sort((a,b)=>a.tag.localeCompare(b.tag))).toEqual(others);
    expect((await qterm.workspace()).panes[first]).toBeTruthy();expect((await qterm.workspace()).panes[second]).toBeTruthy();
    await qterm.run(first,"printf 'INTEROP_SHELL_KEPT_%s\\n' \"$((6*7))\"");await expect.poll(()=>qterm.terminalText(first)).toContain("INTEROP_SHELL_KEPT_42");
    // The first cleanup must leave interop usable too, not only a Linux echo.
    await qterm.run(first,fixture.command());await expect.poll(()=>fixture.inspect().filter(p=>p.tag.startsWith("owned")).map(p=>p.tag).sort()).toEqual(["owned","owned-child"]);
    await qterm.page.keyboard.press("Control+Shift+P");await palette.getByRole("combobox",{name:"Command",exact:true}).fill("stop what runs");await palette.getByRole("option",{name:/Stop what runs in this pane/}).click();
    await expect.poll(async()=>{completion=(await qterm.page.getByRole("status").allTextContents()).find(text=>text.includes("Stopped ")||text.includes("Could not stop it:"))??"";return Boolean(completion);}).toBe(true);expect(completion).toContain("Stopped ");
    await expect.poll(()=>fixture.inspect().filter(p=>p.tag.startsWith("owned"))).toEqual([]);
    expect(fixture.inspect().filter(p=>!p.tag.startsWith("owned")).sort((a,b)=>a.tag.localeCompare(b.tag))).toEqual(others);
    await qterm.run(first,"printf 'INTEROP_SHELL_REUSED_%s\\n' \"$((6*7))\"");await expect.poll(()=>qterm.terminalText(first)).toContain("INTEROP_SHELL_REUSED_42");
  }finally{await qterm.stop();fixture.inspect(true);unrelated.kill();}
});
