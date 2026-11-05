// R95: actual quiet Linux images, no hooks, no same-folder association.
import {expect,test} from "./qterm";
import {wslProviderFixture} from "./wsl-provider-fixture";
const fixture=wslProviderFixture();
test.skip(!fixture.distro,"Requires an installed WSL distribution");
test.use({settings:fixture.settings});test.beforeAll(fixture.seed);
test.afterAll(()=>{if(fixture.distro)fixture.cleanup();});

for(const provider of ["claude","codex"] as const)test(`a quiet Linux ${provider} process has scoped unknown status until it ends`,async({qterm})=>{
  try{
    const first=await fixture.ready(qterm);
    await qterm.run(first,`printf 'PROVIDER_STARTED_%s\\n' "$((6*7))"; '${fixture.root}/bin/${provider}' -I -S -c 'import signal; signal.pause()'`);
    await expect.poll(()=>qterm.terminalText(first)).toContain("PROVIDER_STARTED_42");
    const label=`${provider==="claude"?"Claude":"Codex"} status unknown`;
    const providerLabel=new RegExp(`^${provider==="claude"?"Claude":"Codex"} `);
    const firstTab=qterm.page.getByRole("tab").nth(0),firstStatus=firstTab.getByRole("status",{name:label,exact:true});
    await expect(firstStatus).toBeVisible();await expect(firstStatus).toHaveAccessibleDescription(/Process scan/);
    await qterm.page.getByRole("button",{name:"New tab",exact:true}).click();
    await expect.poll(()=>qterm.activePane()).not.toBe(first);const second=await fixture.ready(qterm);
    // Provider words in a different running program's arguments are not proof.
    await qterm.run(second,"printf 'NO_PROVIDER_%s claude codex\\n' \"$((6*7))\"; python3 -I -S -c 'import signal; signal.pause()' claude codex");
    await expect.poll(()=>qterm.terminalText(second)).toContain("NO_PROVIDER_42 claude codex");
    await expect(qterm.page.getByRole("tab").nth(1).getByRole("status",{name:providerLabel})).toHaveCount(0);
    await firstTab.click();await qterm.pane(first).getByRole("textbox",{name:"Terminal input",exact:true}).focus();await qterm.page.keyboard.press("Control+C");
    await expect(firstTab.getByRole("status",{name:providerLabel})).toHaveCount(0);
    await expect(qterm.page.getByRole("tab").nth(1).getByRole("status",{name:providerLabel})).toHaveCount(0);
    await qterm.run(first,"printf 'PROVIDER_ENDED_%s\\n' \"$((6*7))\"");
    await expect.poll(()=>qterm.terminalText(first)).toContain("PROVIDER_ENDED_42");
  }finally{await qterm.stop();}
});
