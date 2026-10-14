// Quick select (Alt+Shift+S): every URL, file, folder, git hash and IP address on
// screen gets a short label; typing it copies that text, Shift+label opens it.

import { findFileLinks } from "./links";

export type TargetKind = "url" | "file" | "folder" | "hash" | "ip";

export interface Target {
  kind: TargetKind;
  text: string;
  /** Offsets in the line text, end exclusive. */
  start: number;
  end: number;
  /** For files: the position after the path ("src/app.ts:42:7"). */
  line?: number;
  col?: number;
}

const URL = /\bhttps?:\/\/[^\s<>"'`]+/g;
const FOLDER = /\b[A-Za-z]:\\[^\s:*?"<>|]*/g;
const HASH = /\b[0-9a-f]{7,40}\b/g;
const IP = /\b(?:\d{1,3}\.){3}\d{1,3}(?::\d{1,5})?\b/g;

/**
 * Sentence punctuation after a URL or path isn't part of it, but a ")" closing a
 * "(" inside it is: "(see https://x.org/wiki/A_(b))." → "https://x.org/wiki/A_(b)".
 */
function trimEnd(text: string): string {
  let end = text.length;
  while (end > 0 && /[.,;:!?'"\])}]/.test(text[end - 1])) {
    if (text[end - 1] === ")") {
      const head = text.slice(0, end);
      if ((head.match(/\(/g)?.length ?? 0) >= (head.match(/\)/g)?.length ?? 0)) break;
    }
    end--;
  }
  return text.slice(0, end);
}

function matches(text: string, pattern: RegExp, kind: TargetKind, trim: boolean): Target[] {
  return [...text.matchAll(pattern)].flatMap((m) => {
    const value = trim ? trimEnd(m[0]) : m[0];
    return value ? [{ kind, text: value, start: m.index, end: m.index + value.length }] : [];
  });
}

/** What can be picked in one line of text; overlaps go to the earliest, then longest. */
export function findTargets(text: string): Target[] {
  const all: Target[] = [
    ...matches(text, URL, "url", true),
    ...findFileLinks(text).map((f): Target => ({ kind: "file", text: f.path, start: f.start, end: f.end, line: f.line, col: f.col })),
    ...matches(text, FOLDER, "folder", true).filter((t) => t.text.length > 3),
    // A hash has digits and letters: plain words ("deadbeef") and numbers aren't hashes.
    ...matches(text, HASH, "hash", false).filter((t) => /\d/.test(t.text) && /[a-f]/.test(t.text)),
    ...matches(text, IP, "ip", false),
  ];
  all.sort((a, b) => a.start - b.start || b.end - a.end);
  const kept: Target[] = [];
  for (const target of all) {
    if (kept.some((k) => target.start < k.end && k.start < target.end)) continue;
    kept.push(target);
  }
  return kept;
}

/** Home-row letters first. */
const ALPHABET = "asdfjklghqwertyuiopzxcvbnm";

/** `count` labels, none a prefix of another: single letters while they last, else pairs. */
export function labelsFor(count: number): string[] {
  if (count <= ALPHABET.length) return [...ALPHABET.slice(0, count)];
  const pairs: string[] = [];
  for (const a of ALPHABET) for (const b of ALPHABET) pairs.push(a + b);
  return pairs.slice(0, count);
}
