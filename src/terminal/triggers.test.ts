import { describe, expect, it } from "vitest";

import { compileTriggers, HIGHLIGHT_COLOR, matching } from "./triggers";

describe("output triggers", () => {
  const { triggers, errors } = compileTriggers([
    { name: "Build done", pattern: "Compiled successfully", regex: false, action: "notify" },
    { pattern: "error TS\\d+", regex: true, action: "highlight" },
    { name: "broken", pattern: "(", regex: true, action: "mark" },
  ]);

  it("matches plain text ignoring case, and regular expressions as written", () => {
    expect(matching(triggers, "webpack: compiled SUCCESSFULLY in 2s").map((t) => t.label)).toEqual(["Build done"]);
    expect(matching(triggers, "src/a.ts(3,1): error TS2304: Cannot find name").map((t) => t.label)).toEqual(["error TS\\d+"]);
    expect(matching(triggers, "Error ts2304")).toEqual([]);
    expect(matching(triggers, "   ")).toEqual([]);
  });

  it("names a trigger by its pattern without a name, and highlights in amber by default", () => {
    expect(triggers[1].label).toBe("error TS\\d+");
    expect(triggers[1].color).toBe(HIGHLIGHT_COLOR);
  });

  it("reports a regular expression that doesn't compile, and skips it", () => {
    expect(triggers).toHaveLength(2);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/^trigger "broken": the pattern isn't a valid regular expression/);
  });
});
