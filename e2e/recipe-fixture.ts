import fs from "node:fs";
import path from "node:path";
import type {Page} from "@playwright/test";
import {expect} from "./qterm";
import {verificationProject} from "./verification-project";
export {agentTaskSettings as recipeSettings} from "./agent-task-fixture";
export interface RecipeStep {name:string;command:string;depends_on?:string[];cwd?:string;ready_output?:string;timeout_seconds?:number}
export function recipeProject(steps:RecipeStep[],layout="rows"){
  const project=verificationProject();fs.mkdirSync(path.join(project.dir,"target"));
  const source=["[workflows]","version = 1","[[workflows.recipes]]",'name = "pipeline"',`layout = ${JSON.stringify(layout)}`,...steps.flatMap(step=>["[[workflows.recipes.steps]]",...Object.entries(step).map(([key,value])=>`${key} = ${JSON.stringify(value)}`)])].join("\n");
  const manifest=path.join(project.dir,".qterm.toml");fs.writeFileSync(manifest,source);return{...project,source,manifest};
}
export async function reviewRecipe(page:Page,folder:string,profileId="custom:E2E agent tasks"){
  await page.getByRole("button",{name:"Workflow recipes",exact:true}).click();const panel=page.getByRole("dialog",{name:"Workflow recipes",exact:true});
  await panel.getByLabel("Recipe project folder",{exact:true}).fill(folder);await panel.getByRole("combobox",{name:"Recipe shell",exact:true}).selectOption(profileId);
  await panel.getByRole("button",{name:"Review recipes",exact:true}).click();await expect(panel.getByRole("region",{name:"Workflow launch review",exact:true})).toContainText(folder);
  await expect(panel.getByRole("button",{name:"Launch reviewed workflow",exact:true})).toBeDisabled();return panel;
}
export async function launchRecipe(panel:ReturnType<Page["getByRole"]>){await panel.getByRole("checkbox",{name:"Run these reviewed commands once in new workflow panes",exact:true}).check();await panel.getByRole("button",{name:"Launch reviewed workflow",exact:true}).click();return panel.getByLabel("Workflow run pipeline",{exact:true});}
