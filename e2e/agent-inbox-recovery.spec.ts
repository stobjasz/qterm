// R48: actual blocked file replacement and corrupt saved history, through real UI.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EXE, IDENTIFIER, expect, test } from "./qterm";

test("inbox writes retry without another event and recovery preserves unreadable history", async ({ qterm }) => {
  const file = path.join(process.env.LOCALAPPDATA!, IDENTIFIER, "agent-inbox.json");
  const input = path.join(os.tmpdir(), `qterm-inbox-recovery-${Date.now()}.json`);
  fs.writeFileSync(input, JSON.stringify({ hook_event_name: "StopFailure", session_id: "failed-session", error: "rate_limit", error_details: "Try again after the rate limit resets." }));
  fs.mkdirSync(file);
  try {
    const pane = await qterm.activePane(); await qterm.waitForPrompt(pane);
    await qterm.run(pane, `Get-Content '${input.replaceAll("'", "''")}' -Raw | & '${EXE.replaceAll("'", "''")}' --claude-notify`);
    const warning = qterm.page.getByRole("alert", { name: "Save problem", exact: true });
    await expect(warning).toContainText("Agent inbox");
    await qterm.page.getByRole("button", { name: "Agent inbox", exact: true }).click();
    const dialog = qterm.page.getByRole("dialog", { name: "Agent inbox", exact: true });
    await expect(dialog.getByRole("status")).toHaveText("1 open · 1 unread");
    fs.rmdirSync(file);
    // Automatic retry needs no new provider hook, edit, or manual action.
    await expect(warning).toBeHidden({ timeout: 15_000 });
    await expect.poll(() => { try { return JSON.parse(fs.readFileSync(file, "utf8")).events[0]?.message; } catch { return ""; } }).toBe("Try again after the rate limit resets.");
    await qterm.quit();
    fs.writeFileSync(file, "unreadable agent history");
    await qterm.start();
    await qterm.page.getByRole("button", { name: "Agent inbox", exact: true }).click();
    const recovery = qterm.page.getByRole("dialog", { name: "Agent inbox", exact: true });
    await expect(recovery.getByRole("alert")).toContainText("Could not read saved agent inbox");
    expect(fs.readFileSync(file, "utf8")).toBe("unreadable agent history");
    await recovery.getByRole("button", { name: "Recover saved inbox", exact: true }).click();
    await recovery.getByRole("button", { name: "Keep backup and recover", exact: true }).click();
    await expect(recovery.getByRole("alert")).toHaveCount(0);
    const backup = fs.readdirSync(path.dirname(file)).find((name) => name.startsWith("agent-inbox.backup-"));
    expect(backup).toBeTruthy();
    expect(fs.readFileSync(path.join(path.dirname(file), backup!), "utf8")).toBe("unreadable agent history");
    expect(JSON.parse(fs.readFileSync(file, "utf8")).events).toEqual([]);
    fs.unlinkSync(path.join(path.dirname(file), backup!));
  } finally {
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) fs.rmdirSync(file);
    fs.rmSync(input, { force: true });
  }
});
