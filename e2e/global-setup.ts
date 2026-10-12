// Builds the app the tests drive: a debug build (UI from the Vite dev server, the
// dev-only test hook on) with its own identifier, in its own target folder so it
// never replaces the build `pnpm tauri dev` uses. Incremental after the first run.
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { IDENTIFIER } from "./qterm";

export default function globalSetup(): void {
  if (process.env.QTERM_E2E_SKIP_BUILD) return;
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  execFileSync("cargo", ["build", "--target-dir", "target/e2e"], {
    cwd: path.join(root, "src-tauri"),
    stdio: "inherit",
    env: { ...process.env, TAURI_CONFIG: JSON.stringify({ identifier: IDENTIFIER }) },
  });
}
