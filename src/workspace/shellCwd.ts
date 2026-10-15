// A folder as one shell reported it, as another kind of shell can start in it: a split
// with another shell, or a pane switched to another shell, opens where you were.
import type { ShellKind } from "../ipc";
import { shellPath } from "../terminal/drop";

export interface ShellRef {
  id: string;
  kind: ShellKind;
}

/**
 * Where `to` starts for a pane of `from` that is in `cwd`. Undefined: its home folder;
 * `lost` says there was a folder `to` can't start in (cmd in a WSL folder, say).
 */
export function startFolder(cwd: string | undefined, from: ShellRef | undefined, to: ShellRef): { cwd?: string; lost: boolean } {
  if (!cwd) return { lost: false };
  // The same shell takes its own folders as they are (Rust translates Git Bash's).
  if (from?.id === to.id) return { cwd, lost: false };
  const place = locate(cwd, from);
  const found = place && folderFor(place, to);
  return found ? { cwd: found, lost: false } : { lost: true };
}

/** A Windows folder, or a folder inside a WSL distro. */
type Place = { windows: string } | { distro: string; linux: string };

function locate(cwd: string, from: ShellRef | undefined): Place | undefined {
  // Git Bash reports /c/work for C:\work.
  const msys = /^\/([A-Za-z])(\/.*)?$/.exec(cwd);
  if (from?.kind === "bash" && msys) return { windows: `${msys[1].toUpperCase()}:${(msys[2] ?? "/").replace(/\//g, "\\")}` };
  // A distro's files as Windows sees them.
  const unc = /^\\\\wsl(?:\$|\.localhost)\\([^\\]+)(\\.*)?$/i.exec(cwd);
  if (unc) return { distro: unc[1], linux: (unc[2] ?? "\\").replace(/\\/g, "/") };
  if (/^[A-Za-z]:[\\/]/.test(cwd) || cwd.startsWith("\\\\")) return { windows: cwd };
  if (cwd.startsWith("/") && from?.kind === "wsl") {
    const distro = distroOf(from.id);
    if (!distro) return undefined;
    // /mnt/c/work is C:\work, whichever distro.
    const drive = /^\/mnt\/([a-z])(\/.*)?$/i.exec(cwd);
    if (drive) return { windows: `${drive[1].toUpperCase()}:${(drive[2] ?? "/").replace(/\//g, "\\")}` };
    return { distro, linux: cwd };
  }
  return undefined;
}

function folderFor(place: Place, to: ShellRef): string | undefined {
  if (to.kind === "wsl") {
    if ("windows" in place) return place.windows.startsWith("\\\\") ? undefined : shellPath(place.windows, "wsl");
    // Another distro's files aren't reachable by path from this one.
    return place.distro.toLowerCase() === distroOf(to.id)?.toLowerCase() ? place.linux : undefined;
  }
  if ("windows" in place) return place.windows;
  // cmd can't start in a network folder (\\wsl.localhost\... is one).
  if (to.kind === "cmd") return undefined;
  return `\\\\wsl.localhost\\${place.distro}${place.linux.replace(/\//g, "\\")}`;
}

/** "wsl:Ubuntu" → "Ubuntu"; other ids (a custom profile running wsl.exe) don't say. */
function distroOf(profileId: string): string | undefined {
  return profileId.startsWith("wsl:") ? profileId.slice(4) : undefined;
}
