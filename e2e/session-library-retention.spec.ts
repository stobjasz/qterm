// R68: native config watcher and cached discovery are real.
import fs from "node:fs";
import path from "node:path";
import {expect,IDENTIFIER,test} from "./qterm";
import {discover,libraryFixture,openLibrary,sessionRow} from "./session-library-fixture";
const fixture=libraryFixture();test.use({settings:fixture.settings});test.beforeAll(fixture.seed);test.afterAll(fixture.cleanup);
test("disabling history removes cached library context and permits only the explicit pin reference",async({qterm})=>{
  await qterm.waitForPrompt(await qterm.activePane());const panel=await openLibrary(qterm.page);await discover(panel);await sessionRow(panel,"claude").getByRole("button").click();await panel.getByRole("button",{name:"Pin selected session",exact:true}).click();
  const config=path.join(process.env.APPDATA!,IDENTIFIER,"config.toml"),settings=qterm.settingsOnDisk();fs.writeFileSync(config,settings.replace(/^claude_sessions\s*=.*$/m,"claude_sessions = false").replace(/^codex_sessions\s*=.*$/m,"codex_sessions = false"));
  await expect(panel).toContainText("Claude history: disabled");await expect(panel).toContainText("Codex history: disabled");await expect(panel.getByRole("button",{name:"Discover / refresh enabled sources",exact:true})).toBeDisabled();await expect(panel.getByRole("listitem")).toHaveCount(1);await expect(sessionRow(panel,"claude")).not.toContainText("Claude library alpha");await expect(panel.getByRole("region",{name:"Selected library session",exact:true})).toContainText("Session history is disabled");await expect(panel.getByRole("button",{name:"Review session handoff",exact:true})).toBeDisabled();await expect(panel.getByRole("button",{name:"Resume selected session in new tab",exact:true})).toBeDisabled();
  await panel.getByText("Discovery status",{exact:true}).click();await expect(panel).toContainText("claude: history disabled");await expect(panel).toContainText("codex: history disabled");
  const saved=fs.readFileSync(path.join(process.env.LOCALAPPDATA!,IDENTIFIER,"session-pins.json"),"utf8");expect(saved).not.toContain("PRIVATE_CLAUDE_EXCERPT");expect(saved).not.toContain(fixture.project1);expect(saved).not.toContain("Claude library alpha");
});
