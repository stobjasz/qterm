// R118: actual Linux cwd case, escaping alias, retained output and read-only grant.
import {expect,test} from './qterm';
import {wslAgentTaskFixture} from './wsl-agent-task-fixture';
const fixture=wslAgentTaskFixture();
test.skip(!fixture.distro,'Requires an installed WSL distribution');test.use({settings:fixture.settings});
test.beforeAll(()=>{fixture.seed();if(fixture.distro)fixture.python(`import os,subprocess
os.symlink(${JSON.stringify(`${fixture.root}/case`)},${JSON.stringify(`${fixture.project}/escape`)})
subprocess.run(['/usr/bin/git','-C',${JSON.stringify(`${fixture.root}/case`)},'-c','core.hooksPath=/dev/null','-c','init.templateDir=','init','--quiet'],check=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE)`);});test.afterAll(fixture.cleanup);
test('a Linux read grant excludes differently cased projects and escaping aliases and cannot run tasks',async({qterm})=>{
  const source=await fixture.ready(qterm);await qterm.run(source,`printf 'SCOPED_OUTPUT_%s\\n' "$((6*7))"`);
  await expect.poll(()=>qterm.terminalText(source)).toContain('SCOPED_OUTPUT_42');
  const outside:string[]=[];
  for(const folder of [`${fixture.root}/case`,`${fixture.project}/escape`]){
    await qterm.page.getByRole('button',{name:'New tab',exact:true}).click();const pane=await fixture.ready(qterm);outside.push(pane);
    await qterm.run(pane,`cd '${folder}'`);
    await expect.poll(async()=>(await qterm.workspace()).panes[pane]?.cwd).toBe(folder);
    await qterm.run(pane,`printf 'OUTSIDE_OUTPUT_%s\\n' "$((3*9))"`);await expect.poll(()=>qterm.terminalText(pane)).toContain('OUTSIDE_OUTPUT_27');
  }
  const {panel,file}=await fixture.grant(qterm);
  await expect.poll(()=>fixture.cli(file,'panes.list').body.result?.panes.map((p:{id:string})=>p.id)).toEqual([source]);
  const commands=fixture.cli(file,'commands.list').body.result.commands;
  expect(commands.some((r:{command:string})=>r.command.includes('SCOPED_OUTPUT_'))).toBe(true);
  expect(commands.some((r:{command:string})=>r.command.includes('OUTSIDE_OUTPUT_'))).toBe(false);
  // Historical commands started in this project remain readable after a pane moves.
  // Its commands started outside must stay excluded from that pane's result page.
  for(const paneId of outside){
    const scoped=fixture.cli(file,'commands.list',{paneId});expect(scoped.status).toBe(0);
    expect(scoped.body.result.commands.every((r:{cwd:string;command:string})=>r.cwd===fixture.project&&!r.command.includes('OUTSIDE_OUTPUT_'))).toBe(true);
  }
  const tasks=fixture.cli(file,'tasks.list').body.result;expect(tasks.executionAllowed).toBe(false);
  const task=tasks.tasks.find((t:{name:string})=>t.name==='qterm-fixture-check');expect(task).toBeTruthy();
  expect(fixture.cli(file,'tasks.run',{taskId:task.id,requestId:'read-only'}).body.error?.code).toBe('access_denied');
  expect(fixture.executions()).toBe(0);
  await panel.getByRole('button',{name:'Close agent access',exact:true}).click();
  const separate=await fixture.grant(qterm,[],`${fixture.root}/case`,'Outside client');
  const foreign=fixture.cli(separate.file,'commands.list').body.result.commands.filter((r:{command:string})=>r.command.includes('OUTSIDE_OUTPUT_'));
  expect(foreign).toHaveLength(2);
  for(const run of foreign)expect(fixture.cli(file,'commands.result',{commandId:run.id}).body.error?.code).toBe('not_available');
});
