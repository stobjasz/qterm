// Risk R12 (e2e/README.md): the first start after an update shows "What's new" for
// the new version, once (last-version file → Rust → UI; the next start stays quiet).
// The notes themselves come from GitHub and aren't part of the check.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "./qterm";

const conf = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src-tauri", "tauri.conf.json"), "utf8"));
const version: string = conf.version;

// The version that ran before: older than this build.
test.use({ settings: { files: { "last-version": "0.1.0" } } });

test("the first start after an update shows what's new in that version, once", async ({ qterm }) => {
  const panel = qterm.page.getByRole("dialog", { name: "What's new" });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("heading", { name: `What's new in qterm ${version}` })).toBeVisible();
  await expect(panel.getByText("Updated from 0.1.0.")).toBeVisible();
  await panel.getByRole("button", { name: "Close", exact: true }).click();
  await expect(panel).toBeHidden();

  // The next start is no update: nothing to show.
  await qterm.restart();
  await qterm.waitForPrompt(await qterm.activePane());
  await expect(qterm.page.getByRole("dialog", { name: "What's new" })).toHaveCount(0);
});
