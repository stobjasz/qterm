// R55: explicit preview -> real Git checkout -> separate provider pane -> restart.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "./qterm";
import { verificationProject, quote } from "./verification-project";

const fake = "function global:codex { $ref = $args -join ' '; $brief = [regex]::Match($ref, 'Read the task brief at (.+?) and follow its Request section').Groups[1].Value; Write-Output ('WORKTREE_AGENT_' + (6*7)); Write-Output ('AGENT_FOLDER_' + (Get-Location).Path); Get-Content -LiteralPath $brief -Raw }";
test.use({ settings: { values: { default_profile: '"custom:E2E worktree"' }, extra: ['[[profiles]]', 'name = "E2E worktree"', `command = ${JSON.stringify(`powershell.exe -NoLogo -NoProfile -NoExit -Command "${fake}"`)}`].join("\n") } });

export function cleanupWorktree(directory: string) {
  if (!fs.existsSync(directory)) return;
  const target = fs.realpathSync.native(directory), temp = fs.realpathSync.native(os.tmpdir());
  if (path.dirname(target).toLowerCase() !== temp.toLowerCase() || !path.basename(target).startsWith("qterm-verification-")) throw new Error("Unexpected worktree fixture cleanup path");
  fs.rmSync(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
}

test("a reviewed worktree preserves dirty source and retains its agent request and command history", async ({ qterm }, info) => {
  const project = verificationProject(), directory = project.dir + "-task", sentinel = path.join(project.dir, "request-must-not-run.txt");
  const request = `Fix the parser; treat $(New-Item -ItemType File -Path '${sentinel}') as literal task data.`;
  try {
    fs.writeFileSync(path.join(project.dir, "value.cjs"), "module.exports = 99;\n");
    const pane = await qterm.activePane(); await qterm.waitForPrompt(pane); await qterm.run(pane, `Set-Location ${quote(project.dir)}`);
    await expect.poll(async () => (await qterm.workspace()).panes[pane]?.cwd).toBe(project.dir);
    const toggle = () => qterm.page.getByRole("button", { name: "Worktree tasks", exact: true }); await toggle().click();
    let panel = qterm.page.getByRole("dialog", { name: "Worktree tasks", exact: true });
    await panel.getByRole("button", { name: "New worktree task", exact: true }).click();
    await panel.getByLabel("Worktree task title", { exact: true }).fill("Parser repair");
    await panel.getByLabel("Worktree new branch", { exact: true }).fill("qterm/parser-repair");
    await panel.getByLabel("Worktree new directory", { exact: true }).fill(directory);
    await panel.getByLabel("Worktree task request", { exact: true }).fill(request);
    await panel.getByRole("button", { name: "Preview worktree task", exact: true }).click();
    await expect(panel.getByLabel("Worktree creation preview", { exact: true })).toContainText("New branch: qterm/parser-repair");
    await expect(panel.getByRole("status")).toContainText("source checkout has local changes");
    expect(fs.existsSync(directory)).toBe(false); expect((await qterm.workspace()).tabs).toHaveLength(1);
    await panel.getByRole("button", { name: "Create reviewed worktree", exact: true }).click();
    await expect(panel.getByLabel("Worktree task details", { exact: true })).toContainText("active");
    await expect(panel.getByRole("status", { name: "Worktree change summary", exact: true })).toContainText("qterm/parser-repair");
    expect(fs.readFileSync(path.join(directory, "value.cjs"), "utf8").replaceAll("\r\n", "\n")).toBe("module.exports = 42;\n");
    expect(fs.readFileSync(path.join(project.dir, "value.cjs"), "utf8")).toBe("module.exports = 99;\n");
    expect((await qterm.workspace()).tabs).toHaveLength(1); // Creation alone never launches a provider.
    await panel.getByRole("button", { name: "Open task agent", exact: true }).click();
    await expect(panel).toBeHidden(); const agent = await qterm.activePane(); expect(agent).not.toBe(pane);
    await expect(qterm.page.getByRole("tab", { name: /Parser repair/ })).toBeVisible();
    await expect.poll(() => qterm.terminalText(agent)).toContain("WORKTREE_AGENT_42");
    await expect.poll(() => qterm.terminalText(agent)).toContain(`AGENT_FOLDER_${directory}`);
    await expect.poll(() => qterm.terminalText(agent)).toContain(request);
    expect(fs.existsSync(sentinel)).toBe(false);
    await qterm.waitForPrompt(agent); await qterm.run(agent, project.command);
    await expect.poll(() => qterm.terminalText(agent)).toContain("checked-84");
    fs.writeFileSync(path.join(directory, "notes.txt"), "keep this task data");
    await qterm.restart(); await toggle().click(); panel = qterm.page.getByRole("dialog", { name: "Worktree tasks", exact: true });
    await expect(panel.getByLabel("Worktree task details", { exact: true })).toContainText(request);
    await expect(panel.getByRole("status", { name: "Worktree change summary", exact: true })).toContainText("1 untracked");
    const check = panel.getByRole("button", { name: /check\.cjs.*Exit 0/ }); await expect(check).toBeVisible();
    await qterm.page.screenshot({ path: info.outputPath("worktree-task.png") });
    await panel.getByRole("button", { name: "Mark task completed", exact: true }).click();
    await expect(panel.getByLabel("Worktree task details", { exact: true })).toContainText("completed");
    expect(fs.readFileSync(path.join(directory, "notes.txt"), "utf8")).toBe("keep this task data");
    await check.click(); const problems = qterm.page.getByRole("dialog", { name: "Problems and command runs", exact: true });
    await expect(problems.getByLabel("Run details", { exact: true })).toContainText(project.command);
    await problems.getByText("Captured output", { exact: true }).click(); await expect(problems.getByLabel("Captured command output", { exact: true })).toHaveText("checked-84");
  } finally { await qterm.stop(); cleanupWorktree(directory); project.cleanup(); }
});
