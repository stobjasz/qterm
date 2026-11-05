// R116: quit during a real blocked command; cached output cannot grant a replay.
import {expect,test} from './qterm';
import {reviewRecipe,launchRecipe} from './recipe-fixture';
import {wslRecipeFixture} from './wsl-recipe-fixture';
const fixture=wslRecipeFixture();test.skip(!fixture.distro,'Requires an installed WSL distribution');test.use({settings:fixture.settings});test.beforeAll(fixture.seed);test.afterAll(fixture.cleanup);
test('restarting an active Linux recipe ends its old program without replaying either step',async({qterm})=>{
  await fixture.ready(qterm);const panel=await reviewRecipe(qterm.page,fixture.project,'custom:WSL launch'),run=await launchRecipe(panel);
  await expect.poll(()=>fixture.python(`import os;print(os.path.exists(${JSON.stringify(`${fixture.project}/target/build.json`)}))`)).toBe('True');
  await expect(run.getByLabel('Workflow step check',{exact:true}).getByLabel('Recipe step state',{exact:true})).toHaveText('pending');
  const identity=JSON.parse(fixture.read('build.json'));expect(identity.pid).toBeGreaterThan(1);
  await panel.getByRole('button',{name:'Close recipes',exact:true}).click();await qterm.restart();
  await expect.poll(()=>fixture.python(`import os
owner=${JSON.stringify(identity)}
try:
    fields=open('/proc/'+str(owner['pid'])+'/stat').read().rpartition(') ')[2].split()
    print(fields[0]!='Z' and fields[19]==owner['start'])
except FileNotFoundError:print(False)`)).toBe('False');
  for(const pane of Object.values((await qterm.workspace()).panes)){
    expect(pane.environment).toBe(fixture.environment);await expect.poll(async()=>(await qterm.terminalText(pane.id)).trimEnd().endsWith(`${pane.cwd}$`)).toBe(true);
  }
  expect(fixture.python(`import os;print(os.path.exists(${JSON.stringify(`${fixture.project}/target/order`)}))`)).toBe('False');expect(JSON.parse(fixture.read('build.json'))).toEqual(identity);
  await qterm.page.getByRole('button',{name:'Workflow recipes',exact:true}).click();await expect(qterm.page.getByRole('dialog',{name:'Workflow recipes',exact:true}).getByLabel('Workflow run pipeline',{exact:true})).toHaveCount(0);
});
