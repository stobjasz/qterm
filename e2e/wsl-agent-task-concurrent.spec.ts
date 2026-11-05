// R122: parallel real Linux CLI processes and per-request pane/result identity.
import {expect,test} from './qterm';
import {wslAgentTaskFixture} from './wsl-agent-task-fixture';
const fixture=wslAgentTaskFixture();
test.skip(!fixture.distro,'Requires an installed WSL distribution');test.use({settings:fixture.settings});
test.beforeAll(fixture.seed);test.afterAll(fixture.cleanup);
test('concurrent Linux retries launch one task pane per request and preserve their source program',async({qterm})=>{
  const source=await fixture.ready(qterm),{panel,file}=await fixture.grant(qterm,['qterm-fixture-check']);
  const task=fixture.cli(file,'tasks.list').body.result.tasks[0];await panel.getByRole('button',{name:'Close agent access',exact:true}).click();
  await qterm.run(source,'qterm-fixture-source');await expect.poll(()=>qterm.terminalText(source)).toContain('LINUX_SOURCE_WAITING_42');
  const names=['parallel-a','parallel-a','parallel-b','parallel-b'];
  const responses=await Promise.all(names.map(requestId=>fixture.cliAsync(file,'tasks.run',{taskId:task.id,requestId})));
  for(const reply of responses)expect(reply.status).toBe(0);
  expect(responses[0].body.result.id).toBe(responses[1].body.result.id);expect(responses[2].body.result.id).toBe(responses[3].body.result.id);
  expect(responses[0].body.result.id).not.toBe(responses[2].body.result.id);
  const runs=[responses[0].body.result,responses[2].body.result];
  for(const job of runs){
    await expect.poll(()=>fixture.cli(file,'tasks.status',{runId:job.id}).body.result?.state,{timeout:45000}).toBe('finished');
    const result=fixture.cli(file,'commands.result',{commandId:job.id}).body.result;
    expect(result.output).toContain('LINUX_GRANTED_TASK_42');expect(result.command.environment).toBe(fixture.environment);expect(result.command.requester.requestId).toBe(job.requester.requestId);
  }
  await expect(qterm.page.getByRole('tab')).toHaveCount(3);expect(fixture.executions()).toBe(2);expect(fixture.alive('source')).toBe(true);
  const panes=runs.map(job=>fixture.cli(file,'tasks.status',{runId:job.id}).body.result.paneId);expect(new Set(panes).size).toBe(2);expect(panes).not.toContain(source);
});
