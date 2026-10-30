import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

export const quote = (s: string) => `'${s.replaceAll("'", "''")}'`;
export function verificationProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "qterm-verification-"));
  const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=qterm-test", "-c", "user.email=qterm-test@example.invalid", "-c", "commit.gpgSign=false", ...args], { cwd: dir, stdio: "pipe", env: { ...process.env, GIT_CONFIG_GLOBAL: "NUL", GIT_CONFIG_NOSYSTEM: "1" } });
  fs.writeFileSync(path.join(dir, ".gitignore"), "target/\n");
  fs.writeFileSync(path.join(dir, "value.cjs"), "module.exports = 42;\n");
  fs.writeFileSync(path.join(dir, "check.cjs"), "const value = require('./value.cjs'); if (value !== 42) process.exit(1); process.stdout.write('checked-' + (value * 2) + '\\n');\n");
  git("init", "--quiet"); git("add", "."); git("commit", "--quiet", "-m", "base");
  const command = `& ${quote(process.execPath)} check.cjs`;
  return { dir, command, cleanup: () => {
    const target = fs.realpathSync.native(dir), temp = fs.realpathSync.native(os.tmpdir());
    if (path.dirname(target).toLowerCase() !== temp.toLowerCase() || !path.basename(target).startsWith("qterm-verification-")) throw new Error("Refusing to clean an unexpected verification fixture path");
    fs.rmSync(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  } };
}
