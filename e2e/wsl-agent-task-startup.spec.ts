// R123: a real failed Linux shell must release its pending task authority.
import {expect,test} from './qterm';
import {wslAgentTaskFixture} from './wsl-agent-task-fixture';
const fixture=wslAgentTaskFixture();
test.skip(!fixture.distro,'Requires an installed WSL distribution');test.use({settings:fixture.settings});
test.beforeAll(()=>{fixture.seed();if(fixture.distro)fixture.gateStartup();});test.afterAll(fixture.cleanup);
test('a Linux task shell exiting before its prompt cancels the task without replaying its request',async({qterm})=>{
  const source=await fixture.ready(qterm),{panel,file}=await fixture.grant(qterm,['qterm-fixture-check']);
  const task=fixture.cli(file,'tasks.list').body.result.tasks[0];fixture.flag('hold');
  const request=fixture.cli(file,'tasks.run',{taskId:task.id,requestId:'startup-exit'});expect(request.status).toBe(0);
  await expect.poll(()=>fixture.cli(file,'tasks.status',{runId:request.body.result.id}).body.result?.paneId).toEqual(expect.any(String));
  const waiting=fixture.cli(file,'tasks.status',{runId:request.body.result.id}).body.result.paneId;expect(waiting).not.toBe(source);await expect.poll(()=>qterm.terminalText(waiting)).toContain('WSL_PROFILE_WAITING_42');
  fixture.flag('exit-startup');await panel.getByRole('button',{name:'Close agent access',exact:true}).click();
  fixture.releaseStartup();
  await expect.poll(()=>qterm.terminalText(waiting)).toContain('process exited with code 23');
  await expect.poll(()=>fixture.cli(file,'tasks.status',{runId:request.body.result.id}).body.result?.state).toBe('cancelled');
  expect((await qterm.workspace()).panes[waiting]).toBeTruthy();expect(fixture.executions()).toBe(0);
  expect(fixture.cli(file,'tasks.run',{taskId:task.id,requestId:'startup-exit'}).body.result.id).toBe(request.body.result.id);
  await expect(qterm.page.getByRole('tab')).toHaveCount(2);expect(fixture.executions()).toBe(0);
});
