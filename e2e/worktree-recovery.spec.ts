// R56: save failure blocks Git mutation; retry and explicit backup recovery.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { IDENTIFIER, expect, test } from "./qterm";
import { verificationProject } from "./verification-project";

test("worktree creation waits for durable history and recovery preserves an unreadable original", async ({ qterm }) => {
  const project = verificationProject(), directory = project.dir + "-recovery";
  const file = path.join(process.env.LOCALAPPDATA!, IDENTIFIER, "worktree-tasks.json");
  try {
    await qterm.waitForPrompt(await qterm.activePane());
    await qterm.page.getByRole("button", { name: "Worktree tasks", exact: true }).click();
    let panel = qterm.page.getByRole("dialog", { name: "Worktree tasks", exact: true });
    await panel.getByRole("button", { name: "New worktree task", exact: true }).click();
    await panel.getByLabel("Worktree source folder", { exact: true }).fill(project.dir);
    await panel.getByLabel("Worktree task title", { exact: true }).fill("Recover task");
    await panel.getByLabel("Worktree new branch", { exact: true }).fill("qterm/recover-task");
    await panel.getByLabel("Worktree new directory", { exact: true }).fill(directory);
    await panel.getByLabel("Worktree task request", { exact: true }).fill("Review the check");
    await panel.getByLabel("Worktree agent", { exact: true }).selectOption("shell");
    await panel.getByRole("button", { name: "Preview worktree task", exact: true }).click();
    await expect(panel.getByLabel("Worktree creation preview", { exact: true })).toBeVisible();
    if (fs.existsSync(file)) fs.unlinkSync(file); fs.mkdirSync(file);
    await panel.getByRole("button", { name: "Create reviewed worktree", exact: true }).click();
    await expect(panel.getByRole("alert")).toContainText("No worktree created");
    expect(fs.existsSync(directory)).toBe(false);
    const banner = qterm.page.getByRole("alert", { name: "Save problem", exact: true }); await expect(banner).toContainText("Worktree tasks");
    fs.rmdirSync(file); await expect(banner).toBeHidden({ timeout: 15_000 });
    await panel.getByRole("button", { name: "Close worktree tasks", exact: true }).click(); await qterm.quit();
    fs.writeFileSync(file, "unreadable worktree history"); await qterm.start();
    await qterm.page.getByRole("button", { name: "Worktree tasks", exact: true }).click(); panel = qterm.page.getByRole("dialog", { name: "Worktree tasks", exact: true });
    await expect(panel.getByRole("alert")).toContainText("Cannot read worktree tasks"); expect(fs.readFileSync(file, "utf8")).toBe("unreadable worktree history");
    await panel.getByRole("button", { name: "Recover worktree history", exact: true }).click();
    await panel.getByRole("button", { name: "Keep backup and recover worktree history", exact: true }).click();
    await expect(panel.getByRole("alert")).toHaveCount(0);
    const backup = fs.readdirSync(path.dirname(file)).find((name) => /^worktree-tasks\.backup-/.test(name)); expect(backup).toBeTruthy();
    expect(fs.readFileSync(path.join(path.dirname(file), backup!), "utf8")).toBe("unreadable worktree history");
    expect(JSON.parse(fs.readFileSync(file, "utf8")).tasks).toEqual([]); expect(fs.existsSync(directory)).toBe(false);
  } finally {
    await qterm.stop();
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) fs.rmdirSync(file);
    if (fs.existsSync(directory)) { const target = fs.realpathSync.native(directory), temp = fs.realpathSync.native(os.tmpdir()); if (path.dirname(target).toLowerCase() !== temp.toLowerCase() || !path.basename(target).startsWith("qterm-verification-")) throw new Error("Unexpected cleanup target"); fs.rmSync(target, { recursive: true, force: true }); }
    project.cleanup();
  }
});
