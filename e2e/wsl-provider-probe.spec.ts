// R96: pause only one authenticated owner; healthy sibling evidence survives.
import {expect,test} from "./qterm";
import {wslProviderFixture} from "./wsl-provider-fixture";
import {signalOwner} from "./wsl-owner-signal";
const fixture=wslProviderFixture();
test.skip(!fixture.distro,"Requires an installed WSL distribution");
test.use({settings:fixture.settings});test.beforeAll(fixture.seed);
test.afterAll(()=>{if(fixture.distro)fixture.cleanup();});

for(const provider of ["claude","codex"] as const)test(`a failed Linux ${provider} probe remains unknown and recovers independently`,async({qterm})=>{
  let paused=false;
  try{
    const first=await fixture.ready(qterm);
    await qterm.run(first,`printf '%s' "$PPID" > '${fixture.root}/owner.pid'; printf 'FIRST_PROVIDER_%s\\n' "$((6*7))"; '${fixture.root}/bin/${provider}' -I -S -c 'import signal; signal.pause()'`);
    await expect.poll(()=>qterm.terminalText(first)).toContain("FIRST_PROVIDER_42");
    const label=`${provider==="claude"?"Claude":"Codex"} status unknown`;
    const firstTab=qterm.page.getByRole("tab").nth(0),firstStatus=firstTab.getByRole("status",{name:label,exact:true});
    await expect(firstStatus).toHaveAccessibleDescription(/Process scan/);
    await qterm.page.getByRole("button",{name:"New tab",exact:true}).click();await expect.poll(()=>qterm.activePane()).not.toBe(first);
    const second=await fixture.ready(qterm);await qterm.run(second,`printf 'SECOND_PROVIDER_%s\\n' "$((6*7))"; '${fixture.root}/bin/${provider}' -I -S -c 'import signal; signal.pause()'`);
    await expect.poll(()=>qterm.terminalText(second)).toContain("SECOND_PROVIDER_42");
    const secondStatus=qterm.page.getByRole("tab").nth(1).getByRole("status",{name:label,exact:true});await expect(secondStatus).toHaveAccessibleDescription(/Process scan/);
    signalOwner(fixture,true);paused=true;
    await expect(firstStatus).toHaveAccessibleDescription(/timed out|deadline/i);
    await expect(secondStatus).toHaveAccessibleDescription(/Process scan/);await expect(secondStatus).not.toHaveAccessibleDescription(/timed out|deadline|failed|stale/i);
    signalOwner(fixture,false);paused=false;
    await expect(firstStatus).not.toHaveAccessibleDescription(/timed out|deadline|failed|stale/i);
    await firstTab.click();await qterm.pane(first).getByRole("textbox",{name:"Terminal input",exact:true}).focus();await qterm.page.keyboard.press("Control+C");
    await expect(firstTab.getByRole("status",{name:new RegExp(`^${provider==="claude"?"Claude":"Codex"} `)})).toHaveCount(0);await expect(secondStatus).toBeVisible();
  }finally{if(paused)signalOwner(fixture,false);await qterm.stop();}
});
