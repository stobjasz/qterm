import type { Diagnostic } from "./diagnostics";

const positive = (n: unknown): number | undefined => typeof n === "number" && Number.isSafeInteger(n) && n > 0 && n <= 2_147_483_647 ? n : undefined;
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** Documented ESLint result objects, including json-with-metadata's results. */
export function eslintJson(value: unknown): Diagnostic[] | undefined {
  const results = object(value) && Array.isArray(value.results) ? value.results : value;
  if (!Array.isArray(results)) return;
  const diagnostics: Diagnostic[] = [];
  let recognized = false;
  for (const result of results) {
    if (!object(result) || typeof result.filePath !== "string" || !Array.isArray(result.messages)) continue;
    recognized = true;
    for (const message of result.messages) {
      if (!object(message) || typeof message.message !== "string" || (message.severity !== 1 && message.severity !== 2)) continue;
      diagnostics.push({ tool: "eslint", severity: message.severity === 2 ? "error" : "warning", message: message.message,
        file: result.filePath, line: positive(message.line), col: positive(message.column), code: typeof message.ruleId === "string" ? message.ruleId : undefined });
    }
  }
  return recognized ? diagnostics : undefined;
}

/** Formats with a source location on the same line. No guessed stack locations. */
export function additionalLine(line: string): Diagnostic | undefined {
  let match = /^(.*?)\((\d+)(?:,(\d+))?\):\s+(error|warning)\s+((?:CS|BC|FS|MSB|NETSDK|NU)\d+):\s*(.*)$/.exec(line);
  if (match) return { tool: "dotnet", file: match[1], line: positive(Number(match[2])), col: match[3] ? positive(Number(match[3])) : undefined, severity: match[4] as "error" | "warning", code: match[5], message: match[6] };
  match = /^(?:(.*?)\s+:\s+)?(error|warning)\s+((?:CS|BC|FS|MSB|NETSDK|NU)\d+):\s*(.*)$/.exec(line);
  if (match) return { tool: "dotnet", file: match[1], severity: match[2] as "error" | "warning", code: match[3], message: match[4] };
  match = /^(.*\.go):(\d+)(?::(\d+))?:\s+(.+)$/.exec(line);
  if (match) return { tool: "go", severity: "error", file: match[1], line: positive(Number(match[2])), col: match[3] ? positive(Number(match[3])) : undefined, message: match[4] };
  match = /^(.*\.py):(\d+):\s+((?:[\w.]*Error|[\w.]*Exception|Failed|AssertionError)(?::.*)?)$/.exec(line);
  if (match) return { tool: "pytest", severity: "error", file: match[1], line: positive(Number(match[2])), message: match[3] };
  return undefined;
}

/** Pytest summaries supply a test identity even when traceback output is disabled. */
export function pytestSummary(line: string): Diagnostic | undefined {
  const match = /^(?:FAILED|ERROR)\s+(.+?\.py)(::.*?)?(?:\s+-\s+(.*))?$/.exec(line);
  if (match) return { tool: "pytest", severity: "error", file: match[1], code: match[2]?.slice(2), message: match[3] ?? "Test failed; see captured output" };
}

export function eslintStylish(line: string, file: string | undefined): Diagnostic | undefined {
  if (!file) return;
  const match = /^\s+(\d+):(\d+)\s+(error|warning)\s+(.+?)(?:\s{2,}([\w@/.-]+))?\s*$/.exec(line);
  if (match) return { tool: "eslint", file, line: positive(Number(match[1])), col: positive(Number(match[2])), severity: match[3] as "error" | "warning", message: match[4], code: match[5] };
}
