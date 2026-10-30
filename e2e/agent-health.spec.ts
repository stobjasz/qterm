// Risk R41: Settings -> own hook process -> inbox -> watcher -> health snapshot.
// Probes do not contact providers or change hook configuration/trust.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EXE, expect, test } from "./qterm";

test("local delivery tests reach both watchers and real hooks identify their pane", async ({ qterm }) => {
  const pane = await qterm.activePane();
  await qterm.waitForPrompt(pane);
  const settings = qterm.page.getByRole("dialog", { name: "Settings", exact: true });
  await qterm.page.getByRole("button", { name: "Settings", exact: true }).click();
  const search = settings.getByRole("searchbox", { name: "Search settings", exact: true });
  for (const provider of ["Claude", "Codex"]) {
    await search.fill(provider);
    const health = settings.getByRole("region", { name: `${provider} integration health`, exact: true });
    await expect(health).toContainText("No provider event received");
    await health.getByRole("button", { name: `Test ${provider} local delivery`, exact: true }).click();
    await expect(health.getByRole("status", { name: `${provider} local delivery result`, exact: true })).toContainText("Local delivery passed");
    await expect(health).toContainText("No provider event received");
  }
  await settings.getByRole("button", { name: "Cancel", exact: true }).click();
  const input = path.join(fs.realpathSync.native(os.tmpdir()), `qterm-health-event-${Date.now()}.json`);
  fs.writeFileSync(input, JSON.stringify({ hook_event_name: "SessionStart", session_id: "01a1690c-c7b7-7e80-9864-e6971b91db16" }));
  try {
    const quote = (s: string) => `'${s.replaceAll("'", "''")}'`;
    await qterm.run(pane, `Get-Content ${quote(input)} -Raw | & ${quote(EXE)} --codex-notify`);
    await qterm.page.getByRole("button", { name: "Settings", exact: true }).click();
    await search.fill("Codex");
    const event = settings.getByLabel("Codex last hook event", { exact: true });
    await expect(event).toContainText("session-start");
    await expect(event).toContainText("1 ·");
    await expect(event).toContainText("01a1690c-c7b7-7e80-9864-e6971b91db16");
    await expect(event).not.toContainText("no longer open");
  } finally { fs.rmSync(input, { force: true }); }
});
