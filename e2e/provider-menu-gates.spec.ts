// R85: disable an already discovered real source through the watched config file.
import fs from "node:fs";import path from "node:path";
import {expect,IDENTIFIER,test} from "./qterm";
import {openLibrary,discover} from "./session-library-fixture";
import {providerMenuFixture} from "./provider-menu-fixture";
const fixture=providerMenuFixture();test.skip(!fixture.distro,"Requires an installed WSL distribution");test.use({settings:fixture.settings});test.beforeAll(fixture.seed);test.afterAll(fixture.cleanup);test.beforeEach(()=>fixture.reset());
for(const provider of ["claude","codex"] as const)test(`${provider} menu cannot revive a disabled source or substitute an unavailable distro`,async({qterm})=>{
  await fixture.ready(qterm);const panel=await openLibrary(qterm.page);await discover(panel);await expect(panel).toContainText("WSL launch Codex");const config=path.join(process.env.APPDATA!,IDENTIFIER,"config.toml");fs.writeFileSync(config,qterm.settingsOnDisk().replace(/^wsl_sources\s*=.*$/m,line=>line.replace(/enabled\s*=\s*true/,"enabled=false")));await expect(panel).toContainText("source disabled");await panel.getByRole("button",{name:"Close session library",exact:true}).click();
  for(const environment of [fixture.environment,fixture.other]){const menu=await fixture.menu(qterm,provider);await fixture.group(menu,environment).getByRole("menuitem").click();await expect.poll(async()=>await qterm.page.getByRole("status").count()>0||(await qterm.workspace()).tabs.length!==1).toBe(true);expect((await qterm.workspace()).tabs).toHaveLength(1);await expect(qterm.page.getByRole("status")).toContainText(`Could not resume ${provider}`);expect(fixture.record()).toBeNull();}
});
