import { describe, expect, it } from "vitest";

import { parseOsc7, parseOsc9 } from "./cwd";

describe("parseOsc7 (file:// URL)", () => {
  it("turns a Windows drive path into a backslash path", () => {
    expect(parseOsc7("file://DESKTOP-1/C:/Users/me/My%20Repo")).toBe("C:\\Users\\me\\My Repo");
    expect(parseOsc7("file:///D:/work")).toBe("D:\\work");
  });

  it("keeps POSIX paths (WSL, Git Bash)", () => {
    expect(parseOsc7("file://ubuntu/home/me/src")).toBe("/home/me/src");
  });

  it("ignores anything that isn't a file URL", () => {
    expect(parseOsc7("https://example.com/")).toBeUndefined();
    expect(parseOsc7("garbage")).toBeUndefined();
  });
});

describe("parseOsc9 (Windows Terminal 9;9)", () => {
  it("reads quoted and bare paths", () => {
    expect(parseOsc9('9;"C:\\Users\\me"')).toBe("C:\\Users\\me");
    expect(parseOsc9("9;C:\\Users\\me")).toBe("C:\\Users\\me");
  });

  it("ignores other OSC 9 uses (notifications, progress)", () => {
    expect(parseOsc9("Build finished")).toBeUndefined();
    expect(parseOsc9("4;1;50")).toBeUndefined();
    expect(parseOsc9("9;")).toBeUndefined();
  });
});
