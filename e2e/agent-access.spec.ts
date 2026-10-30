// R57: real reviewed project grant -> CLI/native pipe -> scope -> revoke/exit.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { EXE, expect, test } from "./qterm";
import { verificationProject, quote } from "./verification-project";

function cli(file: string, method: string, params: unknown = {}) {
  const result = spawnSync(EXE, ["--agent-client", file, method, JSON.stringify(params)], { encoding: "utf8", timeout: 10000, windowsHide: true });
  if (!result.stdout.trim()) throw new Error(`Agent CLI returned no JSON (exit ${result.status})`);
  return { status: result.status, body: JSON.parse(result.stdout.trim()) };
}
test("a session grant scopes real CLI reads and revocation or app exit invalidates its connection", async ({ qterm }, info) => {
  const a = verificationProject(), b = verificationProject();
  try {
    const paneA = await qterm.activePane(); await qterm.waitForPrompt(paneA); await qterm.run(paneA, `Set-Location ${quote(a.dir)}`);
    await expect.poll(async () => (await qterm.workspace()).panes[paneA]?.cwd).toBe(a.dir);
    await qterm.run(paneA, "Write-Output ('project-a-' + (6*7))"); await expect.poll(() => qterm.terminalText(paneA)).toContain("project-a-42");
    await qterm.page.keyboard.press("Control+Shift+T"); const paneB = await qterm.activePane(); expect(paneB).not.toBe(paneA);
    await qterm.waitForPrompt(paneB); await qterm.run(paneB, `Set-Location ${quote(b.dir)}`);
    await expect.poll(async () => (await qterm.workspace()).panes[paneB]?.cwd).toBe(b.dir);
    await qterm.run(paneB, "Write-Output ('project-b-' + (3*9))");
    await expect.poll(() => qterm.terminalText(paneB)).toContain("project-b-27");
    const toggle = () => qterm.page.getByRole("button", { name: "Agent access", exact: true }); await toggle().click();
    let panel = qterm.page.getByRole("dialog", { name: "Agent access", exact: true }); await expect(panel.getByRole("status")).toHaveText("Agent access is off");
    await panel.getByLabel("Agent access project folder", { exact: true }).fill(a.dir); await panel.getByLabel("Agent access client label", { exact: true }).fill("Test reader");
    const grant = async () => {
      await panel.getByRole("button", { name: "Review project access", exact: true }).click();
      await expect(panel.getByLabel("Agent access review", { exact: true })).toContainText(a.dir);
      await expect(panel.getByRole("button", { name: "Create session read grant", exact: true })).toBeDisabled();
      await panel.getByRole("checkbox", { name: "Allow read access to this project for this qterm session", exact: true }).check();
      await panel.getByRole("button", { name: "Create session read grant", exact: true }).click();
      await expect(panel.getByRole("status")).toHaveText("1 session grant active");
      return (await panel.getByLabel("Connection file for Test reader", { exact: true }).textContent())!;
    };
    const file = await grant(); expect(fs.existsSync(file)).toBe(true);
    await expect.poll(() => cli(file, "panes.list").body.result?.panes.map((p: { id: string }) => p.id)).toEqual([paneA]);
    await expect.poll(() => cli(file, "commands.list").body.result?.commands.map((r: { command: string }) => r.command)).toContain("Write-Output ('project-a-' + (6*7))");
    const listed = cli(file, "commands.list"); expect(listed.status).toBe(0);
    expect(listed.body.result.commands.some((r: { command: string }) => r.command.includes("project-b-"))).toBe(false);
    const command = listed.body.result.commands.find((r: { command: string }) => r.command.includes("project-a-"));
    const result = cli(file, "commands.result", { commandId: command.id }); expect(result.body.result.output).toBe("project-a-42");
    const outside = cli(file, "commands.list", { paneId: paneB }); expect(outside.status).toBe(1); expect(outside.body.error?.code).toBe("not_available");
    expect(cli(file,"tasks.run",{ command:"Write-Output forbidden" }).body.error?.code).toBe("access_denied");
    const fake = path.join(a.dir, "invalid-connection.json"), credentials = JSON.parse(fs.readFileSync(file, "utf8"));
    fs.writeFileSync(fake, JSON.stringify({ ...credentials, token: "0".repeat(64) })); expect(cli(fake,"commands.list").body.error?.code).toBe("access_denied");
    await qterm.page.screenshot({ path: info.outputPath("agent-access.png") });
    await panel.getByRole("button", { name: "Revoke access for Test reader", exact: true }).click(); await expect(panel.getByRole("status")).toHaveText("Agent access is off");
    expect(fs.existsSync(file)).toBe(false); expect(cli(file,"commands.list").body.error.code).toBe("connection_error");
    const next = await grant(); await qterm.restart(); expect(fs.existsSync(next)).toBe(false);
    await toggle().click(); panel = qterm.page.getByRole("dialog", { name: "Agent access", exact: true }); await expect(panel.getByRole("status")).toHaveText("Agent access is off");
    expect(cli(next,"commands.list").body.error.code).toBe("connection_error");
  } finally { await qterm.stop(); a.cleanup(); b.cleanup(); }
});
