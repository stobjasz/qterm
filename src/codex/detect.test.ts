import { describe, expect, it } from "vitest";
import { findCodexResumeIds } from "./detect";
import { resumeHereCommand } from "../claude/resume";
const ID = "01a1690c-c7b7-7e80-9864-e6971b91db16";

describe("Codex resume", () => {
  it("recognizes exit hints, normalizes UUIDs and keeps providers separate", () => {
    expect(findCodexResumeIds(`codex resume ${ID.toUpperCase()}\ncodex --no-daemon resume ${ID}`)).toEqual([ID]);
    expect(findCodexResumeIds(`claude --resume ${ID}\ncodex resume --last`)).toEqual([]);
    expect(findCodexResumeIds(`codex resume ${ID}0\ncodex resume ${ID}-bad`)).toEqual([]);
  });
  it("quotes folders and rejects session IDs that could inject commands", () => {
    expect(resumeHereCommand(ID, "C:\\My Work", "powershell", "codex")).toBe(`cd 'C:\\My Work'; codex --no-daemon resume ${ID}`);
    expect(resumeHereCommand(ID, "D:\\work", "cmd", "codex")).toBe(`cd /d D:\\work && codex --no-daemon resume ${ID}`);
    expect(resumeHereCommand("x; calc", null, "powershell", "codex")).toBeUndefined();
    expect(resumeHereCommand(ID, "C:\\work", "wsl", "codex")).toBeUndefined();
  });
});
