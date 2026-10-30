// R77: real profile startup barriers and distinct case-sensitive directories.
import fs from "node:fs";import path from "node:path";
import {expect,IDENTIFIER,test} from "./qterm";
import {wslLaunchFixture} from "./wsl-launch-fixture";
const fixture=wslLaunchFixture();test.skip(!fixture.distro,"Requires an installed WSL distribution");test.use({settings:fixture.settings});test.beforeAll(fixture.seed);test.afterAll(fixture.cleanup);test.beforeEach(()=>fixture.reset());
for(const reason of ["case","revoked"] as const)test(`a pending WSL resume is cancelled when ${reason==="case"?"its shell enters a differently cased directory":"source access is revoked before the prompt"}`,async({qterm})=>{
  await fixture.ready(qterm);fixture.flag(reason==="case"?"wrong-case":"hold");const library=await fixture.select(qterm,"codex");await library.getByRole("button",{name:"Resume selected session in new tab",exact:true}).click();await expect(qterm.page.getByRole("tab")).toHaveCount(2);const pane=await qterm.activePane();
  if(reason==="revoked"){
    await expect.poll(()=>qterm.terminalText(pane)).toContain("WSL_PROFILE_WAITING_42");const file=path.join(process.env.APPDATA!,IDENTIFIER,"config.toml"),original=qterm.settingsOnDisk();fs.writeFileSync(file,original.replace(/^codex_sessions\s*=.*$/m,"codex_sessions = false"));await expect(qterm.page.getByRole("status")).toContainText("Source launch cancelled: history or source settings changed before its shell was ready.");await qterm.pane(pane).getByRole("textbox",{name:"Terminal input",exact:true}).press("Enter");
  }else await expect(qterm.page.getByText(/Startup command cancelled: the shell started in a different folder/)).toBeVisible();
  await expect.poll(()=>qterm.terminalText(pane)).toContain(`${reason==="case"?`${fixture.root}/case`:fixture.project}$`);await qterm.run(pane,"printf 'SHELL_USABLE_%s\\n' \"$((6*7))\"");await expect.poll(()=>qterm.terminalText(pane)).toContain("SHELL_USABLE_42");expect(fixture.record()).toBeNull();expect(await qterm.terminalText(pane)).not.toContain("WSL_AGENT_RESULT_42");
});
