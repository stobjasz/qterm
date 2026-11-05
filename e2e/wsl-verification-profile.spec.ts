// R106: alter actual settings while Bash startup is blocked by a real read.
import fs from "node:fs";
import path from "node:path";
import {expect,IDENTIFIER,test} from "./qterm";
import {wslVerificationFixture} from "./wsl-verification-fixture";
const fixture=wslVerificationFixture();
test.skip(!fixture.distro,"Requires an installed WSL distribution");
test.use({settings:fixture.settings});test.beforeAll(fixture.seed);test.afterAll(fixture.cleanup);
test("a delayed Linux verification rejects changed profile settings without executing the check",async({qterm})=>{
  let original="";const file=path.join(process.env.APPDATA!,IDENTIFIER,"config.toml");
  try{
    const preview=await fixture.preview(qterm);fixture.flag("hold");
    await preview.getByRole("button",{name:"Run reviewed command",exact:true}).click();await expect(preview).toBeHidden();
    const pane=await qterm.activePane();await expect.poll(()=>qterm.terminalText(pane)).toContain("WSL_PROFILE_WAITING_42");
    original=qterm.settingsOnDisk();const updated=original.replace(/name\s*=\s*"WSL launch"/,'name = "Edited WSL launch"').replace(' --exec /bin/bash ',' --exec /bin/bash --norc ');
    expect(updated).toContain(' --exec /bin/bash --norc ');fs.writeFileSync(file,updated);
    await qterm.page.keyboard.press("Control+Shift+P");const palette=qterm.page.getByRole("dialog",{name:"Command palette",exact:true});
    await palette.getByRole("combobox",{name:"Command",exact:true}).fill("Edited WSL launch");await expect(palette.getByRole("option").first()).toContainText("Edited WSL launch");await qterm.page.keyboard.press("Escape");
    await qterm.pane(pane).getByRole("textbox",{name:"Terminal input",exact:true}).press("Enter");
    await expect(qterm.page.getByRole("status").filter({hasText:"verification shell configuration changed"})).toBeVisible();
    await qterm.run(pane,"printf 'VERIFY_SHELL_KEPT_%s\\n' \"$((6*7))\"");await expect.poll(()=>qterm.terminalText(pane)).toContain("VERIFY_SHELL_KEPT_42");
    expect(fixture.executions()).toBe(1);expect(await qterm.terminalText(pane)).not.toContain("VERIFIED_42");
  }finally{if(original)fs.writeFileSync(file,original);await qterm.stop();}
});
