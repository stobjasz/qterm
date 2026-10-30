// R75: real WSL shell and executable fixtures; no models or provider hooks.
import {expect,test} from "./qterm";
import {LIBRARY_ID} from "./session-library-fixture";
import {wslLaunchFixture} from "./wsl-launch-fixture";
const fixture=wslLaunchFixture();test.skip(!fixture.distro,"Requires an installed WSL distribution");test.use({settings:fixture.settings});test.beforeAll(fixture.seed);test.afterAll(fixture.cleanup);test.beforeEach(()=>fixture.reset());
for(const provider of ["codex","claude"] as const)test(`resuming ${provider} uses the selected WSL source home and project while the existing shell stays busy`,async({qterm})=>{
  const source=await fixture.ready(qterm);await qterm.run(source,"read -r sourceStillBusy");const library=await fixture.select(qterm,provider);await library.getByRole("button",{name:"Resume selected session in new tab",exact:true}).click();await expect(qterm.page.getByRole("tab")).toHaveCount(2);const agent=await qterm.activePane();await expect.poll(()=>qterm.terminalText(agent)).toContain("WSL_AGENT_RESULT_42");
  expect(fixture.record()).toMatchObject({mode:"resume",provider,cwd:fixture.project,home:`${fixture.home}/${provider}`});expect(fixture.record().args.at(-1)).toBe(LIBRARY_ID);expect(await qterm.terminalText(source)).not.toContain("WSL_AGENT_RESULT_42");
});
