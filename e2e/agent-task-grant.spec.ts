// R59: manifest/profile drift and revocation at the prompt gate.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { IDENTIFIER, expect, test } from "./qterm";
import { agentCli, agentTaskProject, agentTaskSettings, grantTasks } from "./agent-task-fixture";
import { quote } from "./verification-project";
const barrier=path.join(fs.realpathSync.native(os.tmpdir()),`qterm-agent-task-barrier-${process.pid}.txt`);
const startup=`if (Test-Path -LiteralPath ${quote(barrier)}) { Write-Output ('task-startup-wait-' + (3*7)); $null=[Console]::ReadLine(); Write-Output ('task-startup-done-' + (3*9)) }`;
test.use({settings:agentTaskSettings(startup)});
test("changed definitions reject task requests and revocation cancels a task waiting for a prompt",async({qterm})=>{
  const project=agentTaskProject(),manifest=path.join(project.dir,"package.json"),config=path.join(process.env.APPDATA!,IDENTIFIER,"config.toml");const original=fs.readFileSync(manifest,"utf8");
  try {
    const source=await qterm.activePane();await qterm.waitForPrompt(source);await qterm.run(source,`Set-Location ${quote(project.dir)}`);await expect.poll(async()=>(await qterm.workspace()).panes[source]?.cwd).toBe(project.dir);
    const {panel,file}=await grantTasks(qterm.page,project.dir,["check"]);const task=agentCli(file,"tasks.list").body.result.tasks[0];
    fs.writeFileSync(manifest,original.replace("node check.cjs","node fail.cjs"));expect(agentCli(file,"tasks.run",{taskId:task.id,requestId:"changed-manifest"}).body.error?.code).toBe("definition_changed");expect((await qterm.workspace()).tabs).toHaveLength(1);fs.writeFileSync(manifest,original);
    const settings=qterm.settingsOnDisk();fs.writeFileSync(config,settings.replace('name = "Agent task shell"','name = "Updated agent shell"').replace('QTERM_TASK_BINDING = "original"','QTERM_TASK_BINDING = "changed"'));
    await expect(panel.getByRole("combobox",{name:"Task execution shell",exact:true})).toContainText("Updated agent shell");
    expect(agentCli(file,"tasks.run",{taskId:task.id,requestId:"changed-profile"}).body.error?.code).toBe("definition_changed");fs.writeFileSync(config,settings);await expect(panel.getByRole("combobox",{name:"Task execution shell",exact:true})).toContainText("Agent task shell");
    fs.writeFileSync(barrier,"wait");const queued=agentCli(file,"tasks.run",{taskId:task.id,requestId:"waiting"}).body.result;await expect.poll(()=>agentCli(file,"tasks.status",{runId:queued.id}).body.result?.state).toBe("launching");
    const waiting=await qterm.activePane();expect(waiting).not.toBe(source);await expect.poll(()=>qterm.terminalText(waiting)).toContain("task-startup-wait-21");expect(fs.existsSync(path.join(project.dir,"target/count.txt"))).toBe(false);
    await panel.getByRole("button",{name:"Revoke access for Task client",exact:true}).click();await expect(panel.getByLabel("Task run waiting",{exact:true})).toContainText("cancelled");await panel.getByRole("button",{name:"Close agent access",exact:true}).click();
    await qterm.pane(waiting).getByRole("textbox",{name:"Terminal input",exact:true}).focus();await qterm.page.keyboard.press("Enter");await expect.poll(()=>qterm.terminalText(waiting)).toContain("task-startup-done-27");await qterm.waitForPrompt(waiting);expect(fs.existsSync(path.join(project.dir,"target/count.txt"))).toBe(false);
  } finally {await qterm.stop();fs.rmSync(barrier,{force:true});project.cleanup();}
});
