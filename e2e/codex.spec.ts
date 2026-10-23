// Real desktop coverage with an isolated CODEX_HOME and an idle codex.exe stand-in.
// No live account, API call, or changes to the user's Codex configuration.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EXE, expect, test } from "./qterm";

const ID = "01a1690c-c7b7-7e80-9864-e6971b91db16";
const home = path.join(fs.realpathSync.native(os.tmpdir()), `qterm-codex-e2e-${process.pid}`);
const sessions = path.join(home, "sessions", "2026", "10", "23");
const fakeExe = path.join(home, "codex.exe");
test.beforeAll(() => {
  fs.mkdirSync(sessions, { recursive: true });
  fs.writeFileSync(path.join(sessions, `rollout-test-${ID}.jsonl`), [
    { type: "session_meta", payload: { id: ID, cwd: home, git: { branch: "codex-test" } } },
    { type: "event_msg", payload: { type: "user_message", message: "Fix the Codex integration" } },
    { type: "turn_context", payload: { model: "example-model" } },
    { type: "event_msg", payload: { type: "token_count", info: { last_token_usage: { total_tokens: 25000 }, total_token_usage: { output_tokens: 500 }, model_context_window: 100000 }, rate_limits: { primary: { used_percent: 23, window_minutes: 300 } } } },
  ].map((r) => JSON.stringify(r)).join("\n"));
  fs.copyFileSync(process.execPath, fakeExe);
});
const quote = (s: string) => `'${s.replaceAll("'", "''")}'`;
test.use({ settings: { values: { codex_sessions: "true", claude_sessions: "true" }, env: { CODEX_HOME: home } } });
test.afterAll(() => fs.rmSync(home, { recursive: true, force: true }));

function input(event: string, extra: object = {}): string {
  const file = path.join(home, `${event}.json`);
  fs.writeFileSync(file, JSON.stringify({ hook_event_name: event, session_id: ID, ...extra }));
  return `Get-Content ${quote(file)} -Raw | & ${quote(EXE)} --codex-notify`;
}

test("Codex history is separate from Claude and can resume in the current shell", async ({ qterm }) => {
  const pane = await qterm.activePane();
  await qterm.waitForPrompt(pane);
  // Intercept launching Codex in the test shell, so no real CLI/account is used.
  await qterm.run(pane, 'function global:codex { Write-Output ("RESUME_ARGS " + ($args -join " ")) }');
  await expect.poll(() => qterm.page.evaluate((id) => {
    const registry = window.__qterm!.registry as unknown as { commandRunning(id: string): boolean };
    return registry.commandRunning(id);
  }, pane)).toBe(false);
  await qterm.page.getByRole("button", { name: "Codex sessions", exact: true }).click();
  await expect(qterm.page.getByRole("menuitem").filter({ hasText: "Fix the Codex integration" })).toBeVisible();
  await qterm.page.getByRole("button", { name: "Resume Fix the Codex integration in the current tab", exact: true }).click();
  await expect(qterm.page.getByRole("tab")).toHaveCount(1);
  await expect.poll(() => qterm.terminalText(pane)).toContain(`RESUME_ARGS --no-daemon resume ${ID}`);
  await qterm.run(pane, `Write-Output 'codex resume ${ID}'`);
  await expect.poll(async () => (await qterm.invoke<{ id: string }[]>("list_codex_sessions")).map((s) => s.id)).toContain(ID);
  expect((await qterm.invoke<{ id: string }[]>("list_claude_sessions")).some((s) => s.id === ID)).toBe(false);
});

test("Codex hooks deliver context, plan usage, activity and the last reply to its tab", async ({ qterm }) => {
  const pane = await qterm.activePane();
  await qterm.waitForPrompt(pane);
  await qterm.run(pane, `Start-Process -WindowStyle Hidden ${quote(fakeExe)} '-e "setTimeout(() => {}, 60000)"'`);
  const tab = qterm.page.getByRole("tab").first();
  await expect(tab.getByRole("status", { name: "Codex is idle", exact: true })).toBeVisible({ timeout: 30000 });
  await qterm.run(pane, input("SessionStart"));
  await expect(tab.getByLabel("Codex context 25% full")).toBeVisible();
  await qterm.run(pane, input("UserPromptSubmit"));
  await expect(tab.getByRole("status", { name: "Codex is working", exact: true })).toBeVisible();
  await qterm.run(pane, input("Stop", { last_assistant_message: "Done: Codex integration verified." }));
  await expect(tab).toHaveAccessibleDescription(/Codex's last reply:\s+Done: Codex integration verified\./);
  await expect(tab.getByRole("status", { name: "Codex is idle", exact: true })).toBeVisible();
  await qterm.page.getByRole("button", { name: "Codex sessions", exact: true }).click();
  await expect(qterm.page.getByRole("region", { name: "Codex running now" })).toContainText("5-hour 23%");
});

test("a Codex permission request marks its background tab", async ({ qterm }) => {
  const pane = await qterm.activePane();
  await qterm.waitForPrompt(pane);
  await qterm.run(pane, `Start-Sleep -Seconds 2; ${input("PermissionRequest")}`);
  await qterm.page.keyboard.press("Control+Shift+T");
  await expect(qterm.page.getByRole("tab")).toHaveCount(2);
  await expect(qterm.page.getByRole("tab").first().getByRole("status", { name: /Codex needs permission/ })).toBeVisible();
});
