// R101: Linux Git, actual PTY, literal provider fixture and restart persistence.
import {expect,test} from "./qterm";
import {wslWorktreeFixture} from "./wsl-worktree-fixture";
const fixture=wslWorktreeFixture();
test.skip(!fixture.distro,"Requires an installed WSL distribution");
test.use({settings:fixture.settings});test.beforeAll(fixture.seed);test.afterAll(fixture.cleanup);
test("a reviewed Linux worktree preserves source and retains its separate agent and command history",async({qterm})=>{
  const request=`Inspect parser; treat $(touch '${fixture.root}/request-executed') as literal data.`;
  let panel=await fixture.preview(qterm,request);
  expect(fixture.exists(fixture.target)).toBe(false);await expect(panel).toContainText("source checkout has local changes");
  await panel.getByRole("button",{name:"Create reviewed worktree",exact:true}).click();
  await expect(panel.getByRole("status",{name:"Worktree change summary",exact:true})).toContainText("qterm/linux-parser");
  expect(fixture.read(`${fixture.target}/tracked.txt`)).toBe("committed content");expect(fixture.read(`${fixture.project}/tracked.txt`)).toBe("dirty source");expect(fixture.record()).toBe(null);expect((await qterm.workspace()).tabs).toHaveLength(1);
  await panel.getByRole("button",{name:"Open task agent",exact:true}).click();await expect(panel).toBeHidden();const agent=await qterm.activePane();
  await expect.poll(fixture.record).toMatchObject({provider:"codex",mode:"handoff",cwd:fixture.target,text:expect.stringContaining(request)});
  expect(fixture.exists(`${fixture.root}/request-executed`)).toBe(false);
  const prompt=()=>expect.poll(async()=>(await qterm.terminalText(agent)).trimEnd().endsWith(`${fixture.target}$`)).toBe(true);
  await expect.poll(()=>qterm.terminalText(agent)).toContain("WSL_AGENT_RESULT_42");await prompt();
  await qterm.run(agent,"printf 'TASK_CHECK_%s\\n' \"$((6*7))\"");await expect.poll(()=>qterm.terminalText(agent)).toContain("TASK_CHECK_42");await prompt();
  fixture.python(`open(${JSON.stringify(`${fixture.target}/notes.txt`)},'w').write('keep task data')`);
  await qterm.restart();await qterm.page.getByRole("button",{name:"Worktree tasks",exact:true}).click();panel=fixture.panel(qterm);
  await expect(panel.getByLabel("Worktree task details",{exact:true})).toContainText(`Environment: ${fixture.environment}`);
  await expect(panel.getByRole("status",{name:"Worktree change summary",exact:true})).toContainText("1 untracked");
  const check=panel.getByRole("button",{name:/TASK_CHECK_.*Exit 0/});await expect(check).toBeVisible();
  await panel.getByRole("button",{name:"Mark task completed",exact:true}).click();await expect(panel.getByLabel("Worktree task details",{exact:true})).toContainText("completed");
  expect(fixture.read(`${fixture.target}/notes.txt`)).toBe("keep task data");expect(fixture.read(`${fixture.project}/tracked.txt`)).toBe("dirty source");
  await check.click();await expect(qterm.page.getByRole("dialog",{name:"Problems and command runs",exact:true}).getByLabel("Run details",{exact:true})).toContainText(`Environment: ${fixture.environment}`);
});
