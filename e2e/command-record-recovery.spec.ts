// R53: real failed atomic replacement -> unchanged-result retry -> backup recovery.
import fs from "node:fs";
import path from "node:path";
import { IDENTIFIER, expect, test } from "./qterm";

test("command history retries failed writes and backs up unreadable records before recovery", async ({ qterm }) => {
  const file = path.join(process.env.LOCALAPPDATA!, IDENTIFIER, "command-runs.json");
  const pane = await qterm.activePane(); await qterm.waitForPrompt(pane);
  await qterm.run(pane, "Write-Output ('first-record-' + (2*3))");
  await expect.poll(() => fs.existsSync(file)).toBe(true);
  fs.unlinkSync(file); fs.mkdirSync(file);
  try {
    await qterm.run(pane, "Write-Output ('retained-record-' + (6*7))");
    const warning = qterm.page.getByRole("alert", { name: "Save problem", exact: true });
    await expect(warning).toContainText("Command records");
    fs.rmdirSync(file);
    await expect(warning).toBeHidden({ timeout: 15_000 });
    await expect.poll(() => {
      try { return JSON.parse(fs.readFileSync(file, "utf8")).runs.some((r: { output: string }) => r.output.includes("retained-record-42")); } catch { return false; }
    }).toBe(true);
    await qterm.restart();
    await qterm.page.getByRole("button", { name: "Problems and command runs", exact: true }).click();
    let panel = qterm.page.getByRole("dialog", { name: "Problems and command runs", exact: true });
    await panel.getByRole("button", { name: /Inspect run:.*retained-record/ }).click();
    await panel.getByText("Captured output", { exact: true }).click();
    await expect(panel.getByLabel("Captured command output", { exact: true })).toHaveText("retained-record-42");
    await qterm.quit();
    fs.writeFileSync(file, "corrupt command history");
    await qterm.start();
    await qterm.page.getByRole("button", { name: "Problems and command runs", exact: true }).click();
    panel = qterm.page.getByRole("dialog", { name: "Problems and command runs", exact: true });
    await expect(panel.getByRole("alert")).toContainText("Could not read command records");
    expect(fs.readFileSync(file, "utf8")).toBe("corrupt command history");
    await panel.getByRole("button", { name: "Recover command history", exact: true }).click();
    await panel.getByRole("button", { name: "Keep backup and recover records", exact: true }).click();
    await expect(panel.getByRole("alert")).toHaveCount(0);
    const backup = fs.readdirSync(path.dirname(file)).find((name) => /^command-runs\.backup-/.test(name));
    expect(backup).toBeTruthy();
    expect(fs.readFileSync(path.join(path.dirname(file), backup!), "utf8")).toBe("corrupt command history");
    expect(JSON.parse(fs.readFileSync(file, "utf8")).runs).toEqual([]);
  } finally {
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) fs.rmdirSync(file);
  }
});
