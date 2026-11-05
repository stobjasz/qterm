// R120: actual Linux PID birth, source program survival and usable stopped shell.
import {expect,test} from './qterm';
import {wslAgentTaskFixture} from './wsl-agent-task-fixture';
const fixture=wslAgentTaskFixture();
test.skip(!fixture.distro,'Requires an installed WSL distribution');test.use({settings:fixture.settings});
test.beforeAll(fixture.seed);test.afterAll(fixture.cleanup);
test('Stop ends the granted Linux task while preserving its source program and task shell',async({qterm})=>{
  const source=await fixture.ready(qterm),{panel,file}=await fixture.grant(qterm,['qterm-fixture-watch']);
  const task=fixture.cli(file,'tasks.list').body.result.tasks[0];await panel.getByRole('button',{name:'Close agent access',exact:true}).click();
  await qterm.run(source,'qterm-fixture-source');await expect.poll(()=>qterm.terminalText(source)).toContain('LINUX_SOURCE_WAITING_42');expect(fixture.alive('source')).toBe(true);
  const request=fixture.cli(file,'tasks.run',{taskId:task.id,requestId:'stop-watch'});expect(request.status).toBe(0);
  await expect.poll(()=>fixture.alive('task')).toBe(true);const state=fixture.cli(file,'tasks.status',{runId:request.body.result.id}).body.result;
  expect(state.state).toBe('running');expect(state.paneId).not.toBe(source);
  await qterm.page.getByRole('button',{name:'Agent access',exact:true}).click();
  await panel.getByRole('button',{name:'Stop task stop-watch',exact:true}).click();
  await expect.poll(()=>fixture.alive('task')).toBe(false);expect(fixture.alive('source')).toBe(true);
  await expect.poll(()=>fixture.cli(file,'tasks.status',{runId:request.body.result.id}).body.result?.state).toBe('finished');
  await panel.getByRole('button',{name:'Close agent access',exact:true}).click();
  await qterm.run(state.paneId,`printf 'STOPPED_TASK_SHELL_%s\\n' "$((6*7))"`);await expect.poll(()=>qterm.terminalText(state.paneId)).toContain('STOPPED_TASK_SHELL_42');
  expect(fixture.alive('source')).toBe(true);
});
