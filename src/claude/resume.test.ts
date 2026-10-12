import { describe, expect, it } from "vitest";

import { resumeHereCommand } from "./resume";

describe("resuming a Claude session in the current pane", () => {
  it("goes to the folder the way each shell does", () => {
    expect(resumeHereCommand("abc", "C:\\work\\app", "powershell")).toBe("cd C:\\work\\app; claude --resume abc");
    expect(resumeHereCommand("abc", "C:\\My Work", "powershell")).toBe("cd 'C:\\My Work'; claude --resume abc");
    expect(resumeHereCommand("abc", "D:\\work", "cmd")).toBe("cd /d D:\\work && claude --resume abc");
    expect(resumeHereCommand("abc", "C:\\My Work", "bash")).toBe("cd '/c/My Work' && claude --resume abc");
    expect(resumeHereCommand("abc", "/home/me/app", "wsl")).toBe("cd /home/me/app && claude --resume abc");
  });

  it("just resumes when the folder isn't known", () => {
    expect(resumeHereCommand("abc", null, "cmd")).toBe("claude --resume abc");
  });

  it("can't cross between Windows and WSL, or run in a custom program", () => {
    expect(resumeHereCommand("abc", "C:\\work", "wsl")).toBeUndefined();
    expect(resumeHereCommand("abc", "/home/me", "powershell")).toBeUndefined();
    expect(resumeHereCommand("abc", "C:\\work", "other")).toBeUndefined();
  });
});
