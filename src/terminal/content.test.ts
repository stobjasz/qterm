import { describe, expect, it } from "vitest";

import { hasContent, plainLines } from "./content";

describe("output worth keeping", () => {
  it("ignores bare prompts, banners and qterm's own markers", () => {
    expect(hasContent(["PS C:\\Users\\me> ", "", "PS C:\\Users\\me>"])).toBe(false);
    expect(hasContent(["Microsoft Windows [Version 10.0.26300.1000]", "(c) Microsoft Corporation. All rights reserved.", "", "C:\\Users\\me>"])).toBe(false);
    expect(hasContent(["me@BOX MINGW64 ~/dev (main)", "$ "])).toBe(false);
    expect(hasContent(["me@box:~/dev$ "])).toBe(false);
    expect(hasContent(["Loading personal and system profiles took 812ms.", "PS C:\\> "])).toBe(false);
    expect(hasContent(["PS C:\\> ", "──── restored 11 Oct 2026, 19:07 ────", "PS C:\\> ", "[process exited with code 0]"])).toBe(false);
    expect(hasContent([])).toBe(false);
  });

  it("keeps commands and their output", () => {
    expect(hasContent(["PS C:\\> git status"])).toBe(true);
    expect(hasContent(["C:\\> dir"])).toBe(true);
    expect(hasContent(["me@box:~$ ls", "a.txt"])).toBe(true);
    expect(hasContent(["PS C:\\> ", "On branch master"])).toBe(true);
  });

  it("reads serialized output as plain lines", () => {
    const serialized = "\x1b[38;2;80;200;80mPS\x1b[0m\x1b[1CC:\\>\r\n\x1b]8;;https://x\x07link\x1b]8;;\x07\r\n\x1b[2A";
    expect(plainLines(serialized)).toEqual(["PS C:\\>", "link", ""]);
    expect(hasContent(plainLines(serialized))).toBe(true);
    expect(hasContent(plainLines("\x1b[32mPS C:\\>\x1b[0m \r\n"))).toBe(false);
  });
});
