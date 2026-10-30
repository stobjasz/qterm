import { describe, expect, it } from "vitest";

import { dropText, shellPath } from "./drop";

describe("dropped files", () => {
  it("leaves plain paths bare so a dropped program still runs", () => {
    expect(dropText(["C:\\tools\\app.exe"], "powershell")).toBe("C:\\tools\\app.exe ");
    expect(dropText(["C:\\tools\\app.exe"], "cmd")).toBe("C:\\tools\\app.exe ");
  });

  it("quotes paths with spaces the way each shell needs", () => {
    const path = "C:\\My Files\\it's.txt";
    expect(dropText([path], "powershell")).toBe("'C:\\My Files\\it''s.txt' ");
    expect(dropText([path], "cmd")).toBe('"C:\\My Files\\it\'s.txt" ');
    expect(dropText([path], "bash")).toBe("'/c/My Files/it'\\''s.txt' ");
    expect(dropText(["/actual-drive/My Files/it's.txt"], "wsl")).toBe("'/actual-drive/My Files/it'\\''s.txt' ");
    expect(dropText([path], "other")).toBe('"C:\\My Files\\it\'s.txt" ');
  });

  it("quotes characters a shell would expand", () => {
    expect(dropText(["C:\\a\\$HOME"], "powershell")).toBe("'C:\\a\\$HOME' ");
    expect(dropText(["C:\\a\\x&y"], "cmd")).toBe('"C:\\a\\x&y" ');
    expect(dropText(["C:\\a\\x,y"], "powershell")).toBe("'C:\\a\\x,y' ");
  });

  it("joins several files with spaces", () => {
    expect(dropText(["C:\\a.txt", "D:\\b c.txt"], "powershell")).toBe("C:\\a.txt 'D:\\b c.txt' ");
  });

  it("keeps non-ASCII names bare", () => {
    expect(dropText(["C:\\Zdjęcia\\łódź.png"], "powershell")).toBe("C:\\Zdjęcia\\łódź.png ");
  });

  it("translates Git Bash paths and requires explicit distro translation before WSL quoting", () => {
    expect(shellPath("C:\\Users\\me", "bash")).toBe("/c/Users/me");
    expect(shellPath("D:\\", "bash")).toBe("/d");
    expect(shellPath("\\\\server\\share\\x", "bash")).toBe("//server/share/x");
    expect(()=>shellPath("C:\\Users\\me", "wsl")).toThrow("selected WSL distribution");
    expect(()=>shellPath("\\\\wsl.localhost\\Ubuntu\\home\\me\\a.txt", "wsl")).toThrow();
    expect(shellPath("/c/Case/file.py", "wsl")).toBe("/c/Case/file.py");
    expect(shellPath("C:\\Users\\me", "powershell")).toBe("C:\\Users\\me");
  });
});
