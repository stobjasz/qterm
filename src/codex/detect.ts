const RESUME = /\bcodex\s+(?:--no-daemon\s+)?resume\s+([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})(?![0-9a-z-])/gi;

export function findCodexResumeIds(text: string): string[] {
  return [...new Set([...text.matchAll(RESUME)].map((m) => m[1].toLowerCase()))];
}
