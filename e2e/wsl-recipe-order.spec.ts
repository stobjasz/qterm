// R113: real Linux command order, literal cwd, record attribution and no replay.
import {expect,test} from "./qterm";
import {reviewRecipe,launchRecipe} from "./recipe-fixture";
import {wslRecipeFixture} from "./wsl-recipe-fixture";
const fixture=wslRecipeFixture();
test.skip(!fixture.distro,'Requires an installed WSL distribution');test.use({settings:fixture.settings});
test.beforeAll(fixture.seed);test.afterAll(fixture.cleanup);
test('a reviewed Linux recipe retains dependency order, literal folders and results without replay',async({qterm})=>{
  await fixture.ready(qterm);const panel=await reviewRecipe(qterm.page,fixture.project,'custom:WSL launch');
  await expect(panel.getByRole('region',{name:'Workflow launch review',exact:true})).toContainText(`Environment: ${fixture.environment}`);
  const run=await launchRecipe(panel),build=run.getByLabel('Workflow step build',{exact:true}),check=run.getByLabel('Workflow step check',{exact:true});
  await expect(build.getByLabel('Recipe step state',{exact:true})).toHaveText('running');
  await expect(check.getByLabel('Recipe step state',{exact:true})).toHaveText('pending');
  const workspace=await qterm.workspace();expect(workspace.tabs).toHaveLength(2);expect(Object.keys(workspace.panes)).toHaveLength(3);
  const buildPane=Object.values(workspace.panes).find(pane=>pane.id!==workspace.tabs[0].focusedPane&&pane.cwd===fixture.project)!;
  await expect.poll(()=>qterm.terminalText(buildPane.id)).toContain('LINUX_RECIPE_WAITING_42');
  fixture.release();await expect(build.getByLabel('Recipe step state',{exact:true})).toHaveText('succeeded');await expect(check.getByLabel('Recipe step state',{exact:true})).toHaveText('succeeded');
  expect(fixture.read('order')).toBe('build\ncheck');
  const checked=Object.values((await qterm.workspace()).panes).find(pane=>pane.cwd===fixture.folder)!;
  expect(checked.environment).toBe(fixture.environment);await expect.poll(()=>qterm.terminalText(checked.id)).toContain('LINUX_RECIPE_CHECK_42');
  await run.getByRole('button',{name:'Inspect check result',exact:true}).click();
  const problems=qterm.page.getByRole('dialog',{name:'Problems and command runs',exact:true});await expect(problems.getByLabel('Run details',{exact:true})).toContainText(`Environment: ${fixture.environment}`);await expect(problems.getByLabel('Run details',{exact:true})).toContainText('Requested by Workflow pipeline');await expect(problems.getByRole('status',{name:'Verification freshness',exact:true})).toContainText('repository matches checked state');
  await problems.getByRole('button',{name:'Close problems',exact:true}).click();await qterm.restart();
  for(const pane of Object.values((await qterm.workspace()).panes))await expect.poll(async()=>(await qterm.terminalText(pane.id)).trimEnd().endsWith(`${pane.cwd}$`)).toBe(true);
  expect(fixture.read('order')).toBe('build\ncheck');await qterm.page.getByRole('button',{name:'Workflow recipes',exact:true}).click();await expect(qterm.page.getByRole('dialog',{name:'Workflow recipes',exact:true}).getByLabel('Workflow run pipeline',{exact:true})).toHaveCount(0);
});
