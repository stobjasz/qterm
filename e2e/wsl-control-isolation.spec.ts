// R82: hostile real Python startup file, inherited environment, actual helpers.
import {expect,test} from "./qterm";
import {wslLaunchFixture} from "./wsl-launch-fixture";
import {openLibrary,discover} from "./session-library-fixture";
const fixture=wslLaunchFixture();test.skip(!fixture.distro,"Requires an installed WSL distribution");test.use({settings:{...fixture.settings,env:{...fixture.settings.env,PYTHONPATH:fixture.project,WSLENV:"PYTHONPATH/u:XDG_CACHE_HOME/u"}}});
test.beforeAll(()=>{if(!fixture.distro)return;fixture.seed();fixture.python(`import json
with open(${JSON.stringify(`${fixture.project}/sitecustomize.py`)},'w') as f:f.write(${JSON.stringify(`open(${JSON.stringify(`${fixture.root}/unexpected-startup`)},'w').write('project code executed')`)})
with open(${JSON.stringify(`${fixture.project}/.qterm.toml`)},'w') as f:f.write('name = "Isolated project control"\\n')`);});test.afterAll(fixture.cleanup);
test("opening a WSL project and discovering source metadata never executes its Python startup file",async({qterm})=>{
  const pane=await fixture.ready(qterm);await expect(qterm.page.getByRole("tab",{name:/Isolated project control/})).toBeVisible();const library=await openLibrary(qterm.page);await discover(library);await expect(library).toContainText("WSL launch Codex");await library.getByRole("button",{name:"Close session library",exact:true}).click();await qterm.run(pane,"printf 'ISOLATED_CONTROL_%s\\n' \"$((6*7))\"");await expect.poll(()=>qterm.terminalText(pane)).toContain("ISOLATED_CONTROL_42");expect(fixture.python(`import os;print(os.path.exists(${JSON.stringify(`${fixture.root}/unexpected-startup`)}))`)).toBe("False");
});
