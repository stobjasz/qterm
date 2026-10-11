// Fuzzy matching for the command palette: every query letter must appear in
// order; word starts and runs of consecutive letters score higher.

export interface Match {
  score: number;
  /** Positions in the text that matched, for highlighting. */
  indices: number[];
}

const WORD_START_BONUS = 8;
const CONSECUTIVE_BONUS = 5;
const FIRST_LETTER_BONUS = 4;
const GAP_PENALTY = 0.2;

export function fuzzyMatch(query: string, text: string): Match | undefined {
  const q = query.toLowerCase().replace(/\s+/g, "");
  if (!q) return { score: 0, indices: [] };
  const t = text.toLowerCase();
  const indices: number[] = [];
  let score = 0;
  let from = 0;
  for (const ch of q) {
    // Prefer the next occurrence at a word start (typing initials), else the next one.
    let at = t.indexOf(ch, from);
    for (let i = at; i >= 0; i = t.indexOf(ch, i + 1)) {
      if (isWordStart(text, i)) {
        at = i;
        break;
      }
    }
    if (at < 0) return undefined;
    const previous = indices[indices.length - 1];
    score += 1;
    if (isWordStart(text, at)) score += WORD_START_BONUS;
    if (previous !== undefined && at === previous + 1) score += CONSECUTIVE_BONUS;
    if (at === 0) score += FIRST_LETTER_BONUS;
    if (previous !== undefined) score -= (at - previous - 1) * GAP_PENALTY;
    indices.push(at);
    from = at + 1;
  }
  return { score, indices };
}

/** Matching items, best first; with an empty query, all items in their order. */
export function rank<T>(items: T[], text: (item: T) => string, query: string): T[] {
  if (!query.trim()) return items;
  return items
    .map((item, order) => ({ item, order, match: fuzzyMatch(query, text(item)) }))
    .filter((x): x is { item: T; order: number; match: Match } => x.match !== undefined)
    .sort((a, b) => b.match.score - a.match.score || a.order - b.order)
    .map((x) => x.item);
}

function isWordStart(text: string, i: number): boolean {
  return i === 0 || /[\s\-_:./\\(]/.test(text[i - 1]) || (/[a-z]/.test(text[i - 1]) && /[A-Z]/.test(text[i]));
}
