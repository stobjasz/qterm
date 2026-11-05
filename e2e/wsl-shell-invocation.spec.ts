// R92: real Bash -c/script roots share the registered shell executable image.
import {expect,test} from "./qterm";
import fs from "node:fs";
import {execFileSync} from "node:child_process";
import {wslLaunchFixture} from "./wsl-launch-fixture";
const fixture=wslLaunchFixture();test.skip(!fixture.distro,"Requires an installed WSL distribution");
const program="printf SHELL_PROGRAM_%s $((6*7)); read -r answer";
test.beforeAll(()=>{
  if(!fixture.distro)return;fixture.seed();fixture.python(`open(${JSON.stringify(`${fixture.root}/program.sh`)},'w').write(${JSON.stringify(program+"\n")})`);
  // Pure shared-executable cases complement the actual Bash/ConPTY cases below.
  const cases=[
    ["/busybox",["/bin/ash","-i"],true],["/busybox",["/bin/sleep","1000"],false],
    ["/busybox",["busybox","sh","-l"],true],["/busybox",["busybox","sleep","1000"],false],
    ["/busybox",["busybox","yes"],false],["/busybox",["/bin/true"],false],
    ["/busybox",["-ash"],true],["/busybox",["ash","-ic","read answer"],false],
    ["/bash",["bash","--rcfile","/tmp/-c","-i"],true],["/bash",["bash","--rcfile"],false],
    ["/bash",["bash","program.sh"],false],["/bash",["bash","--command=read answer"],false],
    ["/bash",["bash","--future-option"],false],["/bash",["counterfeit","-i"],false],
  ];
  execFileSync("wsl.exe",["--distribution",fixture.distro,"--exec","/usr/bin/python3","-I","-S","-c",`import sys,json;data=json.load(sys.stdin);scope={'__name__':'qterm_owner_tests'};exec(compile(data['source'],'wsl_owner.py','exec'),scope)
shells={'/busybox':{'sh','ash'},'/bash':{'bash'}}
for executable,argv,expected in data['cases']:assert scope['shell_invocation'](executable,argv,shells)==expected,(executable,argv,expected)`],{input:JSON.stringify({source:fs.readFileSync("src-tauri/src/wsl_owner.py","utf8"),cases}),encoding:"utf8",timeout:10000,windowsHide:true});
});test.afterAll(()=>{if(fixture.distro)fixture.cleanup();});
for(const mode of ["command","script"] as const)test.describe(mode,()=>{
  const argv=mode==="command"?`/bin/bash -c "${program}"`:`/bin/bash "${fixture.root}/program.sh"`;
  test.use({settings:{...fixture.settings,values:{...fixture.settings.values,default_profile:'"custom:Shell program"'},extra:[fixture.settings.extra,'[[profiles]]','id="custom:Shell program"','name="Shell program"',`command=${JSON.stringify(`wsl.exe --distribution "${fixture.distro}" --exec ${argv}`)}`].join("\n")}});
  test("a noninteractive shell invocation is named before close and cannot claim a retained shell",async({qterm})=>{
    try{
      const pane=await qterm.activePane();await expect.poll(()=>qterm.terminalText(pane)).toContain("SHELL_PROGRAM_42");await qterm.pane(pane).getByRole("textbox",{name:"Terminal input",exact:true}).focus();await qterm.page.keyboard.press("Control+Shift+W");const dialog=qterm.page.getByRole("alertdialog",{name:"Close this pane?",exact:true});await expect(dialog).toContainText("bash");await dialog.getByRole("button",{name:"Cancel",exact:true}).click();
      await qterm.page.keyboard.press("Control+Shift+P");const palette=qterm.page.getByRole("dialog",{name:"Command palette",exact:true});await palette.getByRole("combobox",{name:"Command",exact:true}).fill("stop what runs");await palette.getByRole("option",{name:/Stop what runs in this pane/}).click();await expect(qterm.page.getByRole("status")).toContainText("there is no shell to keep");expect((await qterm.workspace()).panes[pane]).toBeTruthy();
    }finally{await qterm.stop();}
  });
});
