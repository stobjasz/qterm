import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type {Page} from "@playwright/test";
import {expect,type Settings} from "./qterm";
export const LIBRARY_ID="01a1690c-c7b7-7e80-9864-e6971b91db16";
const fake="function global:claude { $ref = $args -join ' '; if ($ref -match '\\bresume\\b') { Write-Output ('LIBRARY_RESUMED_' + (6*7) + '_' + (Get-Location).Path); return }; $brief = [regex]::Match($ref, 'Read the task brief at (.+?) and follow its Request section').Groups[1].Value; Write-Output ('SESSION_BRIEF_FROM_' + (Get-Location).Path); Get-Content -LiteralPath $brief -Raw }; function global:codex { claude @args }";
export function libraryFixture(){
  const parent=fs.realpathSync.native(os.tmpdir()),root=path.join(parent,`qterm-library-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2,7)}`),claude=path.join(root,"claude"),codex=path.join(root,"codex"),project1=path.join(root,"project one"),project2=path.join(root,"project two");
  const claudeFile=path.join(claude,"projects","fixture",`${LIBRARY_ID}.jsonl`),codexFile=path.join(codex,"sessions","2026","10","29",`rollout-fixture-${LIBRARY_ID}.jsonl`);
  const remembered=(profileId:string,cwd:string,title:string)=>({id:LIBRARY_ID,profileId,cwd,title,seenAt:Date.now()});
  const settings:Settings={env:{CLAUDE_CONFIG_DIR:claude,CODEX_HOME:codex},values:{default_profile:'"custom:E2E library"',claude_sessions:"true",codex_sessions:"true"},extra:['[[profiles]]','id = "custom:E2E library"','name = "E2E library"',`command = ${JSON.stringify(`powershell.exe -NoLogo -NoProfile -NoExit -Command "${fake}"`)}`].join("\n"),files:{"claude-sessions.json":JSON.stringify([remembered("custom:E2E library",project1,"Remembered Claude")]),"codex-sessions.json":JSON.stringify([remembered("custom:E2E library",project2,"Remembered Codex"),remembered("wsl:Alpha","/work","WSL alpha reference"),remembered("wsl:Beta","/work","WSL beta reference")])}};
  function seed(){for(const folder of [path.dirname(claudeFile),path.dirname(codexFile),project1,project2])fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(claudeFile,[{type:"user",cwd:project1,gitBranch:"feature/claude-history",message:{content:"PRIVATE_CLAUDE_EXCERPT"}},{aiTitle:"Claude library alpha"}].map(x=>JSON.stringify(x)).join("\n"));fs.writeFileSync(codexFile,[{type:"session_meta",payload:{id:LIBRARY_ID,cwd:project2,git:{branch:"feature/codex-history"}}},{type:"response_item",payload:{type:"message",role:"user",content:[{type:"input_text",text:"Codex library beta"}]}}].map(x=>JSON.stringify(x)).join("\n"));}
  function cleanup(){if(!fs.existsSync(root))return;const target=fs.realpathSync.native(root);if(path.dirname(target).toLowerCase()!==parent.toLowerCase()||!path.basename(target).startsWith("qterm-library-"))throw new Error("Refusing unexpected library fixture cleanup");fs.rmSync(target,{recursive:true,force:true});}
  return{root,claude,codex,project1,project2,claudeFile,codexFile,settings,seed,cleanup};
}
export async function openLibrary(page:Page){await page.getByRole("button",{name:"Session library",exact:true}).click();const panel=page.getByRole("dialog",{name:"Session library",exact:true});await expect(panel.getByRole("list",{name:"Library sessions",exact:true})).toBeVisible();return panel;}
export async function discover(panel:ReturnType<Page["getByRole"]>){await panel.getByRole("button",{name:"Discover / refresh enabled sources",exact:true}).click();await expect(panel.getByRole("checkbox",{name:"Include discovered sessions",exact:true})).toBeChecked();}
export const sessionRow=(panel:ReturnType<Page["getByRole"]>,provider:string,environment="native")=>panel.getByRole("listitem",{name:`${provider} session ${LIBRARY_ID} in ${environment}`,exact:true});
