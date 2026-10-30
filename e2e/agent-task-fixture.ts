import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { EXE, expect, type Settings } from "./qterm";
import type { Page } from "@playwright/test";
import { verificationProject } from "./verification-project";

const pwsh=execFileSync("where.exe",["pwsh.exe"],{encoding:"utf8"}).trim().split(/\r?\n/)[0];
export function agentTaskSettings(startup?:string):Settings {
  return { values:{default_profile:'"custom:E2E agent tasks"'},extra:["[[profiles]]",'id = "custom:E2E agent tasks"','name = "Agent task shell"',`command = ${JSON.stringify(`"${pwsh}" -NoLogo -NoProfile${startup ? ` -NoExit -Command "${startup}"` : ""}`)}`,`env = { PATH = ${JSON.stringify(process.env.PATH ?? process.env.Path ?? "")}, QTERM_TASK_BINDING = "original" }`].join("\n") };
}
export function agentTaskProject() {
  const project=verificationProject(); fs.mkdirSync(path.join(project.dir,"target"));
  fs.writeFileSync(path.join(project.dir,"package.json"),JSON.stringify({name:"qterm-agent-test",scripts:{check:"node check.cjs",fail:"node fail.cjs",watch:"node watch.cjs"}}));
  fs.writeFileSync(path.join(project.dir,"check.cjs"),"const fs=require('node:fs');fs.mkdirSync('target',{recursive:true});fs.appendFileSync('target/count.txt','run\\n');console.log('agent-check-'+(6*7));\n");
  fs.writeFileSync(path.join(project.dir,"fail.cjs"),"console.log('value.cjs(1,1): error TS9999: agent-check-'+(3*9));process.exit(1);\n");
  fs.writeFileSync(path.join(project.dir,"watch.cjs"),"const fs=require('node:fs');fs.mkdirSync('target',{recursive:true});fs.writeFileSync('target/watch.pid',String(process.pid));console.log('agent-watching-'+(6*7));setInterval(()=>fs.appendFileSync('target/ticks.txt','tick\\n'),50);\n");
  fs.writeFileSync(path.join(project.dir,"source.cjs"),"const fs=require('node:fs');fs.writeFileSync('target/source.pid',String(process.pid));console.log('source-program-'+(3*9));setInterval(()=>{},1000);\n");
  return project;
}
export function agentCli(file:string,method:string,params:unknown={}) {
  const child=spawnSync(EXE,["--agent-client",file,method,JSON.stringify(params)],{encoding:"utf8",timeout:10000,windowsHide:true});
  if(!child.stdout.trim()) throw new Error(`No agent JSON (exit ${child.status})`);
  return {status:child.status,body:JSON.parse(child.stdout.trim())};
}
export function agentCliAsync(file:string,method:string,params:unknown={}) {
  return new Promise<ReturnType<typeof agentCli>>((resolve,reject)=>{
    const child=spawn(EXE,["--agent-client",file,method,JSON.stringify(params)],{windowsHide:true});let output="";
    child.stdout.on("data",(bytes)=>output+=bytes); child.on("error",reject); child.on("close",(status)=>{try{resolve({status,body:JSON.parse(output.trim())});}catch(e){reject(e);}});
  });
}
export async function grantTasks(page:Page,directory:string,tasks:string[],client="Task client",shell?:{id:string;name:string}) {
  await page.getByRole("button",{name:"Agent access",exact:true}).click(); const panel=page.getByRole("dialog",{name:"Agent access",exact:true});
  await panel.getByLabel("Agent access project folder",{exact:true}).fill(directory); await panel.getByLabel("Agent access client label",{exact:true}).fill(client);
  await panel.getByRole("checkbox",{name:"Review named-task execution too",exact:true}).check();
  if(shell) await panel.getByRole("combobox",{name:"Task execution shell",exact:true}).selectOption(shell.id);
  await panel.getByRole("button",{name:"Review project access",exact:true}).click();
  await expect(panel.getByRole("region",{name:"Named-task execution review",exact:true})).toContainText(shell?.name ?? "Agent task shell");
  await panel.getByRole("checkbox",{name:"Allow read access to this project for this qterm session",exact:true}).check();
  for(const task of tasks) await panel.getByRole("checkbox",{name:`Allow task ${task} from package.json`,exact:true}).check();
  await expect(panel.getByRole("button",{name:"Create session task grant",exact:true})).toBeDisabled();
  await panel.getByRole("checkbox",{name:"Allow the selected named tasks to run in new tabs for this qterm session",exact:true}).check();
  await panel.getByRole("button",{name:"Create session task grant",exact:true}).click();
  const file=panel.getByLabel(`Connection file for ${client}`,{exact:true}); await expect(file).toBeVisible();
  return {panel,file:(await file.textContent())!};
}
export const alive=(pid:number)=>{try{process.kill(pid,0);return true;}catch{return false;}};
