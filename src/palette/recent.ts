// The palette with nothing typed: what you ran lately first, then the rest, without the
// long lists you only want when you go looking (they show once you type).

/** Groups shown only when something is typed. */
export const ON_SEARCH_ONLY = new Set(["New admin tab", "Tab colour", "Theme", "Delete workspace"]);
export const MAX_RECENT = 8;
const STORAGE_KEY = "qterm.palette.recent";

/** Recently run entries (by id) first, in that order; then the rest minus the search-only groups. */
export function emptyQueryOrder<T extends { id: string; group: string }>(items: readonly T[], recent: readonly string[]): T[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  const first = recent.map((id) => byId.get(id)).filter((item): item is T => item !== undefined);
  const shown = new Set(first.map((item) => item.id));
  return [...first, ...items.filter((item) => !shown.has(item.id) && !ON_SEARCH_ONLY.has(item.group))];
}

/** `id` moved to the front, each once, at most MAX_RECENT. */
export function remember(recent: readonly string[], id: string): string[] {
  return [id, ...recent.filter((r) => r !== id)].slice(0, MAX_RECENT);
}

/** Kept in this window's storage: a convenience, fine to lose. */
export function loadRecent(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string").slice(0, MAX_RECENT) : [];
  } catch {
    return [];
  }
}

export function saveRecent(recent: readonly string[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(recent));
  } catch {
    // Storage off: the palette just starts plain next time.
  }
}
