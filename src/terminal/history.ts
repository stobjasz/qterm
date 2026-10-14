// Recent commands and folders across every pane, from shell integration: offered in
// the palette (type a command again, open a tab in a folder). Newest first, each
// once; kept with qterm's settings (history.json) across restarts.

export interface RecentCommand {
  command: string;
  /** The folder it ran in, when the shell reported one. */
  cwd?: string;
  exitCode?: number;
  /** Date.now() when it finished. */
  at: number;
}

export interface History {
  commands: RecentCommand[];
  folders: string[];
}

export const MAX_COMMANDS = 100;
export const MAX_FOLDERS = 30;
/** Longer command lines are pastes, not commands worth offering again. */
const MAX_COMMAND_LENGTH = 1000;

export const emptyHistory = (): History => ({ commands: [], folders: [] });

export function rememberCommand(history: History, entry: RecentCommand): History {
  const command = entry.command.trim();
  if (!command || command.length > MAX_COMMAND_LENGTH) return history;
  const commands = [{ ...entry, command }, ...history.commands.filter((c) => c.command !== command)].slice(0, MAX_COMMANDS);
  return { ...history, commands };
}

/** Windows folders differ only in case or a trailing backslash are the same folder. */
const folderKey = (dir: string) => dir.replace(/[\\/]+$/, "").toLowerCase();

export function rememberFolder(history: History, dir: string): History {
  const trimmed = dir.trim();
  if (!trimmed) return history;
  if (history.folders[0] !== undefined && folderKey(history.folders[0]) === folderKey(trimmed)) return history;
  const folders = [trimmed, ...history.folders.filter((f) => folderKey(f) !== folderKey(trimmed))].slice(0, MAX_FOLDERS);
  return { ...history, folders };
}

/** Reads history.json; anything malformed is dropped rather than trusted. */
export function parseHistory(text: string | null): History {
  if (!text) return emptyHistory();
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return emptyHistory();
  }
  const r = raw as { commands?: unknown; folders?: unknown };
  const commands = (Array.isArray(r?.commands) ? r.commands : [])
    .filter((c): c is RecentCommand => typeof c?.command === "string" && typeof c?.at === "number")
    .map((c) => ({
      command: c.command,
      at: c.at,
      ...(typeof c.cwd === "string" ? { cwd: c.cwd } : {}),
      ...(typeof c.exitCode === "number" ? { exitCode: c.exitCode } : {}),
    }))
    .slice(0, MAX_COMMANDS);
  const folders = (Array.isArray(r?.folders) ? r.folders : []).filter((f): f is string => typeof f === "string").slice(0, MAX_FOLDERS);
  return { commands, folders };
}
