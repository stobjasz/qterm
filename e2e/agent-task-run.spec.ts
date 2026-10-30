// R58: real named task -> native authorization -> new ConPTY -> stable result.
import fs from "node:fs";
import path from "node:path";
import { expect, test } from "./qterm";
import { agentCli, agentCliAsync, agentTaskProject, agentTaskSettings, grantTasks } from "./agent-task-fixture";
import { quote } from "./verification-project";
test.use({settings:agentTaskSettings()});
test("granted named tasks run once in separate tabs and retain requester results across restart",async({qterm},info)=>{
  const project=agentTaskProject();
  try {
    const source=await qterm.activePane();await qterm.waitForPrompt(source);await qterm.run(source,`Set-Location ${quote(project.dir)}`);await expect.poll(async()=>(await qterm.workspace()).panes[source]?.cwd).toBe(project.dir);
    const {panel,file}=await grantTasks(qterm.page,project.dir,["check","fail"]);
    const listed=agentCli(file,"tasks.list");expect(listed.status).toBe(0);expect(listed.body.result.executionAllowed).toBe(true);expect(listed.body.result.tasks.map((t:{name:string})=>t.name).sort()).toEqual(["check","fail"]);
    const check=listed.body.result.tasks.find((t:{name:string})=>t.name==="check"),fail=listed.body.result.tasks.find((t:{name:string})=>t.name==="fail");
    expect(agentCli(file,"tasks.run",{taskId:"ungranted",requestId:"forbidden"}).body.error?.code).toBe("access_denied");
    expect(agentCli(file,"tasks.run",{taskId:check.id,requestId:"override",command:"node arbitrary.cjs"}).body.error?.code).toBe("invalid_params");
    await panel.getByRole("button",{name:"Close agent access",exact:true}).click();
    await qterm.run(source,"Write-Output ('source-wait-' + (3*7)); $null=[Console]::ReadLine(); Write-Output ('source-released-' + (3*9))");await expect.poll(()=>qterm.terminalText(source)).toContain("source-wait-21");
    const requests=await Promise.all([agentCliAsync(file,"tasks.run",{taskId:check.id,requestId:"check-once"}),agentCliAsync(file,"tasks.run",{taskId:check.id,requestId:"check-once"})]);
    expect(requests[0].status).toBe(0);expect(requests[1].body.result.id).toBe(requests[0].body.result.id);const id=requests[0].body.result.id;
    await expect.poll(()=>agentCli(file,"tasks.status",{runId:id}).body.result?.state).toBe("finished");
    const status=agentCli(file,"tasks.status",{runId:id}).body.result;expect(status.exitCode).toBe(0);expect(status.paneId).not.toBe(source);
    await expect(qterm.page.getByRole("tab")).toHaveCount(2);expect(fs.readFileSync(path.join(project.dir,"target/count.txt"),"utf8")).toBe("run\n");expect(await qterm.terminalText(source)).not.toContain("source-released-27");
    const result=agentCli(file,"commands.result",{commandId:id}).body.result;expect(result.output).toContain("agent-check-42");expect(result.command.requester.client).toBe("Task client");expect(result.command.requester.requestId).toBe("check-once");expect(result.lastRepositoryComparison.before.root).toBe(project.dir);
    const retried=agentCli(file,"tasks.run",{taskId:check.id,requestId:"check-once"});expect(retried.body.result.id).toBe(id);expect(fs.readFileSync(path.join(project.dir,"target/count.txt"),"utf8")).toBe("run\n");
    const failed=agentCli(file,"tasks.run",{taskId:fail.id,requestId:"failure"}).body.result;await expect.poll(()=>agentCli(file,"tasks.status",{runId:failed.id}).body.result?.state).toBe("finished");expect(agentCli(file,"commands.result",{commandId:failed.id}).body.result.command.exitCode).toBe(1);
    await qterm.page.getByRole("button",{name:"Agent access",exact:true}).click();const access=qterm.page.getByRole("dialog",{name:"Agent access",exact:true});const row=access.getByLabel("Task run check-once",{exact:true});await expect(row).toContainText("finished");await qterm.page.screenshot({path:info.outputPath("agent-task-result.png")});await row.getByRole("button",{name:"Inspect task result",exact:true}).click();
    const problems=qterm.page.getByRole("dialog",{name:"Problems and command runs",exact:true});await expect(problems.getByLabel("Run details",{exact:true})).toContainText("Requested by Task client");await problems.getByRole("button",{name:"Close problems",exact:true}).click();
    await qterm.restart();await qterm.page.getByRole("button",{name:"Problems and command runs",exact:true}).click();const restored=qterm.page.getByRole("dialog",{name:"Problems and command runs",exact:true});await restored.getByRole("button",{name:"Inspect run: npm run check",exact:true}).click();await expect(restored.getByLabel("Run details",{exact:true})).toContainText("Request: check-once");
  } finally {await qterm.stop();project.cleanup();}
});
