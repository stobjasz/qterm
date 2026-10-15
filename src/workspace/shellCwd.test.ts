import { describe, expect, it } from "vitest";

import { startFolder, type ShellRef } from "./shellCwd";

const pwsh: ShellRef = { id: "pwsh", kind: "powershell" };
const cmd: ShellRef = { id: "cmd", kind: "cmd" };
const bash: ShellRef = { id: "git-bash", kind: "bash" };
const ubuntu: ShellRef = { id: "wsl:Ubuntu", kind: "wsl" };
const debian: ShellRef = { id: "wsl:Debian", kind: "wsl" };

describe("startFolder", () => {
  it("keeps a folder for the same shell, and between Windows shells", () => {
    expect(startFolder("/c/work", bash, bash)).toEqual({ cwd: "/c/work", lost: false });
    expect(startFolder("C:\\work\\app", pwsh, cmd)).toEqual({ cwd: "C:\\work\\app", lost: false });
    expect(startFolder("C:\\work\\app", pwsh, bash)).toEqual({ cwd: "C:\\work\\app", lost: false });
  });

  it("reads Git Bash's /c/... folders as Windows folders", () => {
    expect(startFolder("/c/work/app", bash, pwsh)).toEqual({ cwd: "C:\\work\\app", lost: false });
    expect(startFolder("/d", bash, ubuntu)).toEqual({ cwd: "/mnt/d", lost: false });
    // Git Bash's own folders (/usr, ~) have no Windows path qterm knows.
    expect(startFolder("/usr/bin", bash, pwsh)).toEqual({ lost: true });
  });

  it("takes Windows folders into WSL as /mnt/<drive>", () => {
    expect(startFolder("C:\\work\\my app", pwsh, ubuntu)).toEqual({ cwd: "/mnt/c/work/my app", lost: false });
    expect(startFolder("\\\\server\\share", pwsh, ubuntu)).toEqual({ lost: true });
  });

  it("opens a distro's folder in Windows shells through \\\\wsl.localhost, but not in cmd", () => {
    expect(startFolder("/home/me/src", ubuntu, pwsh)).toEqual({ cwd: "\\\\wsl.localhost\\Ubuntu\\home\\me\\src", lost: false });
    expect(startFolder("/home/me/src", ubuntu, cmd)).toEqual({ lost: true });
    expect(startFolder("/mnt/c/work", ubuntu, cmd)).toEqual({ cwd: "C:\\work", lost: false });
  });

  it("moves between distros only through Windows folders", () => {
    expect(startFolder("/home/me", ubuntu, debian)).toEqual({ lost: true });
    expect(startFolder("/mnt/c/work", ubuntu, debian)).toEqual({ cwd: "/mnt/c/work", lost: false });
    expect(startFolder("\\\\wsl.localhost\\Ubuntu\\home\\me", pwsh, ubuntu)).toEqual({ cwd: "/home/me", lost: false });
  });

  it("has nothing to lose without a folder", () => {
    expect(startFolder(undefined, pwsh, ubuntu)).toEqual({ lost: false });
  });
});
