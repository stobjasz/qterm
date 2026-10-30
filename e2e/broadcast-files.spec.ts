// R72: actual clipboard, ConPTY, PowerShell, Linux Python and the same PNG file.
import {execFileSync} from "node:child_process";
import {expect,test} from "./qterm";
const distro=process.env.QTERM_E2E_WSL_DISTRIBUTION;
test.skip(!distro,"Set QTERM_E2E_WSL_DISTRIBUTION to an installed distribution");
test.use({settings:{extra:['[[profiles]]','id = "custom:Broadcast Linux"','name = "Broadcast Linux"',`command = ${JSON.stringify(`wsl.exe --distribution "${distro??"unavailable"}" --exec /bin/bash --noprofile --norc -i`)}`].join("\n")}});
test("mixed-shell broadcast pastes one environment-specific image path into each real interpreter",async({qterm},info)=>{
  const windows=await qterm.activePane();await qterm.waitForPrompt(windows);
  await qterm.page.keyboard.press("Control+Shift+P");const palette=qterm.page.getByRole("dialog",{name:"Command palette",exact:true});await palette.getByRole("combobox",{name:"Command",exact:true}).fill("split right broadcast linux");await palette.getByRole("option",{name:/^Split right with\s*Broadcast Linux/}).click();await expect.poll(()=>qterm.activePane()).not.toBe(windows);const linux=await qterm.activePane();await expect.poll(()=>qterm.terminalText(linux)).toMatch(/bash-[\d.]+\$/);
  execFileSync("pwsh",["-NoProfile","-STA","-Command","Add-Type -AssemblyName System.Windows.Forms, System.Drawing; $b=New-Object System.Drawing.Bitmap 17, 3; $b.SetPixel(0,0,[System.Drawing.Color]::Blue); [System.Windows.Forms.Clipboard]::SetImage($b)"],{windowsHide:true});
  const type=async(pane:string,text:string)=>{await qterm.pane(pane).getByRole("textbox",{name:"Terminal input",exact:true}).focus();await qterm.page.keyboard.press("Shift");await qterm.page.keyboard.insertText(text);};
  await type(windows,"Add-Type -AssemblyName System.Drawing; $i=[System.Drawing.Image]::FromFile((Resolve-Path ");
  await type(linux,`python3 -c 'import sys,struct; assert len(sys.argv)==2; d=open(sys.argv[1],"rb").read(24); print("LINUX_IMAGE_%dx%d"%struct.unpack(">II",d[16:24]))' `);
  await qterm.page.keyboard.press("Alt+Shift+B");await expect(qterm.page.getByLabel("Broadcasting input",{exact:true})).toBeVisible();await qterm.page.keyboard.press("Control+Shift+V");
  await expect.poll(()=>qterm.terminalText(windows)).toMatch(/qterm-images\\pasted-\d+\.png/);await expect.poll(()=>qterm.terminalText(linux)).toMatch(/qterm-images\/pasted-\d+\.png/);
  await qterm.page.keyboard.press("Alt+Shift+B");await expect(qterm.page.getByLabel("Broadcasting input",{exact:true})).toHaveCount(0);
  await qterm.run(windows,')); "WINDOWS_IMAGE_$($i.Width)x$($i.Height)"; $i.Dispose()');await expect.poll(()=>qterm.terminalText(windows)).toContain("WINDOWS_IMAGE_17x3");
  await qterm.run(linux,"");await expect.poll(()=>qterm.terminalText(linux)).toContain("LINUX_IMAGE_17x3");await qterm.page.screenshot({path:info.outputPath("broadcast-files.png")});
});
