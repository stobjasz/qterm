// R71: Windows clipboard, real PNG, WSL mount translation and ConPTY shells.
import fs from "node:fs";import os from "node:os";import path from "node:path";import {execFileSync} from "node:child_process";
import {expect,test} from "./qterm";
const distro=process.env.QTERM_E2E_WSL_DISTRIBUTION;
test.skip(!distro,"Set QTERM_E2E_WSL_DISTRIBUTION to an installed distribution");
test.use({settings:{extra:['[[profiles]]','id = "custom:Path Linux"','name = "Path Linux"',`command = ${JSON.stringify(`wsl.exe --distribution "${distro??"unavailable"}" --exec /bin/bash --noprofile --norc -i`)}`].join("\n")}});
const quote=(value:string)=>`'${value.replaceAll("'",`'\\''`)}'`;
const python=(source:string)=>execFileSync("wsl.exe",["--distribution",distro!,"--exec","/usr/bin/python3","-c",source],{encoding:"utf8",timeout:30000,windowsHide:true});
test("a WSL split reads a pasted PNG and a Linux mount alias switches back to its actual Windows folder",async({qterm},info)=>{
  const parent=fs.realpathSync.native(os.tmpdir()),root=fs.mkdtempSync(path.join(parent,"qterm-wsl-paths-")),folder=path.join(root,"Zażółć it's $data");fs.mkdirSync(folder);
  const script=path.join(folder,"check image.py");fs.writeFileSync(script,"import sys,struct\nwith open(sys.argv[1],'rb') as f:data=f.read(24)\nassert data[:8]==bytes([137,80,78,71,13,10,26,10])\nw,h=struct.unpack('>II',data[16:24]);print('WSL_PNG_%dx%d'%(w,h))\n");
  let linuxRoot:string|undefined;
  const palette=async(query:string,name:RegExp)=>{await qterm.page.keyboard.press("Control+Shift+P");const dialog=qterm.page.getByRole("dialog",{name:"Command palette",exact:true});await dialog.getByRole("combobox",{name:"Command",exact:true}).fill(query);await dialog.getByRole("option",{name}).click();};
  try{
    const linuxFolder=execFileSync("wsl.exe",["--distribution",distro!,"--exec","/usr/bin/wslpath","-u","-a",folder],{encoding:"utf8",timeout:30000,windowsHide:true}).trim();
    linuxRoot=JSON.parse(python(`import os,tempfile,json; root=tempfile.mkdtemp(prefix='qterm-wsl-paths-');os.symlink(${JSON.stringify(linuxFolder)},os.path.join(root,'mounted volume'));print(json.dumps(root))`));
    const first=await qterm.activePane();await qterm.waitForPrompt(first);await qterm.run(first,`Set-Location '${folder.replaceAll("'","''")}'`);await expect.poll(async()=>(await qterm.workspace()).panes[first]?.cwd).toBe(folder);
    await palette("split right path linux",/^Split right with\s*Path Linux/);await expect.poll(()=>qterm.activePane()).not.toBe(first);const linux=await qterm.activePane();await expect.poll(async()=>(await qterm.workspace()).panes[linux]?.cwd).toBe(linuxFolder);
    execFileSync("pwsh",["-NoProfile","-STA","-Command","Add-Type -AssemblyName System.Windows.Forms, System.Drawing; $b=New-Object System.Drawing.Bitmap 13, 2; $b.SetPixel(0,0,[System.Drawing.Color]::Red); [System.Windows.Forms.Clipboard]::SetImage($b)"],{windowsHide:true});
    await qterm.pane(linux).getByRole("textbox",{name:"Terminal input",exact:true}).focus();await qterm.page.keyboard.press("Shift");await qterm.page.keyboard.insertText(`python3 ${quote(`${linuxFolder}/check image.py`)} `);await qterm.page.keyboard.press("Control+Shift+V");await expect.poll(()=>qterm.terminalText(linux)).toMatch(/qterm-images\/pasted-\d+\.png/);await qterm.page.keyboard.press("Enter");await expect.poll(()=>qterm.terminalText(linux)).toContain("WSL_PNG_13x2");
    await qterm.run(linux,`cd ${quote(`${linuxRoot}/mounted volume`)}`);await expect.poll(async()=>(await qterm.workspace()).panes[linux]?.cwd).toBe(`${linuxRoot}/mounted volume`);
    await palette("switch this pane to command prompt",/^Switch this pane to\s*Command Prompt/);await expect.poll(()=>qterm.activePane()).not.toBe(linux);await expect(qterm.page.getByRole("alertdialog",{name:"Switch this pane's shell?",exact:true})).toHaveCount(0);const cmd=await qterm.activePane();await expect.poll(()=>qterm.terminalText(cmd)).toContain(`${folder}>`);await qterm.run(cmd,"set /a 9*9");await expect.poll(()=>qterm.terminalText(cmd)).toMatch(/^81$/m);await qterm.page.screenshot({path:info.outputPath("wsl-paths.png")});
  }finally{
    await qterm.page.screenshot({path:info.outputPath("wsl-paths-final.png")}).catch(()=>{});
    await qterm.stop();if(linuxRoot)python(`import os,shutil; root=os.path.realpath(${JSON.stringify(linuxRoot)});assert os.path.dirname(root)=='/tmp' and os.path.basename(root).startswith('qterm-wsl-paths-');shutil.rmtree(root) if os.path.exists(root) else None`);
    const target=fs.realpathSync.native(root);if(path.dirname(target).toLowerCase()!==parent.toLowerCase()||!path.basename(target).startsWith("qterm-wsl-paths-"))throw Error("Unexpected path fixture cleanup target");fs.rmSync(target,{recursive:true,force:true});
  }
});
