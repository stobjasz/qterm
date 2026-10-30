// R84: existing menu action, literal discovered home, real startup barrier/prompt.
import {expect,test} from "./qterm";
import fs from "node:fs";import path from "node:path";
import {providerMenuFixture} from "./provider-menu-fixture";
const fixture=providerMenuFixture();test.skip(!fixture.distro,"Requires an installed WSL distribution");test.use({settings:fixture.settings});test.beforeAll(fixture.seed);test.afterAll(fixture.cleanup);test.beforeEach(()=>fixture.reset());
for(const provider of ["claude","codex"] as const)for(const where of ["new","current"] as const)test(`${provider} remembered-menu resume verifies WSL home and folder in a ${where} pane`,async({qterm})=>{
  const source=await fixture.ready(qterm);if(where==="new"){await qterm.run(source,"read -r untouchedSource");fixture.flag("hold");}else{await qterm.run(source,"cd ..");await expect.poll(async()=>(await qterm.workspace()).panes[source].cwd).toBe(fixture.root);}
  const menu=await fixture.menu(qterm,provider),group=fixture.group(menu);if(where==="new")await group.getByRole("menuitem").click();else await group.getByRole("button",{name:`Resume Linux reference ${provider} in the current tab`,exact:true}).click();
  if(where==="new"){await expect(qterm.page.getByRole("tab")).toHaveCount(2);const pane=await qterm.activePane();await expect.poll(()=>qterm.terminalText(pane)).toContain("WSL_PROFILE_WAITING_42");expect(fixture.record()).toBeNull();await qterm.pane(pane).getByRole("textbox",{name:"Terminal input",exact:true}).press("Enter");}
  const pane=await qterm.activePane();await expect.poll(()=>qterm.terminalText(pane)).toContain("WSL_AGENT_RESULT_42");await expect(qterm.page.getByRole("tab")).toHaveCount(where==="new"?2:1);expect(pane===source).toBe(where==="current");expect(fixture.record()).toMatchObject({provider,mode:"resume",cwd:fixture.project,home:`${fixture.home}/${provider}`});if(where==="new")expect(await qterm.terminalText(source)).not.toContain("Read the task brief");
});
test.describe("relative native source homes",()=>{
  test.use({settings:{...fixture.settings,env:{...fixture.settings.env,CLAUDE_CONFIG_DIR:path.relative(process.cwd(),fixture.settings.env!.CLAUDE_CONFIG_DIR),CODEX_HOME:path.relative(process.cwd(),fixture.settings.env!.CODEX_HOME)}}});
  for(const provider of ["claude","codex"] as const)test(`${provider} native menu resume binds the absolute discovered home before changing folders`,async({qterm})=>{
    await fixture.ready(qterm);const menu=await fixture.menu(qterm,provider);await fixture.group(menu,"native").getByRole("menuitem").click();await expect(qterm.page.getByRole("tab")).toHaveCount(2);const pane=await qterm.activePane();await expect.poll(()=>qterm.terminalText(pane)).toContain("NATIVE_MENU_RESULT_42");expect(JSON.parse(fs.readFileSync(fixture.nativeRecord,"utf8"))).toMatchObject({provider,cwd:fixture.nativeProject,home:provider==="claude"?fixture.settings.env!.CLAUDE_CONFIG_DIR:fixture.settings.env!.CODEX_HOME});
  });
});
