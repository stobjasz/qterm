// Fuzzy matching for the command palette: every query letter must appear in
// order; word starts and runs of consecutive letters score higher. The best
// alignment is found by dynamic programming, so a greedy early choice can never
// hide a match (e.g. "layout test" in "Layout: test-layout").

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
  const n = t.length;

  // best[i][p]: best score with q[0..=i] matched and q[i] at text position p.
  const best: Float64Array[] = [];
  const from: Int32Array[] = [];
  for (let i = 0; i < q.length; i++) {
    const row = new Float64Array(n).fill(-Infinity);
    const back = new Int32Array(n).fill(-1);
    for (let p = i; p < n; p++) {
      if (t[p] !== q[i]) continue;
      const base = 1 + (isWordStart(text, p) ? WORD_START_BONUS : 0) + (p === 0 ? FIRST_LETTER_BONUS : 0);
      if (i === 0) {
        row[p] = base;
        continue;
      }
      const previous = best[i - 1];
      for (let k = i - 1; k < p; k++) {
        if (previous[k] === -Infinity) continue;
        const link = k === p - 1 ? CONSECUTIVE_BONUS : -(p - k - 1) * GAP_PENALTY;
        const score = previous[k] + base + link;
        if (score > row[p]) {
          row[p] = score;
          back[p] = k;
        }
      }
    }
    best.push(row);
    from.push(back);
  }

  const last = best[q.length - 1];
  let end = -1;
  for (let p = 0; p < n; p++) if (last[p] > (end < 0 ? -Infinity : last[end])) end = p;
  if (end < 0 || last[end] === -Infinity) return undefined;

  const indices: number[] = [];
  for (let i = q.length - 1, p = end; i >= 0; p = from[i][p], i--) indices.unshift(p);
  return { score: last[end], indices };
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
