// R103: delay actual Bash startup, edit the profile, then release the existing shell.
import fs from "node:fs";
import path from "node:path";
import {expect,IDENTIFIER,test} from "./qterm";
import {wslWorktreeFixture} from "./wsl-worktree-fixture";
const fixture=wslWorktreeFixture();
test.skip(!fixture.distro,"Requires an installed WSL distribution");
test.use({settings:fixture.settings});test.beforeAll(fixture.seed);test.afterAll(fixture.cleanup);
test("a delayed Linux task agent rejects an edited profile while preserving its original shell",async({qterm})=>{
  let original="";const file=path.join(process.env.APPDATA!,IDENTIFIER,"config.toml");
  try{
    const panel=await fixture.preview(qterm);await panel.getByRole("button",{name:"Create reviewed worktree",exact:true}).click();await expect(panel.getByRole("status",{name:"Worktree change summary",exact:true})).toBeVisible();
    fixture.flag("hold");await panel.getByRole("button",{name:"Open task agent",exact:true}).click();await expect(panel).toBeHidden();const pane=await qterm.activePane();await expect.poll(()=>qterm.terminalText(pane)).toContain("WSL_PROFILE_WAITING_42");
    original=qterm.settingsOnDisk();const updated=original.replace(/name\s*=\s*"WSL launch"/,'name = "Edited WSL launch"').replace(' --exec /bin/bash ',' --exec /bin/bash --norc ');expect(updated).toContain(' --exec /bin/bash --norc ');fs.writeFileSync(file,updated);
    await qterm.page.keyboard.press("Control+Shift+P");const palette=qterm.page.getByRole("dialog",{name:"Command palette",exact:true});await palette.getByRole("combobox",{name:"Command",exact:true}).fill("Edited WSL launch");await expect(palette.getByRole("option").first()).toContainText("Edited WSL launch");await qterm.page.keyboard.press("Escape");
    await qterm.pane(pane).getByRole("textbox",{name:"Terminal input",exact:true}).press("Enter");
    await expect(qterm.page.getByRole("status").filter({hasText:"recorded shell profile changed"})).toBeVisible();
    await qterm.run(pane,"printf 'TASK_SHELL_KEPT_%s\\n' \"$((6*7))\"");await expect.poll(()=>qterm.terminalText(pane)).toContain("TASK_SHELL_KEPT_42");expect(fixture.record()).toBe(null);expect((await qterm.workspace()).tabs).toHaveLength(2);
  }finally{if(original)fs.writeFileSync(file,original);await qterm.stop();}
});
