import { describe, expect, it } from "vitest";

import { startFolder, transferFolder, type ShellRef } from "./shellCwd";

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
    expect(startFolder("/d", bash, ubuntu)).toEqual({ lost: true });
    // Git Bash's own folders (/usr, ~) have no Windows path qterm knows.
    expect(startFolder("/usr/bin", bash, pwsh)).toEqual({ lost: true });
  });

  it("requires mount-aware translation before crossing Windows/WSL", () => {
    expect(startFolder("C:\\work\\my app", pwsh, ubuntu)).toEqual({ lost: true });
    expect(startFolder("\\\\server\\share", pwsh, ubuntu)).toEqual({ lost: true });
  });

  it("opens a distro's folder in Windows shells through \\\\wsl.localhost, but not in cmd", () => {
    expect(startFolder("/home/me/src", ubuntu, pwsh)).toEqual({ cwd: "\\\\wsl.localhost\\Ubuntu\\home\\me\\src", lost: false });
    expect(startFolder("/home/me/src", ubuntu, cmd)).toEqual({ lost: true });
    expect(startFolder("/mnt/c/work", ubuntu, cmd)).toEqual({ lost: true });
  });

  it("moves between distros only through Windows folders", () => {
    expect(startFolder("/home/me", ubuntu, debian)).toEqual({ lost: true });
    expect(startFolder("/mnt/c/work", ubuntu, debian)).toEqual({ lost: true });
    expect(startFolder("\\\\wsl.localhost\\Ubuntu\\home\\me", pwsh, ubuntu)).toEqual({ cwd: "/home/me", lost: false });
  });

  it("has nothing to lose without a folder", () => {
    expect(startFolder(undefined, pwsh, ubuntu)).toEqual({ lost: false });
  });

  it("uses captured distribution identity for custom and subsequently edited profiles",()=>{
    const custom:ShellRef={id:"custom:linux",kind:"wsl",distribution:"Ubuntu"};
    expect(startFolder("/c/Case",custom,ubuntu)).toEqual({cwd:"/c/Case",lost:false});
    expect(startFolder("/c/Case",{...custom,kind:"bash",distribution:undefined,environment:"wsl:ubuntu"},pwsh)).toEqual({cwd:"\\\\wsl.localhost\\ubuntu\\c\\Case",lost:false});
    expect(startFolder("/home/me",{...custom,environment:"wsl:ubuntu"},{...custom,distribution:"Debian"})).toEqual({lost:true});
    expect(startFolder("/home/me",custom,pwsh)).toEqual({cwd:"\\\\wsl.localhost\\Ubuntu\\home\\me",lost:false});
  });

  it("honors translated mount roots in each direction and keeps distro-only folders scoped",async()=>{
    const calls:unknown[]=[];
    const translate=async(distro:string,paths:string[],toLinux:boolean)=>{calls.push([distro,paths,toLinux]);return toLinux?[`/drives/${distro.toLowerCase()}/Work`]:["C:\\Work"];};
    expect(await transferFolder("C:\\Work",pwsh,ubuntu,translate)).toEqual({cwd:"/drives/ubuntu/Work",lost:false});
    expect(await transferFolder("/drives/ubuntu/Work",ubuntu,cmd,translate)).toEqual({cwd:"C:\\Work",lost:false});
    expect(await transferFolder("/drives/ubuntu/Work",ubuntu,debian,translate)).toEqual({cwd:"/drives/debian/Work",lost:false});
    expect(calls).toEqual([["Ubuntu",["C:\\Work"],true],["Ubuntu",["/drives/ubuntu/Work"],false],["Ubuntu",["/drives/ubuntu/Work"],false],["Debian",["C:\\Work"],true]]);
    expect(await transferFolder("/home/me",ubuntu,debian,async()=>["\\\\wsl.localhost\\Ubuntu\\home\\me"])).toEqual({lost:true});
    await expect(transferFolder("C:\\Work",pwsh,ubuntu,async()=>{throw Error("unavailable");})).rejects.toThrow("unavailable");
  });
});
