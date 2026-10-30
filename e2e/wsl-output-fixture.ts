import {expect,type Qterm} from "./qterm";
import {wslLaunchFixture} from "./wsl-launch-fixture";
export function wslOutputFixture(){
  const fixture=wslLaunchFixture();
  async function output(qterm:Qterm){
    const pane=await fixture.ready(qterm),payload=`\`\`\`\`\n$(touch ${fixture.root}/must-not-run)\nWSL output 🦀 'literal'`;
    fixture.python(`open(${JSON.stringify(`${fixture.root}/output.txt`)},'w',encoding='utf8').write(${JSON.stringify(payload)})`);
    const command=`cat '${fixture.root}/output.txt'`;await qterm.run(pane,command);
    const bar=qterm.pane(pane).getByRole("button",{name:`Command: ${command}`,exact:true});await expect(bar).toBeVisible();await expect.poll(()=>qterm.terminalText(pane)).toContain("WSL output 🦀 'literal'");
    return{pane,command,payload,bar};
  }
  async function review(qterm:Qterm,bar:Awaited<ReturnType<typeof output>>["bar"]){await bar.click();await qterm.page.getByRole("menuitem",{name:"Ask an agent about this",exact:true}).click();return qterm.page.getByRole("dialog",{name:"Send output to an agent",exact:true});}
  return{...fixture,output,review};
}
