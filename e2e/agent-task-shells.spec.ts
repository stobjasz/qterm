// R61: real native shell variants, not a PowerShell proxy for another profile.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { expect,test } from "./qterm";
import { agentCli,agentTaskProject,agentTaskSettings,alive,grantTasks } from "./agent-task-fixture";
const git=execFileSync("where.exe",["git.exe"],{encoding:"utf8"}).trim().split(/\r?\n/)[0];
const bash=path.resolve(path.dirname(git),"../bin/bash.exe");
if(!fs.existsSync(bash)) throw new Error("Git Bash is required to validate its advertised task profile");
for(const shell of [{kind:"cmd",id:"custom:Agent cmd",name:"Agent cmd",command:"cmd.exe /d"},{kind:"bash",id:"custom:Agent bash",name:"Agent bash",command:`"${bash}" --noprofile --norc -i`}]) {
  test.describe(shell.kind,()=>{
    const settings=agentTaskSettings(); settings.extra += ["","[[profiles]]",`id = ${JSON.stringify(shell.id)}`,`name = ${JSON.stringify(shell.name)}`,`command = ${JSON.stringify(shell.command)}`,`env = { PATH = ${JSON.stringify(process.env.PATH ?? process.env.Path ?? "")} }`].join("\n");
    test.use({settings});
    test(`a granted check uses its actual ${shell.kind} shell and preserves original run metadata`,async({qterm})=>{
      const project=agentTaskProject();
      try {
        await qterm.waitForPrompt(await qterm.activePane());const {panel,file}=await grantTasks(qterm.page,project.dir,["check","watch"],"Native shell client",shell);
        const tasks=agentCli(file,"tasks.list").body.result.tasks;const task=tasks.find((t:{name:string})=>t.name==="check"),watch=tasks.find((t:{name:string})=>t.name==="watch");await panel.getByRole("button",{name:"Close agent access",exact:true}).click();
        const job=agentCli(file,"tasks.run",{taskId:task.id,requestId:`native-${shell.kind}`}).body.result;
        await expect.poll(()=>{ const response=agentCli(file,"tasks.status",{runId:job.id}).body; return {state:response.result?.state,error:response.result?.error ?? response.error?.message ?? null}; }).toEqual({state:"finished",error:null});
        const result=agentCli(file,"commands.result",{commandId:job.id}).body.result;expect(result.command.shellKind).toBe(shell.kind);expect(result.command.profileId).toBe(shell.id);expect(result.command.cwd).toBe(project.dir);expect(result.command.requester.client).toBe("Native shell client");expect(result.output,JSON.stringify({task,result,terminal:await qterm.terminalText(job.paneId)})).toContain("agent-check-42");expect(result.command.exitCode).toBe(shell.kind==="cmd"?null:0);
        expect(fs.readFileSync(path.join(project.dir,"target/count.txt"),"utf8")).toBe("run\n");
        const watching=agentCli(file,"tasks.run",{taskId:watch.id,requestId:`watch-${shell.kind}`}).body.result;
        await expect.poll(()=>fs.existsSync(path.join(project.dir,"target/watch.pid"))).toBe(true);const pid=Number(fs.readFileSync(path.join(project.dir,"target/watch.pid"),"utf8"));
        await qterm.page.getByRole("button",{name:"Agent access",exact:true}).click();const access=qterm.page.getByRole("dialog",{name:"Agent access",exact:true});await access.getByRole("button",{name:`Stop task watch-${shell.kind}`,exact:true}).click();await expect.poll(()=>alive(pid)).toBe(false);
        await expect.poll(()=>agentCli(file,"tasks.status",{runId:watching.id}).body.result?.state).toBe("finished");const stopped=agentCli(file,"tasks.status",{runId:watching.id}).body.result;
        await access.getByRole("button",{name:"Close agent access",exact:true}).click();
        await qterm.run(stopped.paneId,shell.kind==="cmd" ? "for /f %i in ('cmd /c set /a 6*7') do @echo shell-survived-%i" : "printf 'shell-survived-%s\\n' \"$((6*7))\"");
        await expect.poll(()=>qterm.terminalText(stopped.paneId)).toContain("shell-survived-42");
      } finally {await qterm.stop();project.cleanup();}
    });
  });
}
