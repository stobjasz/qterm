import { describe, expect, it } from "vitest";
import { parseDiagnostics, MAX_DIAGNOSTICS, MAX_DIAGNOSTIC_OUTPUT } from "./diagnostics";
import { addRun, commandRun, latestRuns, restoreRun } from "./runs";

describe("compiler diagnostic adapters", () => {
  it("keeps Windows paths with spaces and original compiler positions", () => {
    const parsed = parseDiagnostics("C:\\work tree\\src\\a.ts(12,9): error TS2322: Type 'string' is not assignable to type 'number'.\n\nFound 1 error.");
    expect(parsed.items).toEqual([{ tool: "typescript", file: "C:\\work tree\\src\\a.ts", line: 12, col: 9, severity: "error", code: "TS2322", message: "Type 'string' is not assignable to type 'number'." }]);
  });
  it("handles pretty tsc and global errors without inventing file links", () => {
    const parsed = parseDiagnostics("\x1b[96msrc/a.ts\x1b[0m:3:2 - error TS2304: Cannot find name 'missing'.\nerror TS5023: Unknown compiler option '--mistake'.");
    expect(parsed.items[0]).toMatchObject({ file: "src/a.ts", line: 3, col: 2 });
    expect(parsed.items[1]).toMatchObject({ code: "TS5023" });
    expect(parsed.items[1].file).toBeUndefined();
  });
  it("associates Rust headers with primary locations without counting summary errors", () => {
    const parsed = parseDiagnostics("error[E0308]: mismatched types\n --> C:\\work tree\\main.rs:2:18\n  |\n2 | let n: i32 = \"wrong\";\nwarning: unused variable: `n`\n --> main.rs:3:9\nerror: aborting due to 1 previous error; 1 warning emitted");
    expect(parsed.items).toHaveLength(2);
    expect(parsed.items[0]).toMatchObject({ tool: "rust", severity: "error", code: "E0308", file: "C:\\work tree\\main.rs", line: 2, col: 18 });
    expect(parsed.items[1]).toMatchObject({ severity: "warning", line: 3 });
  });
  it("handles rustc and cargo JSON including primary spans and forward-compatible fields", () => {
    const message = { $message_type: "diagnostic", message: "mismatched types", code: { code: "E0308" }, level: "error", spans: [{ file_name: "other.rs", line_start: 1, column_start: 1 }, { file_name: "src/main.rs", line_start: 5, column_start: 9, is_primary: true }], children: [], new_field: true };
    const parsed = parseDiagnostics(JSON.stringify({ reason: "compiler-message", message }));
    expect(parsed.items[0]).toMatchObject({ file: "src/main.rs", line: 5, col: 9 });
    expect(parseDiagnostics(JSON.stringify({ ...message, level: "future-level" })).items).toEqual([]);
  });
  it("keeps unknown output unknown and enforces diagnostic limits", () => {
    expect(parseDiagnostics("All green! {\"error\":\"not a diagnostic\"}")).toMatchObject({ items: [], recognized: false });
    const parsed = parseDiagnostics(Array.from({ length: MAX_DIAGNOSTICS + 1 }, (_, i) => `a.ts(${i + 1},1): error TS2304: Missing ${i}`).join("\n"));
    expect(parsed.items).toHaveLength(MAX_DIAGNOSTICS); expect(parsed.truncated).toBe(true);
    expect(parseDiagnostics("error: Connection refused\nwarning: Failed to reconnect").recognized).toBe(false);
  });
  it("does not merge identical Rust messages at different source locations", () => {
    const parsed = parseDiagnostics("error[E0308]: mismatched types\n --> one.rs:1:1\nerror[E0308]: mismatched types\n --> two.rs:2:3");
    expect(parsed.items.map((d) => d.file)).toEqual(["one.rs", "two.rs"]);
  });
  it("reads ESLint stylish file headings, rule IDs and severity without executing fixes", () => {
    const parsed = parseDiagnostics("C:\\project one\\app.ts\n  2:4  error    Unknown identifier     no-undef\n  3:7  warning  A trailing separator   semi\n\n2 problems (1 error, 1 warning)");
    expect(parsed.items).toEqual([
      { tool: "eslint", file: "C:\\project one\\app.ts", line: 2, col: 4, severity: "error", message: "Unknown identifier", code: "no-undef" },
      { tool: "eslint", file: "C:\\project one\\app.ts", line: 3, col: 7, severity: "warning", message: "A trailing separator", code: "semi" },
    ]);
  });
  it("reads ESLint JSON and metadata formatters, tolerating missing rules and positions", () => {
    const results = [{ filePath: "/project/app.ts", messages: [{ severity: 2, message: "Parser rejected this token", ruleId: null, line: 8, column: 4 }, { severity: 1, message: "Local warning", ruleId: "local/rule" }] }];
    for (const value of [results, { results, metadata: {} }]) {
      const parsed = parseDiagnostics(JSON.stringify(value, null, 2));
      expect(parsed.items).toHaveLength(2);
      expect(parsed.items[0]).toMatchObject({ tool: "eslint", file: "/project/app.ts", line: 8, col: 4 });
      expect(parsed.items[1].line).toBeUndefined();
    }
  });
  it("reads Go compiler positions and .NET codes without confusing drive letters", () => {
    expect(parseDiagnostics("C:\\work\\main.go:7:9: cannot assign this expression\n").items[0]).toMatchObject({ tool: "go", file: "C:\\work\\main.go", line: 7, col: 9 });
    const parsed = parseDiagnostics("C:\\work one\\Program.cs(12,8): error CS0029: Conversion failed [app.csproj]\nwarning NU1900: Dependency information unavailable");
    expect(parsed.items[0]).toMatchObject({ tool: "dotnet", file: "C:\\work one\\Program.cs", line: 12, col: 8, code: "CS0029" });
    expect(parsed.items[1]).toMatchObject({ tool: "dotnet", severity: "warning", code: "NU1900" });
  });
  it("keeps pytest traceback locations and handles summary-only output without guessed lines", () => {
    const full = parseDiagnostics("tests/test_app.py:7: AssertionError\ntests/test_app.py:20: ValueError: Invalid item\nFAILED tests/test_app.py::test_one - AssertionError: Value differs\nFAILED tests/test_app.py::test_two - ValueError: Invalid item");
    expect(full.items.map((d) => d.line)).toEqual([7, 20]);
    const short = parseDiagnostics("FAILED tests/test_app.py::test_one[case] - AssertionError: Value differs");
    expect(short.items[0]).toMatchObject({ tool: "pytest", file: "tests/test_app.py", code: "test_one[case]" });
    expect(short.items[0].line).toBeUndefined();
  });
});

describe("run-scoped results", () => {
  const run = (command: string, cwd: string, output = "") => commandRun({ paneId: "pane", profileId: "pwsh", command, cwd, output, startedAt: 10, finishedAt: 20, exitCode: 0 });
  it("supersedes old diagnostics only for the same command, original folder and shell", () => {
    const failed = run("tsc", "C:/one", "a.ts(1,1): error TS2304: Missing");
    const other = run("tsc", "C:/two");
    const fixed = run("tsc", "C:/one");
    const runs = addRun(addRun([failed], other), fixed);
    expect(latestRuns(runs).map((r) => r.id)).toEqual([fixed.id, other.id]);
    expect(runs.find((r) => r.id === failed.id)?.diagnostics.items).toHaveLength(1);
    expect(fixed.id).not.toBe(failed.id);
  });
  it("labels missing/truncated output and preserves Unicode at the capture limit", () => {
    const oversized = run("check", "C:/one", "a".repeat(MAX_DIAGNOSTIC_OUTPUT - 1) + "🧪");
    expect(oversized.output).toHaveLength(MAX_DIAGNOSTIC_OUTPUT - 1);
    expect(oversized.outputTruncated).toBe(true); expect(oversized.diagnostics.truncated).toBe(true);
    const lost = commandRun({ paneId: "pane", cwd: "C:/one", command: "check", output: "", outputTruncated: true, startedAt: 1, finishedAt: 2 });
    expect(lost.diagnostics.truncated).toBe(true);
    expect(lost.diagnostics.recognized).toBe(false);
  });
  it("keeps checks in different environments even when command, folder and profile spellings match", () => {
    const native = run("check", "/repo");
    const ubuntu = { ...run("check", "/repo"), environment: "wsl:ubuntu" };
    const debian = { ...run("check", "/repo"), environment: "wsl:debian" };
    const latestUbuntu = { ...run("check", "/repo"), environment: "wsl:ubuntu" };
    expect(latestRuns([latestUbuntu, debian, ubuntu, native]).map(r => r.id)).toEqual([latestUbuntu.id, debian.id, native.id]);
  });
  it("restores native IDs and unknown exit status without converting null to success", () => {
    const restored = restoreRun({ id: "stable-run", paneId: "closed-pane", profileId: null, cwd: null, command: "check", exitCode: null, startedAt: 1, finishedAt: 2, output: "file.ts(2,3): error TS2322: Wrong value", outputTruncated: false });
    expect(restored.id).toBe("stable-run"); expect(restored.exitCode).toBeUndefined(); expect(restored.cwd).toBeUndefined();
    expect(restored.diagnostics.items[0]).toMatchObject({ code: "TS2322", line: 2, col: 3 });
  });
  it("bounds command metadata without merging distinct truncated commands", () => {
    const first = run("a".repeat(16_001), "C:/one"), second = run("a".repeat(16_000) + "b", "C:/one");
    expect(first.command).toHaveLength(16_000); expect(first.commandTruncated).toBe(true);
    expect(latestRuns([first, second])).toHaveLength(2);
  });
});
