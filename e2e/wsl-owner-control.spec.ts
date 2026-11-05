// R89: a real unauthorized Unix-socket client cannot stop the pane's Linux tree.
import fs from "node:fs";import os from "node:os";import path from "node:path";
import {expect,test} from "./qterm";
import {wslLaunchFixture} from "./wsl-launch-fixture";
const fixture=wslLaunchFixture();let before=new Set<string>();
const files=()=>fs.readdirSync(os.tmpdir()).filter(name=>/^qterm-lifetime-[0-9a-f]{64}\.alive$/.test(name));
test.skip(!fixture.distro,"Requires an installed WSL distribution");test.use({settings:fixture.settings});test.beforeAll(()=>{before=new Set(files());fixture.seed();});test.afterAll(()=>{if(fixture.distro)fixture.cleanup();});
test("an unauthenticated supervisor client cannot stop Linux programs or disable later UI checks",async({qterm})=>{
  try{
    const pane=await fixture.ready(qterm);await qterm.run(pane,`sleep 1000 & printf '%s' "$!" > '${fixture.root}/target.pid'; printf 'CONTROL_TARGET_%s\\n' "$((6*7))"`);await expect.poll(()=>qterm.terminalText(pane)).toContain("CONTROL_TARGET_42");
    const owners=files().filter(name=>!before.has(name));expect(owners.length).toBe(1);const token=fs.readFileSync(path.join(os.tmpdir(),owners[0]),"utf8");
    const result=fixture.python(`import socket,json,hashlib,os,time
token=${JSON.stringify(token)}
with socket.socket(socket.AF_UNIX,socket.SOCK_STREAM) as client:
    client.settimeout(2);client.connect('\\0qterm-owner-'+hashlib.sha256(token.encode()).hexdigest());client.sendall((json.dumps({'nonce':'1'*32,'method':'stop','expires':time.monotonic_ns()+2_500_000_000,'proof':'0'*64})+'\\n').encode())
    try:client.recv(8192)
    except ConnectionResetError:pass
pid=int(open(${JSON.stringify(`${fixture.root}/target.pid`)}).read())
try:print(open('/proc/'+str(pid)+'/stat').read().rsplit(')',1)[1].split()[0]!='Z')
except FileNotFoundError:print(False)`);
    expect(result).toBe("True");
    await qterm.pane(pane).getByRole("textbox",{name:"Terminal input",exact:true}).focus();await qterm.page.keyboard.press("Control+Shift+W");const dialog=qterm.page.getByRole("alertdialog",{name:"Close this pane?",exact:true});await expect(dialog).toContainText("sleep");await dialog.getByRole("button",{name:"Cancel",exact:true}).click();
    await qterm.run(pane,"printf 'AFTER_UNAUTHORIZED_CONTROL_%s\\n' \"$((6*7))\"");await expect.poll(()=>qterm.terminalText(pane)).toContain("AFTER_UNAUTHORIZED_CONTROL_42");
  }finally{await qterm.stop();}
});
