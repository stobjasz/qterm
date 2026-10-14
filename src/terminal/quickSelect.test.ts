import { describe, expect, it } from "vitest";

import { findTargets, labelsFor } from "./quickSelect";

const texts = (line: string) => findTargets(line).map((t) => [t.kind, t.text]);

describe("quick select targets", () => {
  it("finds URLs without the sentence punctuation after them", () => {
    expect(texts("see https://example.com/a?b=1, then (https://x.org/wiki/A_(b)).")).toEqual([
      ["url", "https://example.com/a?b=1"],
      ["url", "https://x.org/wiki/A_(b)"],
    ]);
  });

  it("finds files with their position, and Windows folders", () => {
    const found = findTargets("error in src/app.ts:42:7 under C:\\work\\repo now");
    expect(found.map((t) => [t.kind, t.text, t.line, t.col])).toEqual([
      ["file", "src/app.ts", 42, 7],
      ["folder", "C:\\work\\repo", undefined, undefined],
    ]);
  });

  it("finds git hashes and IP addresses, not words or plain numbers", () => {
    expect(texts("commit 3f9c2ab1 by deadbeef at 10.0.0.12:8080 build 1234567")).toEqual([
      ["hash", "3f9c2ab1"],
      ["ip", "10.0.0.12:8080"],
    ]);
  });

  it("gives an overlap to the earliest, longest match", () => {
    // The file inside the folder path is one target, not two.
    expect(texts("C:\\work\\main.rs:10")).toEqual([["file", "C:\\work\\main.rs"]]);
  });
});

describe("quick select labels", () => {
  it("uses single letters while they last, then pairs, none a prefix of another", () => {
    expect(labelsFor(3)).toEqual(["a", "s", "d"]);
    const many = labelsFor(40);
    expect(many).toHaveLength(40);
    expect(many.every((l) => l.length === 2)).toBe(true);
    expect(new Set(many).size).toBe(40);
  });
});
