// Risk R39: real failed atomic file replacement -> persistent warning -> retry
// without another layout change -> successful restart with the recovered layout.
import fs from "node:fs";
import path from "node:path";
import { IDENTIFIER, expect, test } from "./qterm";

test("a failed save retries the unchanged layout after the filesystem recovers", async ({ qterm }) => {
  const session = path.join(process.env.APPDATA!, IDENTIFIER, "session.json");
  const pane = await qterm.activePane();
  await qterm.waitForPrompt(pane);
  await expect.poll(async () => (await qterm.workspace()).panes[pane]?.cwd).toBeTruthy();
  await expect.poll(() => fs.existsSync(session)).toBe(true);
  // A directory at the destination reliably rejects atomic file replacement on Windows.
  fs.unlinkSync(session);
  fs.mkdirSync(session);
  try {
    await qterm.page.getByRole("tab").first().dblclick();
    const name = qterm.page.getByRole("textbox", { name: "Tab name", exact: true });
    await name.fill("Recovered workspace");
    await name.press("Enter");
    const warning = qterm.page.getByRole("alert", { name: "Save problem", exact: true });
    await expect(warning).toContainText("Workspace");
    // A startup save can still be queued: make sure this exact renamed snapshot
    // has failed before restoring access, rather than letting a later edit save it.
    await expect.poll(() => {
      try { return JSON.parse(fs.readFileSync(path.join(path.dirname(session), "session.partial"), "utf8")).tabs[0].title; } catch { return ""; }
    }).toBe("Recovered workspace");
    fs.rmdirSync(session);
    // No further layout change or manual retry: automatic recovery must save it.
    await expect(warning).toBeHidden();
    await expect.poll(() => {
      try { return JSON.parse(fs.readFileSync(session, "utf8")).tabs[0].title; } catch { return ""; }
    }).toBe("Recovered workspace");
    await qterm.restart();
    await expect(qterm.page.getByRole("tab").first()).toContainText("Recovered workspace");
  } finally {
    if (fs.existsSync(session) && fs.statSync(session).isDirectory()) fs.rmdirSync(session);
  }
});
