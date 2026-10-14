// Named workspaces: every open tab saved under a name (workspaces.json next to the
// settings) and opened again later next to the tabs already there. Each entry holds
// the same text the session file does (saveWorkspace / restoreWorkspace).

export interface NamedWorkspace {
  name: string;
  /** Date.now() of the last save. */
  savedAt: number;
  /** saveWorkspace() output. */
  session: string;
}

export const MAX_NAME = 60;

/** The name as stored: trimmed, single-spaced, at most MAX_NAME characters; "" if blank. */
export function cleanName(name: string): string {
  return name.trim().replace(/\s+/g, " ").slice(0, MAX_NAME);
}

/** Saves under `name`, replacing a workspace of the same name (ignoring case); sorted by name. */
export function upsertNamed(list: readonly NamedWorkspace[], name: string, session: string, at: number): NamedWorkspace[] {
  const clean = cleanName(name);
  if (!clean) return [...list];
  const others = list.filter((w) => w.name.toLowerCase() !== clean.toLowerCase());
  return [...others, { name: clean, savedAt: at, session }].sort((a, b) => a.name.localeCompare(b.name));
}

export function removeNamed(list: readonly NamedWorkspace[], name: string): NamedWorkspace[] {
  return list.filter((w) => w.name !== name);
}

/** Reads workspaces.json; malformed entries are dropped. */
export function parseNamed(text: string | null): NamedWorkspace[] {
  if (!text) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return [];
  }
  const list = (raw as { workspaces?: unknown })?.workspaces;
  if (!Array.isArray(list)) return [];
  return list.filter(
    (w): w is NamedWorkspace => typeof w?.name === "string" && cleanName(w.name) !== "" && typeof w?.savedAt === "number" && typeof w?.session === "string",
  );
}

export function serializeNamed(list: readonly NamedWorkspace[]): string {
  return JSON.stringify({ version: 1, workspaces: list });
}
