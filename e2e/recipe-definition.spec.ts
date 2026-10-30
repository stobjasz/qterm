// R64: reviewed bytes stay bound while an earlier real command is running.
import fs from "node:fs";
import path from "node:path";
import {expect,test} from "./qterm";
import {launchRecipe,recipeProject,recipeSettings,reviewRecipe} from "./recipe-fixture";
test.use({settings:recipeSettings()});
test("a changed recipe source prevents its delayed dependent command from launching",async({qterm})=>{
  const project=recipeProject([{name:"build",command:"node barrier.cjs"},{name:"check",command:"node check.cjs",depends_on:["build"]}]);
  fs.writeFileSync(path.join(project.dir,"barrier.cjs"),"const fs=require('fs');fs.writeFileSync('target/waiting','started');const timer=setInterval(()=>{if(fs.existsSync('target/release')){clearInterval(timer);console.log('build-finished-'+(6*7));}},50);\n");
  fs.writeFileSync(path.join(project.dir,"check.cjs"),"require('fs').writeFileSync('target/forbidden','ran');\n");
  try{
    await qterm.waitForPrompt(await qterm.activePane());const panel=await reviewRecipe(qterm.page,project.dir),run=await launchRecipe(panel);await expect.poll(()=>fs.existsSync(path.join(project.dir,"target/waiting"))).toBe(true);
    fs.writeFileSync(project.manifest,project.source.replace("node check.cjs","node substituted.cjs"));fs.writeFileSync(path.join(project.dir,"target/release"),"finish");
    const check=run.getByLabel("Workflow step check",{exact:true});await expect(check.getByLabel("Recipe step state",{exact:true})).toHaveText("failed");await expect(check).toContainText("Workflow source changed");expect(fs.existsSync(path.join(project.dir,"target/forbidden"))).toBe(false);
    await check.getByRole("button",{name:"Go to check",exact:true}).click();const pane=await qterm.activePane();await qterm.waitForPrompt(pane);await qterm.run(pane,"Write-Output ('released-shell-' + (6*7))");await expect.poll(()=>qterm.terminalText(pane)).toContain("released-shell-42");
  }finally{await qterm.stop();project.cleanup();}
});
