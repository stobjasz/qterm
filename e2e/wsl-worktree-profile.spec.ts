// R102: profile command edits retain the same WSL distribution; exact identity matters.
import fs from "node:fs";
import path from "node:path";
import {expect,IDENTIFIER,test} from "./qterm";
import {wslWorktreeFixture} from "./wsl-worktree-fixture";
const fixture=wslWorktreeFixture();
test.skip(!fixture.distro,"Requires an installed WSL distribution");
test.use({settings:fixture.settings});test.beforeAll(fixture.seed);test.afterAll(fixture.cleanup);
for(const phase of ["preview","saved task"] as const)test(`an edited WSL shell command invalidates a ${phase} without opening its replacement`,async({qterm})=>{
  const config=path.join(process.env.APPDATA!,IDENTIFIER,"config.toml");let original="";
  try{
    const panel=await fixture.preview(qterm);
    if(phase==="saved task"){await panel.getByRole("button",{name:"Create reviewed worktree",exact:true}).click();await expect(panel.getByRole("status",{name:"Worktree change summary",exact:true})).toBeVisible();}
    original=qterm.settingsOnDisk();const updated=original.replace(/name\s*=\s*"WSL launch"/,'name = "Edited WSL launch"').replace(' --exec /bin/bash ',' --exec /bin/bash --norc ');expect(updated).not.toBe(original);expect(updated).toContain(' --exec /bin/bash --norc ');fs.writeFileSync(config,updated);
    if(phase==="preview"){
      await expect(panel.getByLabel("Worktree creation preview",{exact:true})).toContainText("Shell: Edited WSL launch");
      await panel.getByRole("button",{name:"Create reviewed worktree",exact:true}).click();
    }else{
      await panel.getByRole("button",{name:"Close worktree tasks",exact:true}).click();
      await qterm.page.keyboard.press("Control+Shift+P");const palette=qterm.page.getByRole("dialog",{name:"Command palette",exact:true});await palette.getByRole("combobox",{name:"Command",exact:true}).fill("Edited WSL launch");await expect(palette.getByRole("option").first()).toContainText("Edited WSL launch");await qterm.page.keyboard.press("Escape");await qterm.page.getByRole("button",{name:"Worktree tasks",exact:true}).click();await panel.getByRole("button",{name:"Open worktree shell",exact:true}).click();
    }
    await expect(panel.getByRole("alert")).toContainText("recorded shell profile changed");expect((await qterm.workspace()).tabs).toHaveLength(1);expect(fixture.record()).toBe(null);if(phase==="preview")expect(fixture.exists(fixture.target)).toBe(false);
  }finally{if(original)fs.writeFileSync(config,original);await qterm.stop();fixture.python(`import os,shutil
target=${JSON.stringify(fixture.target)}
if os.path.exists(target):
    assert os.path.realpath(target)==target and os.path.dirname(target)==${JSON.stringify(fixture.root)}
    shutil.rmtree(target)`);}
});
