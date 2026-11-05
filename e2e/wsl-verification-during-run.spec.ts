// R105: a real blocked Linux check must retain observed source mutations.
import {expect,test} from "./qterm";
import {wslVerificationFixture} from "./wsl-verification-fixture";
const fixture=wslVerificationFixture();
test.skip(!fixture.distro,"Requires an installed WSL distribution");
test.use({settings:fixture.settings});test.beforeAll(fixture.seed);test.afterAll(fixture.cleanup);
test("a restored source edit invalidates a successful Linux check",async({qterm})=>{
  const preview=await fixture.preview(qterm);fixture.pause();
  await preview.getByRole("button",{name:"Run reviewed command",exact:true}).click();await expect(preview).toBeHidden();
  const pane=await qterm.activePane();await expect.poll(()=>qterm.terminalText(pane)).toContain("VERIFY_WAITING_42");
  fixture.restoreAndRelease();await expect.poll(()=>qterm.terminalText(pane)).toContain("VERIFIED_42");
  const panel=await fixture.inspect(qterm);
  await expect(panel.getByRole("status",{name:"Verification freshness",exact:true})).toContainText("Stale:");
  await expect(panel.getByLabel("Run details",{exact:true})).toContainText("edits were observed");
  await expect(panel.getByLabel("Run details",{exact:true})).toContainText("Exit 0");
  expect(fixture.executions()).toBe(2);
});
