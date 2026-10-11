// Remembered Claude sessions, grouped by the folder they ran in.
/** What grouping needs; remembered sessions and transcript summaries both fit. */
export interface GroupableSession {
  id: string;
  cwd: string | null;
  title: string | null;
  seenAt: number;
}

export interface SessionGroup<T extends GroupableSession = GroupableSession> {
  /** Identity of the folder (case-folded for Windows paths). */
  key: string;
  /** As the newest session reported it; null when unknown. */
  cwd: string | null;
  /** Last path segment, for the header. */
  label: string;
  /** Newest first. */
  sessions: T[];
}

/** Groups newest folder first, each with its sessions newest first; `filter` matches title, folder or id. */
export function groupSessions<T extends GroupableSession>(sessions: T[], filter = ""): SessionGroup<T>[] {
  const needle = filter.trim().toLowerCase();
  const matching = needle
    ? sessions.filter((s) => [s.title, s.cwd, s.id].some((field) => field?.toLowerCase().includes(needle)))
    : sessions;

  const groups = new Map<string, SessionGroup<T>>();
  for (const session of [...matching].sort((a, b) => b.seenAt - a.seenAt)) {
    const key = folderKey(session.cwd);
    const group = groups.get(key);
    if (group) group.sessions.push(session);
    else groups.set(key, { key, cwd: session.cwd, label: folderLabel(session.cwd), sessions: [session] });
  }
  // Map keeps insertion order, and sessions were visited newest first.
  return [...groups.values()];
}

// Windows paths are case-insensitive and may end with a separator; POSIX (WSL) paths are not.
function folderKey(cwd: string | null): string {
  if (cwd === null) return "";
  const windows = /^[A-Za-z]:[\\/]/.test(cwd);
  const trimmed = cwd.length > 3 ? cwd.replace(/[\\/]+$/, "") : cwd;
  return windows ? trimmed.toLowerCase().replace(/\//g, "\\") : trimmed;
}

function folderLabel(cwd: string | null): string {
  if (cwd === null) return "Folder unknown";
  const parts = cwd.split(/[\\/]/).filter(Boolean);
  if (parts.length <= 1) return /^[A-Za-z]:/.test(cwd) ? `${cwd.slice(0, 2)}\\` : cwd;
  return parts[parts.length - 1];
}
