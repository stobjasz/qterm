// R52: a real paused check, native file watch, edit/restore, then actual completion.
import fs from "node:fs";
import path from "node:path";
import { expect, test } from "./qterm";
import { verificationProject, quote } from "./verification-project";

test("an edit restored before a tracked check finishes still invalidates its result", async ({ qterm }) => {
  const project = verificationProject();
  fs.writeFileSync(path.join(project.dir, "check.cjs"), `const fs = require('node:fs');
if (!fs.existsSync('target/pause')) { process.stdout.write('initial-' + (6*7) + '\\n'); } else {
  const watcher = fs.watch('target', () => { if (fs.existsSync('target/finish')) { watcher.close(); process.stdout.write('finished-' + (6*7) + '\\n'); } });
  process.stdout.write('check-waiting-' + process.pid + '\\n');
}`);
  try {
    const pane = await qterm.activePane(); await qterm.waitForPrompt(pane);
    await qterm.run(pane, `Set-Location ${quote(project.dir)}`);
    await expect.poll(async () => (await qterm.workspace()).panes[pane]?.cwd).toBe(project.dir);
    await qterm.run(pane, project.command);
    await expect.poll(() => qterm.terminalText(pane)).toContain("initial-42");
    fs.mkdirSync(path.join(project.dir, "target")); fs.writeFileSync(path.join(project.dir, "target/pause"), "pause");
    const toggle = qterm.page.getByRole("button", { name: "Problems and command runs", exact: true });
    await toggle.click();
    const panel = qterm.page.getByRole("dialog", { name: "Problems and command runs", exact: true });
    await panel.getByRole("button", { name: /Inspect run:.*check\.cjs/ }).click();
    await panel.getByRole("button", { name: "Run with repository tracking", exact: true }).click();
    const preview = qterm.page.getByRole("dialog", { name: "Run with repository tracking", exact: true });
    await preview.getByRole("button", { name: "Run reviewed command", exact: true }).click();
    await expect(preview).toBeHidden();
    const tracked = await qterm.activePane();
    await expect.poll(() => qterm.terminalText(tracked)).toMatch(/check-waiting-\d+/);
    const file = path.join(project.dir, "value.cjs"); const original = fs.readFileSync(file);
    fs.writeFileSync(file, "module.exports = 99;\n"); fs.writeFileSync(file, original);
    fs.writeFileSync(path.join(project.dir, "target/finish"), "finish");
    await expect.poll(() => qterm.terminalText(tracked)).toContain("finished-42");
    await toggle.click();
    await panel.getByRole("button", { name: /Inspect run:.*check\.cjs/ }).click();
    await expect(panel.getByRole("status", { name: "Verification freshness", exact: true })).toContainText("Stale:");
    await expect(panel.getByLabel("Run details", { exact: true })).toContainText("edits were observed");
  } finally { await qterm.stop(); project.cleanup(); }
});
