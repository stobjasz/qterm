// R97: actual Windows Node programs launched by WSL, plus detached Windows children.
import {expect,test} from "./qterm";
import {wslInteropFixture} from "./wsl-interop-fixture";
const fixture=wslInteropFixture();
test.skip(!fixture.distro,"Requires an installed WSL distribution");
test.use({settings:fixture.settings});test.beforeAll(fixture.seed);test.afterAll(()=>{if(fixture.distro)fixture.cleanup();});
test.beforeEach(()=>{fixture.inspect(true);});
for(const exit of ["quit","crash"] as const)test(`qterm ${exit} ends WSL-launched Windows programs and detached children but preserves unrelated programs`,async({qterm})=>{
  const unrelated=fixture.unrelated();
  try{
    const pane=await fixture.ready(qterm);await qterm.run(pane,fixture.command());
    await expect.poll(()=>qterm.terminalText(pane)).toContain("INTEROP_PROGRAM_42");
    await expect.poll(()=>fixture.inspect().map(p=>p.tag).sort()).toEqual(["owned","owned-child","unrelated","unrelated-child"]);
    const before=fixture.inspect(),unrelatedIdentity=before.filter(p=>p.tag.startsWith("unrelated")).sort((a,b)=>a.tag.localeCompare(b.tag));
    if(exit==="quit")await qterm.quit();else await qterm.crash();
    await expect.poll(()=>fixture.inspect().filter(p=>p.tag.startsWith("owned")),{message:`Windows descendants must end after ${exit}`}).toEqual([]);
    expect(fixture.inspect().filter(p=>p.tag.startsWith("unrelated")).sort((a,b)=>a.tag.localeCompare(b.tag))).toEqual(unrelatedIdentity);
  }finally{await qterm.stop();fixture.inspect(true);unrelated.kill();}
});
