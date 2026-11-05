// R119: Linux manifest drift and real Bash startup read, followed by revocation.
import {expect,test} from './qterm';
import {wslAgentTaskFixture} from './wsl-agent-task-fixture';
const fixture=wslAgentTaskFixture();
test.skip(!fixture.distro,'Requires an installed WSL distribution');test.use({settings:fixture.settings});
test.beforeAll(fixture.seed);test.afterAll(fixture.cleanup);
test('changed Linux definitions reject requests and revocation prevents a task waiting for its prompt',async({qterm})=>{
  const source=await fixture.ready(qterm),{panel,file}=await fixture.grant(qterm,['qterm-fixture-check']);
  const task=fixture.cli(file,'tasks.list').body.result.tasks[0];
  fixture.python(`p=${JSON.stringify(`${fixture.project}/pyproject.toml`)};text=open(p).read();open(p+'.saved','w').write(text);open(p,'w').write(text.replace('agent_tasks:check','agent_tasks:changed'))`);
  expect(fixture.cli(file,'tasks.run',{taskId:task.id,requestId:'changed-definition'}).body.error?.code).toBe('definition_changed');
  expect((await qterm.workspace()).tabs).toHaveLength(1);
  fixture.python(`p=${JSON.stringify(`${fixture.project}/pyproject.toml`)};open(p,'w').write(open(p+'.saved').read())`);
  fixture.flag('hold');const request=fixture.cli(file,'tasks.run',{taskId:task.id,requestId:'waiting'});expect(request.status).toBe(0);
  await expect.poll(()=>fixture.cli(file,'tasks.status',{runId:request.body.result.id}).body.result?.state).toBe('launching');
  const waiting=await qterm.activePane();expect(waiting).not.toBe(source);await expect.poll(()=>qterm.terminalText(waiting)).toContain('WSL_PROFILE_WAITING_42');expect(fixture.executions()).toBe(0);
  await panel.getByRole('button',{name:'Revoke access for Linux client',exact:true}).click();
  await expect(panel.getByLabel('Task run waiting',{exact:true}).getByLabel('Task run state',{exact:true})).toHaveText('cancelled');
  await panel.getByRole('button',{name:'Close agent access',exact:true}).click();
  await qterm.pane(waiting).getByRole('textbox',{name:'Terminal input',exact:true}).press('Enter');
  await expect.poll(async()=>(await qterm.terminalText(waiting)).trimEnd().endsWith(`${fixture.project}$`)).toBe(true);
  await qterm.run(waiting,`printf 'REVOKED_SHELL_KEPT_%s\\n' "$((6*7))"`);await expect.poll(()=>qterm.terminalText(waiting)).toContain('REVOKED_SHELL_KEPT_42');
  expect(fixture.executions()).toBe(0);expect(await qterm.terminalText(waiting)).not.toContain('LINUX_GRANTED_TASK_42');
});
