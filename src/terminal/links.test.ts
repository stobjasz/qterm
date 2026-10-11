import { describe, expect, it } from "vitest";

import { findFileLinks } from "./links";

const paths = (text: string) => findFileLinks(text).map(({ path, line, col }) => ({ path, line, col }));

describe("findFileLinks", () => {
  it("finds relative paths with line and column", () => {
    expect(paths("error in src/app.ts:42:7 here")).toEqual([{ path: "src/app.ts", line: 42, col: 7 }]);
    expect(paths("see ./lib/util.py:3")).toEqual([{ path: "./lib/util.py", line: 3, col: undefined }]);
  });

  it("finds Windows absolute paths", () => {
    expect(paths("C:\\work\\api\\main.rs:10:5: warning")).toEqual([{ path: "C:\\work\\api\\main.rs", line: 10, col: 5 }]);
    expect(paths("D:/games/engine/core.cpp")).toEqual([{ path: "D:/games/engine/core.cpp", line: undefined, col: undefined }]);
  });

  it("understands compiler-style (line,col)", () => {
    expect(paths("src/index.tsx(12,9): error TS2345")).toEqual([{ path: "src/index.tsx", line: 12, col: 9 }]);
    expect(paths("Program.cs(7)")).toEqual([{ path: "Program.cs", line: 7, col: undefined }]);
  });

  it("reports where each match sits in the line", () => {
    const [link] = findFileLinks("at src/app.ts:4 ok");
    expect([link.start, link.end]).toEqual([3, 15]);
  });

  it("finds several on one line", () => {
    expect(paths("a.ts:1 and b/c.rs:2").map((p) => p.path)).toEqual(["a.ts", "b/c.rs"]);
  });

  it("leaves URLs to the web-link handler", () => {
    expect(paths("open https://example.com/docs/index.html now")).toEqual([]);
  });

  it("ignores words without an extension", () => {
    expect(paths("make build && run tests")).toEqual([]);
  });
});
