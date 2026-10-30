import type { CommandRun } from "../problems/runs";

function nativePath(path: string): string {
  const slashes = path.replace(/\\/g, "/");
  const msys = /^\/([A-Za-z])\/(.*)$/.exec(slashes);
  return (msys ? `${msys[1]}:/${msys[2]}` : slashes).replace(/^[A-Z]:/, (drive) => drive.toLowerCase()).replace(/\/+$/, "");
}
/** Folder-associated history; missing or differently spelled aliases stay unassociated. */
export function worktreeRuns(directory: string, createdAt: number, runs: readonly CommandRun[]): CommandRun[] {
  const root = nativePath(directory);
  return runs.filter((r) => {
    if (!r.cwd || r.shellKind === "wsl" || r.startedAt < createdAt) return false;
    const cwd = nativePath(r.cwd);
    return cwd === root || cwd.startsWith(root + "/");
  });
}
