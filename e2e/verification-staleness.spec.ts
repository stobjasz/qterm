// R51: actual shell check -> before/after repository evidence -> persistence -> edit.
import fs from "node:fs";
import path from "node:path";
import { expect, test } from "./qterm";
import { verificationProject, quote } from "./verification-project";

test("a tracked check survives restart and marks changed repository state stale", async ({ qterm }, info) => {
  const project = verificationProject();
  try {
    const pane = await qterm.activePane(); await qterm.waitForPrompt(pane);
    await qterm.run(pane, `Set-Location ${quote(project.dir)}`);
    await expect.poll(async () => (await qterm.workspace()).panes[pane]?.cwd).toBe(project.dir);
    await qterm.run(pane, project.command);
    await expect.poll(() => qterm.terminalText(pane)).toContain("checked-84");
    const toggle = qterm.page.getByRole("button", { name: "Problems and command runs", exact: true });
    await toggle.click();
    let panel = qterm.page.getByRole("dialog", { name: "Problems and command runs", exact: true });
    await panel.getByRole("button", { name: /Inspect run:.*check\.cjs/ }).click();
    await expect(panel.getByRole("status", { name: "Verification freshness", exact: true })).toContainText("No before-run");
    await panel.getByRole("button", { name: "Run with repository tracking", exact: true }).click();
    const preview = qterm.page.getByRole("dialog", { name: "Run with repository tracking", exact: true });
    await expect(preview.getByLabel("Verification command", { exact: true })).toHaveText(project.command);
    expect((await qterm.workspace()).tabs).toHaveLength(1); // Preview alone executes nothing.
    await preview.getByRole("button", { name: "Run reviewed command", exact: true }).click();
    await expect(preview).toBeHidden();
    const tracked = await qterm.activePane(); expect(tracked).not.toBe(pane);
    await expect.poll(() => qterm.terminalText(tracked)).toContain("checked-84");
    await toggle.click();
    await panel.getByRole("button", { name: /Inspect run:.*check\.cjs/ }).click();
    let freshness = panel.getByRole("status", { name: "Verification freshness", exact: true });
    await expect(freshness).toContainText("repository matches checked state");
    await panel.getByText("Repository evidence", { exact: true }).click();
    await expect(panel.getByLabel("Run details", { exact: true })).toContainText("SHA-256:");
    await qterm.page.screenshot({ path: info.outputPath("verification-evidence.png") });
    await panel.getByRole("button", { name: "Close problems", exact: true }).click();
    await qterm.restart();
    await qterm.page.getByRole("button", { name: "Problems and command runs", exact: true }).click();
    panel = qterm.page.getByRole("dialog", { name: "Problems and command runs", exact: true });
    freshness = panel.getByRole("status", { name: "Verification freshness", exact: true });
    await panel.getByRole("button", { name: /Inspect run:.*check\.cjs/ }).click();
    await expect(freshness).toContainText("repository matches checked state");
    await expect(panel.getByRole("button", { name: "Go to command pane", exact: true })).toBeDisabled();
    fs.writeFileSync(path.join(project.dir, "value.cjs"), "module.exports = 43;\n");
    await expect(freshness).toContainText("Stale:", { timeout: 15_000 });
    await expect(panel.getByLabel("Run details", { exact: true })).toContainText("Exit 0");
    // The old command's success remains historical; it never validates the edit.
  } finally { await qterm.stop(); project.cleanup(); }
});
