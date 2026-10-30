/** Conservative adapters for terminal compiler output. Unknown output stays unknown. */
import { limitText } from "../text";
import { additionalLine, eslintJson, eslintStylish, pytestSummary } from "./toolDiagnostics";
export interface Diagnostic {
  tool: "typescript" | "rust" | "eslint" | "go" | "pytest" | "dotnet";
  severity: "error" | "warning";
  message: string;
  code?: string;
  file?: string;
  line?: number;
  col?: number;
}
export interface Diagnostics {
  items: Diagnostic[];
  recognized: boolean;
  truncated: boolean;
}
export const MAX_DIAGNOSTICS = 500;
export const MAX_DIAGNOSTIC_OUTPUT = 128_000;
const positive = (n: unknown): number | undefined => typeof n === "number" && Number.isSafeInteger(n) && n > 0 && n <= 2_147_483_647 ? n : undefined;
const position = (file: string, line: string, col?: string) => ({ file, line: positive(Number(line)), col: col ? positive(Number(col)) : undefined });
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

export function parseDiagnostics(output: string, command = ""): Diagnostics {
  const result: Diagnostics = { items: [], recognized: false, truncated: output.length > MAX_DIAGNOSTIC_OUTPUT };
  const seen = new Set<string>();
  const rust = /(?:^|[\s/\\])(?:cargo|rustc)(?:\.exe)?(?:[\s"']|$)/.test(command);
  const add = (item: Diagnostic) => {
    result.recognized = true;
    if (result.items.length >= MAX_DIAGNOSTICS) { result.truncated = true; return; }
    const key = JSON.stringify(item);
    if (!seen.has(key)) { seen.add(key); result.items.push(item); }
  };
  // Xterm supplies plain text; strip escape sequences as well for imported logs.
  const text = limitText(output, MAX_DIAGNOSTIC_OUTPUT).replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "").replace(/\r\n?/g, "\n");
  const lines = text.split("\n");
  let eslintFile: string | undefined;
  // A pretty-printed JSON document, or a one-line formatter document.
  try { const items = eslintJson(JSON.parse(text)); if (items) { result.recognized = true; for (const item of items) add(item); return result; } } catch { /* Terminal output need not be JSON. */ }
  for (let at = 0; at < lines.length; at++) {
    const line = lines[at].trimEnd();
    const additional = additionalLine(line) ?? eslintStylish(line, eslintFile);
    if (additional) { add(additional); continue; }
    // A stylish file heading is followed by position + severity, not arbitrary text.
    if (line.trim() && /^\s+\d+:\d+\s+(?:error|warning)\s/.test(lines[at + 1] ?? "")) eslintFile = line.trim();
    const summary = pytestSummary(line);
    if (summary) {
      // The summary doesn't identify a traceback line. Keep real locations and
      // avoid inventing a test-to-line association for multiple tests in a file.
      if (!result.items.some((d) => d.tool === "pytest" && d.file === summary.file && d.line !== undefined)) add(summary);
      continue;
    }
    if (/^[{[]/.test(line.trimStart())) {
      try {
        let json: unknown = JSON.parse(line);
        const lint = eslintJson(json);
        if (lint) { result.recognized = true; for (const item of lint) add(item); continue; }
        if (object(json) && json.reason === "compiler-message") json = json.message;
        if (object(json) && (json.$message_type === "diagnostic" || (Array.isArray(json.spans) && Array.isArray(json.children))) && (json.level === "error" || json.level === "warning") && typeof json.message === "string") {
          const spans = Array.isArray(json.spans) ? json.spans.filter(object) : [];
          const span = spans.find((s) => s.is_primary === true) ?? spans[0];
          add({ tool: "rust", severity: json.level, message: json.message, code: object(json.code) && typeof json.code.code === "string" ? json.code.code : undefined,
            file: typeof span?.file_name === "string" ? span.file_name : undefined, line: positive(span?.line_start), col: positive(span?.column_start) });
          continue;
        }
      } catch { /* An ordinary JSON log is not a compiler diagnostic. */ }
    }
    // tsc --pretty false, dot-colon pretty output and global TS option errors.
    let match = /^(.*)\((\d+),(\d+)\):\s+(error|warning)\s+(TS\d+):\s*(.*)$/.exec(line);
    if (!match) match = /^(.*):(\d+):(\d+)\s+-\s+(error|warning)\s+(TS\d+):\s*(.*)$/.exec(line);
    if (match) {
      add({ tool: "typescript", ...position(match[1], match[2], match[3]), severity: match[4] as "error" | "warning", code: match[5], message: match[6] }); continue;
    }
    match = /^(error|warning)\s+(TS\d+):\s*(.*)$/.exec(line);
    if (match) { add({ tool: "typescript", severity: match[1] as "error" | "warning", code: match[2], message: match[3] }); continue; }
    // rustc/cargo --message-format short (a Windows drive colon is part of file).
    match = /^(.*):(\d+):(\d+):\s+(error|warning)(?:\[([^\]]+)\])?:\s*(.*)$/.exec(line);
    if (match && (rust || match[1].endsWith(".rs"))) { add({ tool: "rust", ...position(match[1], match[2], match[3]), severity: match[4] as "error" | "warning", code: match[5], message: match[6] }); continue; }
    match = /^(error|warning)(?:\[([^\]]+)\])?:\s*(.*)$/.exec(line);
    if (match) {
      if (!/^(?:aborting due to|could not compile|\d+ warnings? emitted)/.test(match[3])) {
        const arrow = lines.slice(at + 1, at + 4).find((next) => /^\s*-->/.test(next));
        const location = arrow && /^\s*-->\s+(.*):(\d+):(\d+)\s*$/.exec(arrow);
        if (rust || location || /^E\d+$/.test(match[2] ?? "")) add({ tool: "rust", severity: match[1] as "error" | "warning", code: match[2], message: match[3], ...(location ? position(location[1], location[2], location[3]) : {}) });
      }
      continue;
    }
  }
  return result;
}
