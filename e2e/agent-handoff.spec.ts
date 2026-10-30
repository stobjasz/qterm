// Risks R43/R44: real command marks, preview, file persistence and CLI arguments.
// Shell functions stand in for providers; no account or live model is used.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, startFakeClaude, test } from "./qterm";

const fake = "function global:codex { $ref = $args -join ' '; $brief = [regex]::Match($ref, 'Read the task brief at (.+?) and follow its Request section').Groups[1].Value; Write-Output ('BRIEF_FROM_' + (Get-Location).Path); Get-Content -LiteralPath $brief -Raw }; function global:claude { codex @args }";
const barrier = path.join(fs.realpathSync.native(os.tmpdir()), `qterm-handoff-barrier-${process.pid}.txt`);
const waitForEnter = `if (Test-Path -LiteralPath '${barrier.replaceAll("'", "''")}') { Write-Output 'STARTUP_WAITING_FOR_ENTER'; $null = [Console]::ReadLine(); Write-Output 'STARTUP_RELEASED' }`;
test.use({ settings: {
  values: { default_profile: '"custom:E2E handoff"' },
  extra: ['[[profiles]]', 'name = "E2E handoff"', `command = ${JSON.stringify(`powershell.exe -NoLogo -NoProfile -NoExit -Command "${fake}; ${waitForEnter}"`)}`].join("\n"),
} });
const quote = (s: string) => `'${s.replaceAll("'", "''")}'`;

for (const provider of ["codex", "claude"]) {
  test(`a reviewed output brief opens ${provider} in the original folder without executing its data`, async ({ qterm }) => {
    const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "qterm-handoff-")));
    const sentinel = path.join(root, "must-not-exist.txt");
    const expression = `$(New-Item -ItemType File -Path '${sentinel}') & %PATH%`;
    const payload = `terminal-only-${provider}: ${expression}`;
    const data = path.join(root, "error.txt");
    fs.writeFileSync(data, payload);
    const source = `Get-Content -LiteralPath ${quote(data)}`;
    try {
      const pane = await qterm.activePane();
      await qterm.waitForPrompt(pane);
      await qterm.run(pane, `Set-Location ${quote(root)}`);
      await expect.poll(async () => (await qterm.workspace()).panes[pane].cwd).toBe(root);
      await qterm.run(pane, source);
      const bar = qterm.pane(pane).getByRole("button", { name: `Command: ${source}`, exact: true });
      await expect(bar).toBeVisible();
      // Moving afterwards must not change which project the agent is given.
      await qterm.run(pane, "Set-Location ..");
      await expect.poll(async () => (await qterm.workspace()).panes[pane].cwd).toBe(path.dirname(root));
      await bar.click();
      await qterm.page.getByRole("menuitem", { name: "Ask an agent about this", exact: true }).click();
      const dialog = qterm.page.getByRole("dialog", { name: "Send output to an agent", exact: true });
      await dialog.getByRole("combobox", { name: "Agent provider", exact: true }).selectOption(provider);
      await dialog.getByRole("textbox", { name: "Agent request", exact: true }).fill(`Explain this request: ${expression}`);
      await expect(dialog.getByLabel("Agent brief preview", { exact: true })).toContainText(payload);
      await expect(dialog.getByLabel("Agent brief preview", { exact: true })).toContainText(root);
      await expect(qterm.page.getByRole("tab")).toHaveCount(1);
      expect(await qterm.terminalText(pane)).not.toContain("BRIEF_FROM_");
      expect(fs.existsSync(sentinel)).toBe(false);
      if (provider === "codex") await qterm.page.screenshot({ path: test.info().outputPath("handoff-preview.png") });
      await dialog.getByRole("button", { name: "Open agent with brief", exact: true }).click();
      await expect(dialog).toBeHidden();
      await expect(qterm.page.getByRole("tab")).toHaveCount(2);
      const agent = await qterm.activePane();
      await expect.poll(() => qterm.terminalText(agent)).toContain(`BRIEF_FROM_${root}`);
      await expect.poll(() => qterm.terminalText(agent)).toContain(`Explain this request: ${expression}`);
      await expect.poll(() => qterm.terminalText(agent)).toContain(payload);
      expect(fs.existsSync(sentinel)).toBe(false);
    } finally { await qterm.stop(); fs.rmSync(root, { recursive: true, force: true }); }
  });
}

test("a busy source shell rejects an agent handoff without typing into its program", async ({ qterm }) => {
  const pane = await qterm.activePane();
  await qterm.waitForPrompt(pane);
  const command = "Write-Output ('handoff-output-' + (2 + 2))";
  await qterm.run(pane, command);
  const bar = qterm.pane(pane).getByRole("button", { name: `Command: ${command}`, exact: true });
  await expect(bar).toBeVisible();
  await qterm.run(pane, startFakeClaude());
  await expect(qterm.page.getByRole("status", { name: "Claude status unknown", exact: true })).toBeVisible({ timeout: 30000 });
  await bar.click();
  await qterm.page.getByRole("menuitem", { name: "Ask an agent about this", exact: true }).click();
  const dialog = qterm.page.getByRole("dialog", { name: "Send output to an agent", exact: true });
  await dialog.getByRole("combobox", { name: "Agent destination", exact: true }).selectOption("current");
  await dialog.getByRole("button", { name: "Open agent with brief", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("source pane is busy");
  await expect(qterm.page.getByRole("tab")).toHaveCount(1);
  expect(await qterm.terminalText(pane)).not.toContain("Read the task brief at");
});

test("a new handoff waits for the profile's startup program to reach a shell prompt", async ({ qterm }) => {
  const pane = await qterm.activePane();
  await qterm.waitForPrompt(pane);
  const command = "Write-Output ('prompt-ready-' + (3 + 3))";
  await qterm.run(pane, command);
  const bar = qterm.pane(pane).getByRole("button", { name: `Command: ${command}`, exact: true });
  await expect(bar).toBeVisible();
  fs.writeFileSync(barrier, "hold the next profile before its prompt");
  try {
    await bar.click();
    await qterm.page.getByRole("menuitem", { name: "Ask an agent about this", exact: true }).click();
    const dialog = qterm.page.getByRole("dialog", { name: "Send output to an agent", exact: true });
    await dialog.getByRole("button", { name: "Open agent with brief", exact: true }).click();
    await expect(qterm.page.getByRole("tab")).toHaveCount(2);
    const agent = await qterm.activePane();
    await expect.poll(() => qterm.terminalText(agent)).toContain("STARTUP_WAITING_FOR_ENTER");
    await qterm.run(agent, "");
    await expect.poll(() => qterm.terminalText(agent)).toContain("STARTUP_RELEASED");
    await expect.poll(() => qterm.terminalText(agent)).toContain("BRIEF_FROM_");
    await expect.poll(() => qterm.terminalText(agent)).toContain("prompt-ready-6");
  } finally { fs.rmSync(barrier, { force: true }); }
});

test("keyboard focus stays in the handoff preview and Escape starts no agent", async ({ qterm }) => {
  const pane = await qterm.activePane();
  await qterm.waitForPrompt(pane);
  const command = "Write-Output ('preview-only-' + (4 + 4))";
  await qterm.run(pane, command);
  await qterm.pane(pane).getByRole("button", { name: `Command: ${command}`, exact: true }).click();
  await qterm.page.getByRole("menuitem", { name: "Ask an agent about this", exact: true }).click();
  const dialog = qterm.page.getByRole("dialog", { name: "Send output to an agent", exact: true });
  const request = dialog.getByRole("textbox", { name: "Agent request", exact: true });
  await expect(request).toBeFocused();
  await request.press("Shift+Tab");
  const send = dialog.getByRole("button", { name: "Open agent with brief", exact: true });
  await expect(send).toBeFocused();
  await send.press("Tab");
  await expect(request).toBeFocused();
  await request.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(qterm.page.getByRole("tab")).toHaveCount(1);
  expect(await qterm.terminalText(pane)).not.toContain("BRIEF_FROM_");
});
