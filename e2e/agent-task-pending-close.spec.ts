// R94: a real mounted PowerShell startup program holds the prompt barrier.
import fs from "node:fs";import path from "node:path";
import {expect,test} from "./qterm";
import {agentCli,agentTaskProject,agentTaskSettings,grantTasks} from "./agent-task-fixture";
test.use({settings:agentTaskSettings("Write-Output ('TASK_STARTUP_WAIT_'+(6*7)); Read-Host 'release'")});
test("closing a mounted task waiting for its prompt cancels it and preserves the source",async({qterm})=>{
  const project=agentTaskProject();
  try{
    const source=await qterm.activePane();const {panel,file}=await grantTasks(qterm.page,project.dir,["check"]);const task=agentCli(file,"tasks.list").body.result.tasks[0];await panel.getByRole("button",{name:"Close agent access",exact:true}).click();
    const job=agentCli(file,"tasks.run",{taskId:task.id,requestId:"pending-close"}).body.result;
    await expect.poll(()=>qterm.activePane()).not.toBe(source);const pane=await qterm.activePane();await expect.poll(()=>qterm.terminalText(pane)).toContain("TASK_STARTUP_WAIT_42");
    expect(agentCli(file,"tasks.status",{runId:job.id}).body.result.startedAt).toBeNull();
    await qterm.pane(pane).getByRole("textbox",{name:"Terminal input",exact:true}).focus();await qterm.page.keyboard.press("Control+Shift+W");await expect.poll(async()=>Boolean((await qterm.workspace()).panes[pane])).toBe(false);
    await expect.poll(()=>{const current=agentCli(file,"tasks.status",{runId:job.id}).body.result;return {state:current.state,error:current.error};}).toEqual({state:"cancelled",error:"The task pane closed or changed shell"});
    expect((await qterm.workspace()).panes[source]).toBeTruthy();expect(fs.existsSync(path.join(project.dir,"target/count.txt"))).toBe(false);
  }finally{await qterm.stop();project.cleanup();}
});
