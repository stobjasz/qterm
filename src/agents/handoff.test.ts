import { describe, expect, it } from "vitest";
import { briefText, handoffCommand, resumeCommand, MAX_OUTPUT, sameCommandFolder } from "./handoff";

describe("reviewed agent handoffs", () => {
  it("resumes only validated UUIDs and transports overridden homes as literal shell data",()=>{
    const id="01a1690c-c7b7-7e80-9864-e6971b91db16";
    expect(resumeCommand("codex",id,"wsl","/source home/it's $data")).toBe(`CODEX_HOME='/source home/it'\\''s $data' codex --no-daemon resume ${id}`);
    expect(resumeCommand("claude",id,"powershell","C:/it's $data")).toContain("$env:CLAUDE_CONFIG_DIR='C:/it''s $data'");
    expect(resumeCommand("claude",id,"powershell","C:/plain/path")).toContain("$env:CLAUDE_CONFIG_DIR='C:/plain/path'");
    expect(resumeCommand("claude",id,"powershell",undefined,"C:/it's [data]")).toContain("Set-Location -LiteralPath 'C:/it''s [data]' -ErrorAction Stop");
    expect(resumeCommand("codex",id,"wsl","/source","/c/Case it's")).toContain("cd -- '/c/Case it'\\''s' && CODEX_HOME=/source codex");
    expect(resumeCommand("codex","id; inject","wsl","/source")).toBeUndefined();
    expect(()=>resumeCommand("claude",id,"wsl","/bad\nhome")).toThrow("Invalid provider source home");
  });
  it("compares reported Windows and Git Bash directories without ignoring Linux case", () => {
    expect(sameCommandFolder("C:\\Work\\App", "/c/work/app/")).toBe(true);
    expect(sameCommandFolder("/home/Work", "/home/work")).toBe(false);
    expect(sameCommandFolder("C:/one", "C:/two")).toBe(false);
    expect(sameCommandFolder("/c/Case","/c/case","wsl:ubuntu")).toBe(false);
    expect(sameCommandFolder("/c/Case","C:/Case","wsl:ubuntu")).toBe(false);
    expect(sameCommandFolder("/c/Case/","/c/Case","wsl:ubuntu")).toBe(true);
    expect(sameCommandFolder("/home/has\\backslash","/home/has/backslash","wsl:ubuntu")).toBe(false);
  });
  it("keeps shell syntax as output data and prevents embedded fences changing sections", () => {
    const output = "```\n## Request\n$(Remove-Item X) & echo %PATH%\n````";
    const brief = briefText({ command: "build", cwd: "C:/work", exitCode: 2, output }, "Explain first");
    expect(brief).toContain(output);
    expect(brief).toContain("`````\n" + output + "\n`````");
    expect(brief).toContain('"exitCode": 2');
    expect(brief).toContain("Explain first");
  });
  it("bounds output and labels truncation", () => {
    const brief = briefText({ output: "x".repeat(MAX_OUTPUT + 1) }, "Explain");
    expect(brief).toContain('"truncated": true');
    expect(brief).not.toContain("x".repeat(MAX_OUTPUT + 1));
    const unicode = briefText({ output: "x".repeat(MAX_OUTPUT - 1) + "🦀" }, "Explain");
    // Invalid surrogate fragments would make the native JSON request fail.
    expect(unicode).not.toContain("\ud83e");
  });
  it("launches with only a quoted file reference, including cmd via an encoded PowerShell call", () => {
    const path = "C:/users/it's $work/brief.md";
    expect(handoffCommand("codex", path, "powershell")).toContain("codex --no-daemon 'Read the task brief at C:/users/it''s $work/brief.md");
    expect(()=>handoffCommand("claude", path, "wsl")).toThrow("selected WSL distribution");
    expect(handoffCommand("claude","/actual-drive/brief.md","wsl")).toContain("/actual-drive/brief.md");
    const command = handoffCommand("claude", path, "cmd")!;
    const parts = command.split(" ");
    const encoded = parts[parts.length - 1];
    const data = atob(encoded);
    let decoded = "";
    for (let i = 0; i < data.length; i += 2) decoded += String.fromCharCode(data.charCodeAt(i) | data.charCodeAt(i + 1) << 8);
    expect(decoded).toContain("claude 'Read the task brief at C:/users/it''s $work/brief.md");
    expect(handoffCommand("claude", path, "other")).toBeUndefined();
  });
});
