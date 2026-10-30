// A folder as one shell reported it, as another kind of shell can start in it: a split
// with another shell, or a pane switched to another shell, opens where you were.
import type { ShellKind } from "../ipc";

export interface ShellRef {
  id: string;
  kind: ShellKind;
  distribution?: string | null;
  environment?: string;
}

/**
 * Where `to` starts for a pane of `from` that is in `cwd`. Undefined: its home folder;
 * `lost` says there was a folder `to` can't start in (cmd in a WSL folder, say).
 */
export function startFolder(cwd: string | undefined, from: ShellRef | undefined, to: ShellRef): { cwd?: string; lost: boolean } {
  if (!cwd) return { lost: false };
  // The same shell takes its own folders as they are (Rust translates Git Bash's).
  if (from?.id === to.id && distroOf(from)?.toLowerCase()===distroOf(to)?.toLowerCase()) return { cwd, lost: false };
  const place = locate(cwd, from);
  const found = place && folderFor(place, to);
  return found ? { cwd: found, lost: false } : { lost: true };
}

/** A Windows folder, or a folder inside a WSL distro. */
type Place = { windows: string } | { distro: string; linux: string };

function locate(cwd: string, from: ShellRef | undefined): Place | undefined {
  // Git Bash reports /c/work for C:\work.
  const msys = /^\/([A-Za-z])(\/.*)?$/.exec(cwd);
  if (from?.kind === "bash" && !distroOf(from) && msys) return { windows: `${msys[1].toUpperCase()}:${(msys[2] ?? "/").replace(/\//g, "\\")}` };
  // A distro's files as Windows sees them.
  const unc = /^\\\\wsl(?:\$|\.localhost)\\([^\\]+)(\\.*)?$/i.exec(cwd);
  if (unc) return { distro: unc[1], linux: (unc[2] ?? "\\").replace(/\\/g, "/") };
  if (/^[A-Za-z]:[\\/]/.test(cwd) || cwd.startsWith("\\\\")) return { windows: cwd };
  if (cwd.startsWith("/") && from && (from.kind === "wsl" || distroOf(from))) {
    const distro = distroOf(from);
    if (!distro) return undefined;
    return { distro, linux: cwd };
  }
  return undefined;
}

function folderFor(place: Place, to: ShellRef): string | undefined {
  if (to.kind === "wsl") {
    // Cross-boundary paths need the selected distro's real mount table.
    if ("windows" in place) return undefined;
    // Another distro's files aren't reachable by path from this one.
    return place.distro.toLowerCase() === distroOf(to)?.toLowerCase() ? place.linux : undefined;
  }
  if ("windows" in place) return place.windows;
  // cmd can't start in a network folder (\\wsl.localhost\... is one).
  if (to.kind === "cmd") return undefined;
  return `\\\\wsl.localhost\\${place.distro}${place.linux.replace(/\//g, "\\")}`;
}

/** Captured pane identity takes precedence over an edited profile's metadata. */
function distroOf(profile: ShellRef): string | undefined {
  if(profile.environment!==undefined)return profile.environment.startsWith("wsl:")?profile.environment.slice(4):undefined;
  return profile.distribution??(profile.id.startsWith("wsl:")?profile.id.slice(4):undefined);
}

export type TranslatePaths=(distribution:string,paths:string[],toLinux:boolean)=>Promise<string[]>;
/** Resolve mount-dependent transfers asynchronously; no guessed /mnt drive roots. */
export async function transferFolder(cwd:string|undefined,from:ShellRef|undefined,to:ShellRef,translate:TranslatePaths):Promise<{cwd?:string;lost:boolean}>{
  if(!cwd)return{lost:false};
  const place=locate(cwd,from);const target=distroOf(to);
  if(place&&"distro" in place){
    if(target?.toLowerCase()===place.distro.toLowerCase())return{cwd:place.linux,lost:false};
    const [windows]=await translate(place.distro,[place.linux],false);
    if(!windows)throw Error("WSL returned no folder translation");
    if(target){
      if(/^\\\\wsl(?:\$|\.localhost)\\/i.test(windows))return{lost:true};
      const [linux]=await translate(target,[windows],true);if(!linux)throw Error("WSL returned no folder translation");return{cwd:linux,lost:false};
    }
    return to.kind==="cmd"&&windows.startsWith("\\\\")?{lost:true}:{cwd:windows,lost:false};
  }
  if(place&&"windows" in place&&target){const [linux]=await translate(target,[place.windows],true);if(!linux)throw Error("WSL returned no folder translation");return{cwd:linux,lost:false};}
  return startFolder(cwd,from,to);
}
