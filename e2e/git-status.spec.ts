// Risk R26 (e2e/README.md): a tab in a git repository shows the branch and its changes
// on hover, and a command that changes the repository updates it (shell's folder and
// command marks → Rust runs git → the tab's tooltip).
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { expect, test } from "./qterm";

test("the tab shows the repository's branch and changes, updated after a command", async ({ qterm }) => {
  const marker = Date.now() % 100_000;
  const repo = path.join(fs.realpathSync.native(os.tmpdir()), `qterm-git-${marker}`);
  const branch = `e2e-${marker}`;
  fs.mkdirSync(repo);
  execFileSync("git", ["init", "--quiet", "-b", branch], { cwd: repo });
  try {
    const pane = await qterm.activePane();
    await qterm.waitForPrompt(pane);
    const tab = qterm.page.getByRole("tab").first();

    await qterm.run(pane, `Set-Location '${repo}'`);
    await expect(tab).toHaveAccessibleDescription(new RegExp(`⎇ ${branch} · clean`));

    // Two new files, made in the shell: the tab knows after the command ends.
    await qterm.run(pane, `Set-Content a.txt 1; Set-Content b.txt 2`);
    await expect(tab).toHaveAccessibleDescription(new RegExp(`⎇ ${branch} · 2 new`));
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});
