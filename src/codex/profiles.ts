import type { Profile } from "../ipc";

/** Native and WSL Codex installations keep separate sessions and folders. */
export function sessionProfile(profiles: Profile[] | undefined, preferred: Profile | undefined, cwd: string | null, recorded?: string): Profile | undefined {
  const windows = !cwd || /^[A-Za-z]:[\\/]/.test(cwd) || cwd.startsWith("\\\\");
  const compatible = (p: Profile) => p.kind !== "other" && (p.kind === "wsl") !== windows;
  return profiles?.find((p) => p.id === recorded && compatible(p))
    ?? (preferred && compatible(preferred) ? preferred : profiles?.find(compatible));
}
