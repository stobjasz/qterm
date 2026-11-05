// R90: the root --exec command need not be an interactive shell.
import {expect,test} from "./qterm";
import {wslLaunchFixture} from "./wsl-launch-fixture";
const fixture=wslLaunchFixture();
test.skip(!fixture.distro,"Requires an installed WSL distribution");
test.use({settings:{...fixture.settings,values:{...fixture.settings.values,default_profile:'"custom:WSL direct"'},extra:[fixture.settings.extra,'[[profiles]]','id="custom:WSL direct"','name="WSL direct"',`command=${JSON.stringify(`wsl.exe --distribution "${fixture.distro}" --exec /usr/bin/python3 -I -S "${fixture.root}/direct.py"`)}`].join("\n")}});
test.beforeAll(()=>{
  if(!fixture.distro)return;fixture.seed();const code="import ctypes,signal\nctypes.CDLL(None).prctl(15,b'qterm-direct',0,0,0)\nprint('DIRECT_PROGRAM_'+str(6*7),flush=True)\nwhile True:signal.pause()\n";
  fixture.python(`open(${JSON.stringify(`${fixture.root}/direct.py`)},'w').write(${JSON.stringify(code)})`);
});test.afterAll(()=>{if(fixture.distro)fixture.cleanup();});
test("a directly launched WSL program is named before close and Stop cannot invent a shell",async({qterm})=>{
  try{
    const pane=await qterm.activePane();await expect.poll(()=>qterm.terminalText(pane)).toContain("DIRECT_PROGRAM_42");
    await qterm.pane(pane).getByRole("textbox",{name:"Terminal input",exact:true}).focus();await qterm.page.keyboard.press("Control+Shift+W");const dialog=qterm.page.getByRole("alertdialog",{name:"Close this pane?",exact:true});await expect(dialog).toContainText("qterm-direct");await dialog.getByRole("button",{name:"Cancel",exact:true}).click();
    await qterm.page.keyboard.press("Control+Shift+P");const palette=qterm.page.getByRole("dialog",{name:"Command palette",exact:true});await palette.getByRole("combobox",{name:"Command",exact:true}).fill("stop what runs");await palette.getByRole("option",{name:/Stop what runs in this pane/}).click();await expect(qterm.page.getByRole("status")).toContainText("there is no shell to keep");expect((await qterm.workspace()).panes[pane]).toBeTruthy();
  }finally{await qterm.stop();}
});
