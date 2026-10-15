import { describe, expect, it } from "vitest";

import { copyText, findJson, jsonPath, preview } from "./json";

describe("findJson", () => {
  it("reads a command's whole output", () => {
    expect(findJson('  {\n  "name": "qterm",\n  "tags": [1, 2]\n}\n')).toEqual({ name: "qterm", tags: [1, 2] });
    expect(findJson("[]")).toEqual([]);
  });

  it("reads JSON Lines as a list", () => {
    expect(findJson('{"level":"info"}\n{"level":"warn"}\n')).toEqual([{ level: "info" }, { level: "warn" }]);
  });

  it("finds an object after a log prefix, with brackets inside strings", () => {
    expect(findJson('2026-10-15 INFO request {"path":"/a]b{","ok":true} done')).toEqual({ path: "/a]b{", ok: true });
    expect(findJson('[warn] not json, then {"a": "\\"}"} ')).toEqual({ a: '"}' });
  });

  it("finds nothing in plain text, or in a lone number or string", () => {
    expect(findJson("Build succeeded in 3.2s")).toBeUndefined();
    expect(findJson("42")).toBeUndefined();
    expect(findJson('"hello"')).toBeUndefined();
    expect(findJson("{ broken")).toBeUndefined();
    expect(findJson("")).toBeUndefined();
  });
});

describe("helpers", () => {
  it("writes paths the way jq and JSONPath do", () => {
    expect(jsonPath(["items", 2, "name"])).toBe("$.items[2].name");
    expect(jsonPath(["content-type"])).toBe('$["content-type"]');
    expect(jsonPath([])).toBe("$");
  });

  it("copies strings as they are and the rest as JSON", () => {
    expect(copyText("C:\\work")).toBe("C:\\work");
    expect(copyText({ a: [1] })).toBe('{\n  "a": [\n    1\n  ]\n}');
    expect(copyText(null)).toBe("null");
  });

  it("previews containers by size and values as JSON", () => {
    expect(preview([1, 2, 3])).toBe("[3 items]");
    expect(preview({ a: 1 })).toBe("{1 key}");
    expect(preview("x".repeat(100), 10)).toBe(`"xxxxxxxx…`);
  });
});
