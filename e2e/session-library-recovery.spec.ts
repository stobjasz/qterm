// R66: real filesystem blockers and an unreadable saved pin list.
import fs from "node:fs";
import path from "node:path";
import {expect,IDENTIFIER,test} from "./qterm";
import {libraryFixture,openLibrary,sessionRow} from "./session-library-fixture";
const fixture=libraryFixture();test.use({settings:fixture.settings});test.beforeAll(fixture.seed);test.afterAll(fixture.cleanup);
test("pin writes recover without another edit and unreadable pins require explicit preserved-backup recovery",async({qterm})=>{
  const pinsFile=path.join(process.env.LOCALAPPDATA!,IDENTIFIER,"session-pins.json");await qterm.waitForPrompt(await qterm.activePane());let panel=await openLibrary(qterm.page);await sessionRow(panel,"claude").getByRole("button").click();fs.mkdirSync(pinsFile);
  await panel.getByRole("button",{name:"Pin selected session",exact:true}).click();await expect(panel.getByRole("button",{name:"Unpin selected session",exact:true})).toBeVisible();await expect(panel.getByRole("button",{name:"Retry session pins",exact:true})).toBeVisible();fs.rmdirSync(pinsFile);
  await expect.poll(()=>{try{return JSON.parse(fs.readFileSync(pinsFile,"utf8")).pins.length;}catch{return 0;}}).toBe(1);await expect(panel.getByRole("button",{name:"Retry session pins",exact:true})).toHaveCount(0);
  await qterm.stop();fs.writeFileSync(pinsFile,"unreadable pin original");await qterm.start();panel=await openLibrary(qterm.page);await expect(panel.getByRole("button",{name:"Back up unreadable pins and start a new list",exact:true})).toBeVisible();expect(fs.readFileSync(pinsFile,"utf8")).toBe("unreadable pin original");await panel.getByRole("button",{name:"Back up unreadable pins and start a new list",exact:true}).click();
  await expect(panel).toContainText("Preserved pin backup:");const backup=fs.readdirSync(path.dirname(pinsFile)).find(name=>/^session-pins\.backup-.*\.json$/.test(name));expect(backup).toBeDefined();expect(fs.readFileSync(path.join(path.dirname(pinsFile),backup!),"utf8")).toBe("unreadable pin original");expect(JSON.parse(fs.readFileSync(pinsFile,"utf8")).pins).toEqual([]);
});
