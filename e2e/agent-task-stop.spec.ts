// R60: a revoked client cannot stop an accepted run; the developer can target it.
import fs from "node:fs";
import path from "node:path";
import { expect, test } from "./qterm";
import { agentCli, agentTaskProject, agentTaskSettings, alive, grantTasks } from "./agent-task-fixture";
import { quote } from "./verification-project";
test.use({settings:agentTaskSettings()});
test("revocation preserves a running task and explicit stop targets its programs only",async({qterm})=>{
  const project=agentTaskProject();
  try {
    const source=await qterm.activePane();await qterm.waitForPrompt(source);await qterm.run(source,`Set-Location ${quote(project.dir)}`);await expect.poll(async()=>(await qterm.workspace()).panes[source]?.cwd).toBe(project.dir);
    const {panel,file}=await grantTasks(qterm.page,project.dir,["watch"]);const task=agentCli(file,"tasks.list").body.result.tasks[0];await panel.getByRole("button",{name:"Close agent access",exact:true}).click();
    await qterm.run(source,"node source.cjs");await expect.poll(()=>qterm.terminalText(source)).toContain("source-program-27");const sourcePid=Number(fs.readFileSync(path.join(project.dir,"target/source.pid"),"utf8"));
    const job=agentCli(file,"tasks.run",{taskId:task.id,requestId:"watch"}).body.result;await expect.poll(()=>agentCli(file,"tasks.status",{runId:job.id}).body.result?.state).toBe("running");
    await expect.poll(()=>fs.existsSync(path.join(project.dir,"target/watch.pid"))).toBe(true);const watchPid=Number(fs.readFileSync(path.join(project.dir,"target/watch.pid"),"utf8"));expect(alive(watchPid)).toBe(true);
    await qterm.page.getByRole("button",{name:"Agent access",exact:true}).click();const access=qterm.page.getByRole("dialog",{name:"Agent access",exact:true});await access.getByRole("button",{name:"Revoke access for Task client",exact:true}).click();const row=access.getByLabel("Task run watch",{exact:true});await expect(row.getByLabel("Task run state",{exact:true})).toHaveText("running");expect(alive(watchPid)).toBe(true);
    await row.getByRole("button",{name:"Stop task watch",exact:true}).click();await expect.poll(()=>alive(watchPid)).toBe(false);expect(alive(sourcePid)).toBe(true);await expect(row.getByLabel("Task run state",{exact:true})).toContainText("finished");
  } finally {await qterm.stop();project.cleanup();}
});
