// R79: actual running read, real case-sensitive folders, actual broadcast mode.
import {expect,test} from "./qterm";
import {wslOutputFixture} from "./wsl-output-fixture";
const fixture=wslOutputFixture();test.skip(!fixture.distro,"Requires an installed WSL distribution");test.use({settings:fixture.settings});test.beforeAll(fixture.seed);test.afterAll(fixture.cleanup);test.beforeEach(()=>fixture.reset());
for(const reason of ["busy","folder","broadcast"] as const)test(`a WSL ${reason} source rejects output handoff without typing an agent command`,async({qterm})=>{
  const source=await fixture.output(qterm);
  if(reason==="busy"){await qterm.run(source.pane,"printf 'READ_WAITING_%s\\n' \"$((6*7))\"; read -r forbiddenAgentInput; printf 'READ_RECEIVED_%s\\n' \"$forbiddenAgentInput\"");await expect.poll(()=>qterm.terminalText(source.pane)).toContain("READ_WAITING_42");}
  if(reason==="folder"){await qterm.run(source.pane,`cd '${fixture.root}/case'`);await expect.poll(async()=>(await qterm.workspace()).panes[source.pane]?.cwd).toBe(`${fixture.root}/case`);}
  if(reason==="broadcast"){
    await qterm.pane(source.pane).getByRole("textbox",{name:"Terminal input",exact:true}).focus();await qterm.page.keyboard.press("Alt+Shift+B");
    await expect(qterm.page.getByLabel("Broadcasting input",{exact:true})).toBeVisible();
  }
  const dialog=await fixture.review(qterm,source.bar);await dialog.getByRole("combobox",{name:"Agent destination",exact:true}).selectOption("current");await dialog.getByRole("button",{name:"Open agent with brief",exact:true}).click();await expect(dialog.getByRole("alert")).toContainText(reason==="busy"?"source pane is busy":reason==="folder"?"changed shell or folder":"broadcast");await expect(qterm.page.getByRole("tab")).toHaveCount(1);expect(fixture.record()).toBeNull();expect(await qterm.terminalText(source.pane)).not.toContain("Read the task brief at");expect(await qterm.terminalText(source.pane)).not.toContain("READ_RECEIVED_Read the task brief");
});
