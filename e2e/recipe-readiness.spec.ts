// R63: readiness comes from actual current service output; controls own processes.
import fs from "node:fs";
import path from "node:path";
import {expect,test} from "./qterm";
import {alive} from "./agent-task-fixture";
import {launchRecipe,recipeProject,recipeSettings,reviewRecipe} from "./recipe-fixture";
test.use({settings:recipeSettings()});
const service="const fs=require('fs');fs.writeFileSync('target/service.pid',String(process.pid));console.log('service-started-'+(3*9));let ready=false;setInterval(()=>{if(!ready&&fs.existsSync('target/release')){ready=true;console.log('service-ready-'+(6*7));}},50);\n";
test("a real Cmd completion without an exit status cannot unlock a recipe dependency",async({qterm})=>{
  const project=recipeProject([{name:"build",command:"node build.cjs"},{name:"client",command:"node forbidden.cjs",depends_on:["build"]}]);
  fs.writeFileSync(path.join(project.dir,"build.cjs"),"console.log('cmd-build-'+(6*7));\n");fs.writeFileSync(path.join(project.dir,"forbidden.cjs"),"require('fs').writeFileSync('target/forbidden','ran');\n");
  try{await qterm.waitForPrompt(await qterm.activePane());const panel=await reviewRecipe(qterm.page,project.dir,"cmd"),run=await launchRecipe(panel);const build=run.getByLabel("Workflow step build",{exact:true});await expect(build.getByLabel("Recipe step state",{exact:true})).toHaveText("failed");await expect(build).toContainText("No exit status was reported");await expect(run.getByLabel("Workflow step client",{exact:true}).getByLabel("Recipe step state",{exact:true})).toHaveText("blocked");expect(fs.existsSync(path.join(project.dir,"target/forbidden"))).toBe(false);}finally{await qterm.stop();project.cleanup();}
});
test("only live readiness unlocks dependents while a failed independent branch stays blocked",async({qterm})=>{
  const project=recipeProject([{name:"service",command:"node service.cjs",ready_output:"service-ready-42",timeout_seconds:30},{name:"client",command:"node client.cjs",depends_on:["service"]},{name:"fail",command:"node fail.cjs"},{name:"blocked",command:"node forbidden.cjs",depends_on:["fail"]}]);
  fs.writeFileSync(path.join(project.dir,"service.cjs"),service);fs.writeFileSync(path.join(project.dir,"client.cjs"),"require('fs').writeFileSync('target/client.txt','client-'+(6*7));console.log('client-'+(6*7));\n");fs.writeFileSync(path.join(project.dir,"fail.cjs"),"console.log('independent-failed-'+(3*9));process.exit(7);\n");fs.writeFileSync(path.join(project.dir,"forbidden.cjs"),"require('fs').writeFileSync('target/forbidden.txt','ran');\n");
  try{
    await qterm.waitForPrompt(await qterm.activePane());const panel=await reviewRecipe(qterm.page,project.dir),run=await launchRecipe(panel);
    await expect(run.getByLabel("Workflow step service",{exact:true}).getByLabel("Recipe step state",{exact:true})).toHaveText("running");await expect.poll(()=>fs.existsSync(path.join(project.dir,"target/service.pid"))).toBe(true);
    await expect(run.getByLabel("Workflow step blocked",{exact:true}).getByLabel("Recipe step state",{exact:true})).toHaveText("blocked");expect(fs.existsSync(path.join(project.dir,"target/client.txt"))).toBe(false);
    fs.writeFileSync(path.join(project.dir,"target/release"),"ready");await expect(run.getByLabel("Workflow step service",{exact:true}).getByLabel("Recipe step state",{exact:true})).toHaveText("ready");await expect(run.getByLabel("Workflow step client",{exact:true}).getByLabel("Recipe step state",{exact:true})).toHaveText("succeeded");expect(fs.readFileSync(path.join(project.dir,"target/client.txt"),"utf8")).toBe("client-42");expect(fs.existsSync(path.join(project.dir,"target/forbidden.txt"))).toBe(false);
    const pid=Number(fs.readFileSync(path.join(project.dir,"target/service.pid"),"utf8"));expect(alive(pid)).toBe(true);await run.getByRole("button",{name:"Stop workflow",exact:true}).click();await expect.poll(()=>alive(pid)).toBe(false);await expect(run.getByLabel("Workflow step service",{exact:true}).getByLabel("Recipe step state",{exact:true})).toHaveText("cancelled");
    await expect(run.getByLabel("Workflow step client",{exact:true}).getByLabel("Recipe step state",{exact:true})).toHaveText("succeeded");
  }finally{await qterm.stop();project.cleanup();}
});
for(const mode of ["timeout","cancel"]){
  test(`${mode} blocks pending steps while the service remains available for explicit stop`,async({qterm})=>{
    const project=recipeProject([{name:"service",command:"node service.cjs",ready_output:"service-ready-42",timeout_seconds:mode==="timeout"?1:30},{name:"client",command:"node client.cjs",depends_on:["service"]}]);
    fs.writeFileSync(path.join(project.dir,"service.cjs"),service);fs.writeFileSync(path.join(project.dir,"client.cjs"),"require('fs').writeFileSync('target/client.txt','unexpected');\n");
    try{
      await qterm.waitForPrompt(await qterm.activePane());const panel=await reviewRecipe(qterm.page,project.dir),run=await launchRecipe(panel);await expect.poll(()=>fs.existsSync(path.join(project.dir,"target/service.pid"))).toBe(true);const pid=Number(fs.readFileSync(path.join(project.dir,"target/service.pid"),"utf8"));
      if(mode==="cancel"){await run.getByRole("button",{name:"Cancel pending steps",exact:true}).click();await expect(run.getByLabel("Workflow step client",{exact:true}).getByLabel("Recipe step state",{exact:true})).toHaveText("cancelled");fs.writeFileSync(path.join(project.dir,"target/release"),"ready");await expect(run.getByLabel("Workflow step service",{exact:true}).getByLabel("Recipe step state",{exact:true})).toHaveText("ready");}
      else{await expect(run.getByLabel("Workflow step service",{exact:true}).getByLabel("Recipe step state",{exact:true})).toHaveText("timed_out");await expect(run.getByLabel("Workflow step client",{exact:true}).getByLabel("Recipe step state",{exact:true})).toHaveText("blocked");}
      expect(fs.existsSync(path.join(project.dir,"target/client.txt"))).toBe(false);expect(alive(pid)).toBe(true);await run.getByRole("button",{name:"Stop workflow",exact:true}).click();await expect.poll(()=>alive(pid)).toBe(false);
    }finally{await qterm.stop();project.cleanup();}
  });
}
