// R111: edit a real profile after review; never launch the recorded Linux path elsewhere.
import fs from "node:fs";
import path from "node:path";
import {expect,IDENTIFIER,test} from "./qterm";
import {wslVerificationFixture} from "./wsl-verification-fixture";
const fixture=wslVerificationFixture();
test.skip(!fixture.distro,"Requires an installed WSL distribution");test.use({settings:fixture.settings});
test.beforeAll(fixture.seed);test.afterAll(fixture.cleanup);
test("an unavailable replacement distribution cannot run a recorded WSL check",async({qterm})=>{
  let original='';const file=path.join(process.env.APPDATA!,IDENTIFIER,'config.toml');
  try{
    const preview=await fixture.preview(qterm);original=qterm.settingsOnDisk();
    const updated=original.replace(/name\s*=\s*"WSL launch"/,'name = "Unavailable verification shell"').replace(`--distribution \\"${fixture.distro}\\"`,`--distribution \\"qterm-missing-${Date.now()}\\"`);
    expect(updated).not.toBe(original);expect(updated).toContain('qterm-missing-');fs.writeFileSync(file,updated);
    // The palette observes the freshly parsed configuration; no WSL launch is needed.
    await qterm.page.keyboard.press('Escape');await fixture.panel(qterm).getByRole('button',{name:'Close problems',exact:true}).click();await qterm.page.keyboard.press('Control+Shift+P');
    const palette=qterm.page.getByRole('dialog',{name:'Command palette',exact:true});
    await palette.getByRole('combobox',{name:'Command',exact:true}).fill('Unavailable verification shell');await expect(palette.getByRole('option').first()).toContainText('Unavailable verification shell');await qterm.page.keyboard.press('Escape');
    const panel=await fixture.inspect(qterm);await panel.getByRole('button',{name:'Run with repository tracking',exact:true}).click();
    await preview.getByRole('button',{name:'Run reviewed command',exact:true}).click();
    await expect(preview.getByRole('alert')).toContainText('no longer matches the recorded environment');
    expect((await qterm.workspace()).tabs).toHaveLength(1);expect(fixture.executions()).toBe(1);
  }finally{if(original)fs.writeFileSync(file,original);await qterm.stop();}
});
