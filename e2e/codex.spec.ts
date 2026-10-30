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
    { type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "<environment_context>Test context</environment_context>" }] } },
    { type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "Fix the Codex integration" }] } },
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
  const hooks = path.join(home, "hooks.json");
  const command = fs.existsSync(hooks)
    ? JSON.parse(fs.readFileSync(hooks, "utf8")).hooks[event][0].hooks[0].command as string
    : `& ${quote(EXE)} --codex-notify`;
  return `Get-Content ${quote(file)} -Raw | ${command}`;
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
  await qterm.page.getByRole("button", { name: "Codex sessions", exact: true }).click();
  await expect(qterm.page.getByRole("tab", { name: "Remembered", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(qterm.page.getByRole("menuitem").filter({ hasText: "Fix the Codex integration" })).toBeVisible();
  await qterm.page.getByRole("tab", { name: "Native Windows", exact: true }).click();
  await expect(qterm.page.getByRole("menuitem").filter({ hasText: "Fix the Codex integration" })).toBeVisible();
  await expect(qterm.page.getByRole("menuitem").filter({ hasText: "Fix the Codex integration" })).toContainText("1 prompt");
});

test("Codex hooks deliver context, plan usage, activity and the last reply to its tab", async ({ qterm }) => {
  const pane = await qterm.activePane();
  await qterm.waitForPrompt(pane);
  // Exercise the command installed by Settings through the real Windows shell.
  // Calling the exe directly would miss shell syntax failures in hooks.json.
  await qterm.page.getByRole("button", { name: "Settings", exact: true }).click();
  const settings = qterm.page.getByRole("dialog", { name: "Settings", exact: true });
  await settings.getByRole("searchbox", { name: "Search settings", exact: true }).fill("Codex");
  await settings.getByRole("button", { name: /Set up Codex hooks$/ }).click();
  await expect(settings.getByRole("button", { name: /Remove$/ }).last()).toBeVisible();
  await settings.getByRole("button", { name: "Cancel", exact: true }).click();
  await qterm.run(pane, `Start-Process -WindowStyle Hidden ${quote(fakeExe)} '-e "setTimeout(() => {}, 60000)"'`);
  const tab = qterm.page.getByRole("tab").first();
  await expect(tab.getByRole("status", { name: "Codex status unknown", exact: true })).toBeVisible({ timeout: 30000 });
  await qterm.run(pane, input("SessionStart"));
  await expect(tab.getByLabel("Codex context 25% full")).toBeVisible();
  await qterm.run(pane, input("UserPromptSubmit"));
  await expect(tab.getByRole("status", { name: "Codex is working", exact: true })).toBeVisible();
  await qterm.run(pane, input("Stop", { last_assistant_message: "Done: Codex integration verified." }));
  await expect(tab).toHaveAccessibleDescription(/Codex's last reply:\s+Done: Codex integration verified\./);
  const completed = tab.getByRole("status", { name: "Codex turn completed", exact: true });
  await expect(completed).toBeVisible();
  await expect(completed).toHaveAccessibleDescription(/Hook: Stop/);
  await qterm.run(pane, "Write-Output ('new-input-' + (1 + 1))");
  await expect(tab.getByRole("status", { name: "Codex status unknown", exact: true })).toBeVisible();
  await qterm.run(pane, input("PermissionRequest"));
  const waiting = tab.getByRole("status", { name: "Codex approval check (input not confirmed)", exact: true });
  await expect(waiting).toBeVisible();
  await expect(waiting).toHaveAccessibleDescription(/Hook: PermissionRequest/);
  await qterm.page.getByRole("button", { name: "Codex sessions", exact: true }).click();
  await expect(qterm.page.getByRole("region", { name: "Codex running now" })).toContainText("5-hour 23%");
});

test("a Codex approval check marks activity without claiming a question exists", async ({ qterm }) => {
  const pane = await qterm.activePane();
  await qterm.waitForPrompt(pane);
  await qterm.run(pane, `Start-Sleep -Seconds 2; ${input("PermissionRequest")}`);
  await qterm.page.keyboard.press("Control+Shift+T");
  await expect(qterm.page.getByRole("tab")).toHaveCount(2);
  await expect(qterm.page.getByRole("tab").first().getByRole("status", { name: /Codex approval check/ })).toBeVisible();
});

test("the session scan reports unrecognized files and refresh finds a new session", async ({ qterm }) => {
  const unknown = path.join(sessions, "unknown-format.jsonl");
  const added = path.join(sessions, "added-on-refresh.jsonl");
  fs.writeFileSync(unknown, '{"type":"unknown_format"}\n');
  try {
    await qterm.page.getByRole("button", { name: "Codex sessions", exact: true }).click();
    const scan = qterm.page.getByRole("region", { name: "Codex session scan", exact: true });
    await expect(scan).toContainText(home);
    await expect(scan).toContainText("2 rollout files scanned; 1 unrecognized.");
    fs.writeFileSync(added, [
      { type: "session_meta", payload: { id: "01a1690c-c7b7-7e80-9864-e6971b91db17", cwd: home } },
      { type: "event_msg", payload: { type: "user_message", message: "Found after refresh" } },
    ].map((record) => JSON.stringify(record)).join("\n"));
    await qterm.page.getByRole("button", { name: "Refresh Codex sessions", exact: true }).click();
    await expect(qterm.page.getByRole("menuitem").filter({ hasText: "Found after refresh" })).toBeVisible();
    await expect(scan).toContainText("3 rollout files scanned; 1 unrecognized.");
  } finally {
    fs.rmSync(unknown, { force: true });
    fs.rmSync(added, { force: true });
  }
});
