import { describe, expect, it } from "vitest";

import { emptyHistory, MAX_COMMANDS, parseHistory, rememberCommand, rememberFolder } from "./history";

describe("recent commands", () => {
  it("keeps the newest first, each command once", () => {
    let h = emptyHistory();
    h = rememberCommand(h, { command: "git status", at: 1 });
    h = rememberCommand(h, { command: "npm test", at: 2, exitCode: 1 });
    h = rememberCommand(h, { command: "  git status ", at: 3, cwd: "C:\\work" });
    expect(h.commands).toEqual([
      { command: "git status", at: 3, cwd: "C:\\work" },
      { command: "npm test", at: 2, exitCode: 1 },
    ]);
  });

  it("skips blank and very long command lines, and keeps only the latest ones", () => {
    let h = rememberCommand(emptyHistory(), { command: "   ", at: 1 });
    h = rememberCommand(h, { command: "x".repeat(5000), at: 2 });
    expect(h.commands).toEqual([]);
    for (let i = 0; i < MAX_COMMANDS + 5; i++) h = rememberCommand(h, { command: `echo ${i}`, at: i });
    expect(h.commands).toHaveLength(MAX_COMMANDS);
    expect(h.commands[0].command).toBe(`echo ${MAX_COMMANDS + 4}`);
  });
});

describe("history.json", () => {
  it("keeps how long a command ran, and drops a malformed duration", () => {
    const text = JSON.stringify({ commands: [{ command: "npm test", at: 5, durationMs: 3200 }, { command: "ls", at: 4, durationMs: "long" }] });
    expect(parseHistory(text).commands).toEqual([{ command: "npm test", at: 5, durationMs: 3200 }, { command: "ls", at: 4 }]);
  });
});

describe("recent folders", () => {
  it("treats case and a trailing backslash as the same folder", () => {
    let h = rememberFolder(emptyHistory(), "C:\\Work\\app");
    h = rememberFolder(h, "C:\\temp");
    h = rememberFolder(h, "c:\\work\\APP\\");
    expect(h.folders).toEqual(["c:\\work\\APP\\", "C:\\temp"]);
  });

  it("returns the same history when the folder is already the newest", () => {
    const h = rememberFolder(emptyHistory(), "C:\\a");
    expect(rememberFolder(h, "c:\\A")).toBe(h);
  });
});

describe("history.json", () => {
  it("reads what was saved and drops anything malformed", () => {
    const text = JSON.stringify({
      commands: [{ command: "ls", at: 5, exitCode: 0, cwd: "C:\\x" }, { command: 3 }, { at: 1 }],
      folders: ["C:\\x", 42],
    });
    expect(parseHistory(text)).toEqual({ commands: [{ command: "ls", at: 5, exitCode: 0, cwd: "C:\\x" }], folders: ["C:\\x"] });
    expect(parseHistory("not json")).toEqual(emptyHistory());
    expect(parseHistory(null)).toEqual(emptyHistory());
  });
});
