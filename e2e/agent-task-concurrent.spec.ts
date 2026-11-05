// R93: real concurrent pipe requests, Git Bash panes and per-request results.
import fs from "node:fs";import path from "node:path";import {execFileSync} from "node:child_process";
import {expect,test} from "./qterm";
import {agentCli,agentCliAsync,agentTaskProject,agentTaskSettings,alive,grantTasks} from "./agent-task-fixture";
import {quote} from "./verification-project";
const git=execFileSync("where.exe",["git.exe"],{encoding:"utf8"}).trim().split(/\r?\n/)[0],bash=path.resolve(path.dirname(git),"../bin/bash.exe");
const shell={id:"custom:Concurrent Bash",name:"Concurrent Bash"},settings=agentTaskSettings();
settings.extra+=["","[[profiles]]",`id=${JSON.stringify(shell.id)}`,`name=${JSON.stringify(shell.name)}`,`command=${JSON.stringify(`"${bash}" --noprofile --norc -i`)}`,`env={PATH=${JSON.stringify(process.env.PATH??process.env.Path??"")}}`].join("\n");
test.use({settings});
test("four concurrent task requests retain separate Bash panes and execute once per request",async({qterm})=>{
  const project=agentTaskProject();
  try{
    const source=await qterm.activePane();await qterm.waitForPrompt(source);await qterm.run(source,`Set-Location ${quote(project.dir)}`);await expect.poll(async()=>(await qterm.workspace()).panes[source]?.cwd).toBe(project.dir);
    const {panel,file}=await grantTasks(qterm.page,project.dir,["check"],"Concurrent client",shell);const task=agentCli(file,"tasks.list").body.result.tasks[0];await panel.getByRole("button",{name:"Close agent access",exact:true}).click();
    await qterm.run(source,"node source.cjs");await expect.poll(()=>qterm.terminalText(source)).toContain("source-program-27");const sourcePid=Number(fs.readFileSync(path.join(project.dir,"target/source.pid"),"utf8"));
    const all:Array<{id:string;paneId:string}>=[];
    for(let round=0;round<6;round++){
      const jobs=await Promise.all(Array.from({length:4},(_,index)=>agentCliAsync(file,"tasks.run",{taskId:task.id,requestId:`concurrent-${round}-${index}`})));
      for(const job of jobs)expect(job.body.error).toBeUndefined();
      await expect.poll(()=>jobs.map(job=>{const reply=agentCli(file,"tasks.status",{runId:job.body.result.id}).body;return {state:reply.result?.state,error:reply.result?.error??reply.error?.message??null};})).toEqual(jobs.map(()=>({state:"finished",error:null})));
      for(const job of jobs){const result=agentCli(file,"commands.result",{commandId:job.body.result.id}).body.result;expect(result.output).toContain("agent-check-42");expect(result.command.requester.client).toBe("Concurrent client");expect(result.command.profileId).toBe(shell.id);all.push({id:job.body.result.id,paneId:result.command.paneId});}
      expect(alive(sourcePid)).toBe(true);
    }
    expect(new Set(all.map(job=>job.paneId)).size).toBe(24);expect(fs.readFileSync(path.join(project.dir,"target/count.txt"),"utf8")).toBe("run\n".repeat(24));
    expect(agentCli(file,"tasks.run",{taskId:task.id,requestId:"concurrent-0-0"}).body.result.id).toBe(all[0].id);expect(fs.readFileSync(path.join(project.dir,"target/count.txt"),"utf8")).toBe("run\n".repeat(24));
  }finally{await qterm.stop();project.cleanup();}
});
