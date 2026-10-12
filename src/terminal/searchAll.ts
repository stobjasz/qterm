// Search across every pane's output: plain line-by-line matching, shared by the
// search itself and by revealing a match once its pane is on screen.

export interface SearchOptions {
  caseSensitive: boolean;
  regex: boolean;
}

export interface LineMatch {
  line: number;
  col: number;
  length: number;
}

/** One match, in a pane. */
export interface SearchHit extends LineMatch {
  paneId: string;
  /** Which match in that pane, counting from the top. */
  index: number;
  text: string;
}

/** Results shown at most; the search stops there. */
export const SEARCH_ALL_LIMIT = 300;

/** Every match in `lines`, in order; an invalid regex finds nothing. */
export function findInLines(lines: readonly string[], query: string, options: SearchOptions): LineMatch[] {
  if (!query) return [];
  let pattern: RegExp;
  try {
    const source = options.regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    pattern = new RegExp(source, options.caseSensitive ? "g" : "gi");
  } catch {
    return [];
  }
  const found: LineMatch[] = [];
  lines.forEach((text, line) => {
    pattern.lastIndex = 0;
    for (let m = pattern.exec(text); m; m = pattern.exec(text)) {
      if (m[0].length === 0) {
        pattern.lastIndex++; // e.g. /x*/ matches nothing everywhere
        continue;
      }
      found.push({ line, col: m.index, length: m[0].length });
    }
  });
  return found;
}

/** A line shortened around its match, for the results list. */
export function excerpt(text: string, match: LineMatch, width = 110): { before: string; hit: string; after: string } {
  const room = Math.max(0, width - match.length);
  const start = Math.max(0, match.col - Math.floor(room / 3));
  const end = Math.min(text.length, match.col + match.length + room - (match.col - start));
  return {
    before: (start > 0 ? "…" : "") + text.slice(start, match.col).trimStart(),
    hit: text.slice(match.col, match.col + match.length),
    after: text.slice(match.col + match.length, end).trimEnd() + (end < text.length ? "…" : ""),
  };
}
