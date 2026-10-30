// R70: actual WSL/ConPTY, persisted output, edited on-disk profile and real process sentinel.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {expect,IDENTIFIER,test} from "./qterm";
const distro=process.env.QTERM_E2E_WSL_DISTRIBUTION;
const command=`wsl.exe --distribution "${distro??"unavailable"}" --exec /bin/bash --noprofile --norc -i`;
const profileDefinition=['[[profiles]]','id = "custom:Restored Linux"','name = "Restored Linux"',`command = ${JSON.stringify(command)}`,'cwd = "/tmp"'].join("\n");
test.skip(!distro,"Set QTERM_E2E_WSL_DISTRIBUTION to an installed distribution");
test.use({settings:{values:{default_profile:'"custom:Restored Linux"'},extra:profileDefinition}});
test("a restored Linux pane rejects an edited profile before launching it and recovers only after an explicit switch",async({qterm},info)=>{
  const parent=fs.realpathSync.native(os.tmpdir()),root=fs.mkdtempSync(path.join(parent,"qterm-wsl-restore-"));
  const worker=path.join(root,"worker.cjs"),sentinel=path.join(root,"must-not-start");
  fs.writeFileSync(worker,`require('fs').writeFileSync(${JSON.stringify(sentinel)},'started');`);
  const config=path.join(process.env.APPDATA!,IDENTIFIER,"config.toml"),original=qterm.settingsOnDisk();
  try{
    const pane=await qterm.activePane();await expect.poll(()=>qterm.terminalText(pane)).toMatch(/bash-[\d.]+\$/);
    await qterm.run(pane,"printf 'LINUX_RESTORE_%s\\n' \"$((6*7))\"");await expect.poll(()=>qterm.terminalText(pane)).toContain("LINUX_RESTORE_42");
    await qterm.restart();await expect.poll(()=>qterm.terminalText(pane)).toMatch(/bash-[\d.]+\$/);
    expect((await qterm.workspace()).panes[pane]).toMatchObject({cwd:"/tmp",environment:`wsl:${distro!.toLowerCase()}`});
    await expect.poll(()=>qterm.terminalText(pane)).toContain("LINUX_RESTORE_42");
    await qterm.run(pane,"printf 'LINUX_REOPEN_%s\\n' \"$((7*7))\"");await expect.poll(()=>qterm.terminalText(pane)).toContain("LINUX_REOPEN_49");
    await qterm.quit();
    const changed=original.replace(JSON.stringify(command),JSON.stringify(`"${process.execPath}" "${worker}"`));expect(changed).not.toBe(original);fs.writeFileSync(config,changed);
    await qterm.start();await expect.poll(()=>qterm.terminalText(pane)).toContain(`This pane belongs to wsl:${distro!.toLowerCase()}`);
    await expect.poll(()=>qterm.terminalText(pane)).toContain("LINUX_REOPEN_49");expect(fs.existsSync(sentinel)).toBe(false);
    expect((await qterm.workspace()).panes[pane]).toMatchObject({cwd:"/tmp",environment:`wsl:${distro!.toLowerCase()}`});
    await qterm.page.screenshot({path:info.outputPath("wsl-restore-rejected.png")});
    await qterm.quit();const removed=original.replace(profileDefinition,"");expect(removed).not.toContain('id = "custom:Restored Linux"');fs.writeFileSync(config,removed);await qterm.start();
    await expect.poll(()=>qterm.terminalText(pane)).toContain("unknown profile custom:Restored Linux");
    expect((await qterm.workspace()).panes[pane]).toMatchObject({profileId:"custom:Restored Linux",environment:`wsl:${distro!.toLowerCase()}`,cwd:"/tmp"});expect(fs.existsSync(sentinel)).toBe(false);
    await qterm.page.keyboard.press("Control+Shift+P");const palette=qterm.page.getByRole("dialog",{name:"Command palette",exact:true});await palette.getByRole("combobox",{name:"Command",exact:true}).fill("switch this pane to powershell");await palette.getByRole("option",{name:/^Switch this pane to\s*PowerShell/}).click();
    await expect.poll(()=>qterm.activePane()).not.toBe(pane);const recovered=await qterm.activePane();await qterm.waitForPrompt(recovered);await qterm.run(recovered,"Write-Output ('RECOVERED_' + (8*8))");await expect.poll(()=>qterm.terminalText(recovered)).toContain("RECOVERED_64");expect((await qterm.workspace()).panes[recovered].environment).toBe("native");expect(fs.existsSync(sentinel)).toBe(false);
  }finally{
    fs.writeFileSync(config,original);await qterm.stop();
    const target=fs.realpathSync.native(root);if(path.dirname(target).toLowerCase()!==parent.toLowerCase()||!path.basename(target).startsWith("qterm-wsl-restore-"))throw Error("Unexpected WSL restore cleanup target");fs.rmSync(target,{recursive:true,force:true});
  }
});
