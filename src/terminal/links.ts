// File references in terminal output: "src/app.ts:42:7", "C:\x\main.rs:10",
// "src/index.tsx(12,9)". Candidates only; the registry asks Rust which exist.

export interface FileLink {
  /** Offsets in the line text, end exclusive. */
  start: number;
  end: number;
  path: string;
  line?: number;
  col?: number;
}

const FILE = String.raw`(?:[A-Za-z]:[\\/]|\.{1,2}[\\/])?(?:[\w.@+-]+[\\/])*[\w@+-][\w.@+-]*\.[A-Za-z][A-Za-z0-9]{0,7}`;
const POSITION = String.raw`(?::(\d+)(?::(\d+))?|\((\d+)(?:,\s?(\d+))?\))?`;
const PATTERN = new RegExp(`(${FILE})${POSITION}`, "g");

export function findFileLinks(text: string): FileLink[] {
  const links: FileLink[] = [];
  for (const match of text.matchAll(PATTERN)) {
    const start = match.index;
    // Part of a URL ("https://host/a.js") or of a longer word: not ours.
    if (start > 0 && /[\w/:\\.]/.test(text[start - 1])) continue;
    const [whole, path, line, col, parenLine, parenCol] = match;
    links.push({
      start,
      end: start + whole.length,
      path,
      line: toNumber(line ?? parenLine),
      col: toNumber(col ?? parenCol),
    });
  }
  return links;
}

function toNumber(value: string | undefined): number | undefined {
  return value === undefined ? undefined : Number(value);
}
