// Spots Claude Code session ids in terminal text, e.g. its exit hint
// "claude --resume 4c766d1a-f139-42df-90f0-a04fe20d3056".

const RESUME = /\bclaude\s+(?:--resume|-r)\s+([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?![0-9a-z-])/gi;

/** Session ids (lower case) in order of first appearance. */
export function findResumeIds(text: string): string[] {
  const ids = [...text.matchAll(RESUME)].map((match) => match[1].toLowerCase());
  return [...new Set(ids)];
}
