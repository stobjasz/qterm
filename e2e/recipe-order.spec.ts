// R62: real shell commands and files prove order, attribution and no replay.
import fs from "node:fs";
import path from "node:path";
import {expect,test} from "./qterm";
import {launchRecipe,recipeProject,recipeSettings,reviewRecipe} from "./recipe-fixture";
test.use({settings:recipeSettings()});
test("reviewed recipe steps run in order and retain results without replay after restart",async({qterm},info)=>{
  const project=recipeProject([{name:"build",command:"node build.cjs"},{name:"check",command:"node check.cjs",depends_on:["build"]}]);
  fs.writeFileSync(path.join(project.dir,"build.cjs"),"const fs=require('fs');fs.writeFileSync('target/build-started','started');const timer=setInterval(()=>{if(fs.existsSync('target/release')){clearInterval(timer);fs.appendFileSync('target/order.txt','build\\n');console.log('recipe-build-'+(6*7));}},50);\n");
  fs.writeFileSync(path.join(project.dir,"check.cjs"),"const fs=require('fs');if(fs.readFileSync('target/order.txt','utf8')!=='build\\n')process.exit(7);fs.appendFileSync('target/order.txt','check\\n');console.log('recipe-check-'+(3*9));\n");
  try{
    const source=await qterm.activePane();await qterm.waitForPrompt(source);const panel=await reviewRecipe(qterm.page,project.dir);expect(fs.existsSync(path.join(project.dir,"target/order.txt"))).toBe(false);
    const run=await launchRecipe(panel);await expect.poll(()=>fs.existsSync(path.join(project.dir,"target/build-started"))).toBe(true);await expect(run.getByLabel("Workflow step check",{exact:true}).getByLabel("Recipe step state",{exact:true})).toHaveText("pending");expect(fs.existsSync(path.join(project.dir,"target/order.txt"))).toBe(false);fs.writeFileSync(path.join(project.dir,"target/release"),"finish");await expect(run.getByLabel("Workflow step build",{exact:true}).getByLabel("Recipe step state",{exact:true})).toHaveText("succeeded");await expect(run.getByLabel("Workflow step check",{exact:true}).getByLabel("Recipe step state",{exact:true})).toHaveText("succeeded");
    expect(fs.readFileSync(path.join(project.dir,"target/order.txt"),"utf8")).toBe("build\ncheck\n");const workspace=await qterm.workspace();expect(workspace.tabs).toHaveLength(2);expect(Object.keys(workspace.panes)).toHaveLength(3);
    await run.getByRole("button",{name:"Inspect check result",exact:true}).click();const problems=qterm.page.getByRole("dialog",{name:"Problems and command runs",exact:true});await expect(problems.getByLabel("Run details",{exact:true})).toContainText("Requested by Workflow pipeline");await expect(problems).toContainText("recipe-check-27");await qterm.page.screenshot({path:info.outputPath("recipe-result.png")});await problems.getByRole("button",{name:"Close problems",exact:true}).click();
    await qterm.restart();for(const id of Object.keys((await qterm.workspace()).panes))await qterm.waitForPrompt(id);expect(fs.readFileSync(path.join(project.dir,"target/order.txt"),"utf8")).toBe("build\ncheck\n");
    await qterm.page.getByRole("button",{name:"Workflow recipes",exact:true}).click();await expect(qterm.page.getByRole("dialog",{name:"Workflow recipes",exact:true}).getByLabel("Workflow run pipeline",{exact:true})).toHaveCount(0);
  }finally{await qterm.stop();project.cleanup();}
});
