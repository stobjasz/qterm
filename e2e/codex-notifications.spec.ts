// R50: real hooks from a pane while the actual window is hidden. Native E2E
// notification delivery records attempts, so no synthetic toast reaches Windows.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EXE, IDENTIFIER, expect, test } from "./qterm";

test.use({ settings: { values: { slide_ms: "0" } } });
test("approval checks never pretend a question exists and duplicate completions produce one notification", async ({ qterm }, info) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "qterm-notifications-"));
  const signal = path.join(dir, "fire.json");
  const worker = path.join(dir, "worker.cjs");
  const local = path.join(process.env.LOCALAPPDATA!, IDENTIFIER);
  const log = path.join(local, "notification-attempts.jsonl");
  const quote = (s: string) => `'${s.replaceAll("'", "''")}'`;
  const session = "01a1690c-c7b7-7e80-9864-e6971b91db16";
  fs.writeFileSync(worker, `const fs = require('node:fs'); const {spawnSync} = require('node:child_process');
const signal = ${JSON.stringify(signal)}; let handling = false;
const watcher = fs.watch(${JSON.stringify(dir)}, () => {
  if (handling || !fs.existsSync(signal)) return;
  handling = true;
  const batch = JSON.parse(fs.readFileSync(signal, 'utf8')); fs.unlinkSync(signal);
  for (const event of batch.events) {
    const child = spawnSync(${JSON.stringify(EXE)}, ['--codex-notify'], { input: JSON.stringify(event), env: process.env, windowsHide: true });
    if (child.status !== 0) throw new Error('Hook process failed');
  }
  process.stdout.write('delivered_' + batch.id + '\\n'); handling = false;
  if (batch.exit) watcher.close();
});
process.stdout.write('hook-worker-ready-' + process.pid + '\\n');`);
  try {
    const pane = await qterm.activePane(); await qterm.waitForPrompt(pane);
    await qterm.run(pane, `& ${quote(process.execPath)} ${quote(worker)}`);
    await expect.poll(() => qterm.terminalText(pane)).toMatch(/hook-worker-ready-\d+/);
    await qterm.invoke("hide_window");
    await expect.poll(() => qterm.invoke<boolean>("plugin:window|is_visible", { label: "quake" })).toBe(false);
    fs.writeFileSync(signal, JSON.stringify({ id: 1, events: Array.from({ length: 3 }, () => ({ hook_event_name: "PermissionRequest", session_id: session, cwd: dir, permission_mode: "default", tool_name: "Bash", tool_input: { command: "cargo test --locked", description: "Validate the native changes" } })) }));
    await expect.poll(() => qterm.terminalText(pane)).toContain("delivered_1");
    await expect.poll(() => {
      try { return JSON.parse(fs.readFileSync(path.join(local, "agent-inbox.json"), "utf8")).events.length; } catch { return 0; }
    }).toBe(3);
    const approvals = JSON.parse(fs.readFileSync(path.join(local, "agent-inbox.json"), "utf8")).events;
    expect(approvals.every((e: { kind: string; resolvedAt: number | null }) => e.kind === "approval" && e.resolvedAt !== null)).toBe(true);
    expect(approvals[0].message).toContain("cargo test --locked");
    expect(approvals[0].message).toContain("a question for you has not been confirmed");
    expect(fs.existsSync(log)).toBe(false);
    fs.writeFileSync(signal, JSON.stringify({ id: 2, exit: true, events: [
      { hook_event_name: "PostToolUse", session_id: session },
      ...Array.from({ length: 2 }, () => ({ hook_event_name: "Stop", session_id: session, last_assistant_message: "The check finished successfully." })),
    ] }));
    await expect.poll(() => qterm.terminalText(pane)).toContain("delivered_2");
    await expect.poll(() => fs.existsSync(log)).toBe(true);
    const attempts = fs.readFileSync(log, "utf8").trim().split(/\r?\n/).map((line) => JSON.parse(line));
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({ suppressed: true, kind: "pane", alert: { title: "Codex turn completed", kind: "codex:reply" } });
    await info.attach("suppressed-native-notifications", { body: fs.readFileSync(log), contentType: "application/x-ndjson" });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
