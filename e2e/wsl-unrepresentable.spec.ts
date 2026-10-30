// R73: a real colon-bearing Linux directory, live Bash and native switch UI.
import {execFileSync} from "node:child_process";
import {expect,test} from "./qterm";
const distro=process.env.QTERM_E2E_WSL_DISTRIBUTION;
const python=(source:string)=>execFileSync("wsl.exe",["--distribution",distro!,"--exec","/usr/bin/python3","-c",source],{encoding:"utf8",timeout:30000,windowsHide:true});
test.skip(!distro,"Set QTERM_E2E_WSL_DISTRIBUTION to an installed distribution");
test.use({settings:{values:{default_profile:'"custom:Linux path"'},extra:['[[profiles]]','id = "custom:Linux path"','name = "Linux path"',`command = ${JSON.stringify(`wsl.exe --distribution "${distro??"unavailable"}" --exec /bin/bash --noprofile --norc -i`)}`,'cwd = "/tmp"'].join("\n")}});
test("an unrepresentable Linux folder blocks switching and keeps the original shell running",async({qterm},info)=>{
  const root:string=JSON.parse(python("import os,tempfile,json;root=tempfile.mkdtemp(prefix='qterm-wsl-unrepresentable-');os.mkdir(os.path.join(root,'cannot:represent'));print(json.dumps(root))"));
  try{
    const pane=await qterm.activePane();await expect.poll(()=>qterm.terminalText(pane)).toMatch(/bash-[\d.]+\$/);await qterm.run(pane,`cd '${root}/cannot:represent'`);await expect.poll(async()=>(await qterm.workspace()).panes[pane]?.cwd).toBe(`${root}/cannot:represent`);
    await qterm.page.keyboard.press("Control+Shift+P");const palette=qterm.page.getByRole("dialog",{name:"Command palette",exact:true});await palette.getByRole("combobox",{name:"Command",exact:true}).fill("switch this pane to powershell");await palette.getByRole("option",{name:/^Switch this pane to\s*PowerShell/}).click();await qterm.page.getByRole("button",{name:"Switch shell",exact:true}).click();
    await expect(qterm.page.getByText(/Could not switch the pane:.*cannot be represented safely/)).toBeVisible();expect(await qterm.activePane()).toBe(pane);expect((await qterm.workspace()).panes[pane]?.cwd).toBe(`${root}/cannot:represent`);
    await qterm.run(pane,"printf 'SHELL_PRESERVED_%s\\n' \"$((8*9))\"");await expect.poll(()=>qterm.terminalText(pane)).toContain("SHELL_PRESERVED_72");await qterm.page.screenshot({path:info.outputPath("wsl-unrepresentable.png")});
  }finally{await qterm.stop();python(`import os,shutil;root=os.path.realpath(${JSON.stringify(root)});assert os.path.dirname(root)=='/tmp' and os.path.basename(root).startswith('qterm-wsl-unrepresentable-');shutil.rmtree(root)`);}
});
