// JSON in terminal output, for the JSON viewer: the whole text, JSON Lines, or the
// first object or array inside it (after a log prefix, say).

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/** Starts of embedded JSON tried before giving up. */
const MAX_STARTS = 50;

/** The JSON value the text holds, if any. Lone numbers and strings don't count. */
export function findJson(text: string): Json | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  const whole = parse(trimmed);
  if (whole !== undefined && typeof whole === "object" && whole !== null) return whole;

  // JSON Lines: an object or array on every line.
  const lines = trimmed.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length > 1) {
    const values = lines.map((line) => parse(line.trim()));
    if (values.every((v) => v !== undefined && typeof v === "object" && v !== null)) return values as Json[];
  }

  let tried = 0;
  for (let start = 0; start < trimmed.length && tried < MAX_STARTS; start++) {
    const ch = trimmed[start];
    if (ch !== "{" && ch !== "[") continue;
    tried++;
    const end = matchingEnd(trimmed, start);
    if (end === undefined) continue;
    const value = parse(trimmed.slice(start, end + 1));
    if (value !== undefined) return value;
  }
  return undefined;
}

function parse(text: string): Json | undefined {
  try {
    return JSON.parse(text) as Json;
  } catch {
    return undefined;
  }
}

/** Where the bracket opened at `start` closes, skipping strings; undefined if it doesn't. */
function matchingEnd(text: string, start: number): number | undefined {
  const stack: string[] = [];
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{" || ch === "[") stack.push(ch === "{" ? "}" : "]");
    else if (ch === "}" || ch === "]") {
      if (stack.pop() !== ch) return undefined;
      if (stack.length === 0) return i;
    }
  }
  return undefined;
}

/** "$.items[2].name": how to reach a value, for its tooltip. */
export function jsonPath(path: (string | number)[]): string {
  return path.reduce<string>(
    (out, key) => (typeof key === "number" ? `${out}[${key}]` : /^[A-Za-z_$][\w$]*$/.test(key) ? `${out}.${key}` : `${out}[${JSON.stringify(key)}]`),
    "$",
  );
}

/** What copying a value puts on the clipboard: a string as it is, anything else as JSON. */
export function copyText(value: Json): string {
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

/** A one-line preview of a value, at most `max` characters. */
export function preview(value: Json, max = 80): string {
  const text = Array.isArray(value)
    ? `[${value.length} item${value.length === 1 ? "" : "s"}]`
    : value !== null && typeof value === "object"
      ? `{${Object.keys(value).length} key${Object.keys(value).length === 1 ? "" : "s"}}`
      : JSON.stringify(value);
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
