// Builds the app the tests drive: a debug build (UI from the Vite dev server, the
// dev-only test hook on) with its own identifier, in its own target folder so it
// never replaces the build `pnpm tauri dev` uses. Incremental after the first run.
//
// The WebView2 debugging port is part of the build's own browser arguments, not only
// the WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS variable the launcher also sets: on CI
// runners the variable alone didn't open it.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CDP_PORT, IDENTIFIER } from "./qterm";

export default function globalSetup(): void {
  if (process.env.QTERM_E2E_SKIP_BUILD) return;
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const conf = JSON.parse(fs.readFileSync(path.join(root, "src-tauri", "tauri.conf.json"), "utf8"));
  // TAURI_CONFIG is merged as a JSON merge patch, which replaces arrays: give the
  // whole window list, with the port added to each window's arguments.
  const windows = conf.app.windows.map((w: { additionalBrowserArgs?: string }) => ({
    ...w,
    additionalBrowserArgs: `${w.additionalBrowserArgs ?? ""} --remote-debugging-port=${CDP_PORT}`.trim(),
  }));
  execFileSync("cargo", ["build", "--target-dir", "target/e2e"], {
    cwd: path.join(root, "src-tauri"),
    stdio: "inherit",
    env: { ...process.env, TAURI_CONFIG: JSON.stringify({ identifier: IDENTIFIER, app: { windows } }) },
  });
}
