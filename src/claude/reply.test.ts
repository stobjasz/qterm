import { describe, expect, it } from "vitest";

import { replyPreview } from "./reply";

describe("replyPreview", () => {
  it("keeps a short reply as it is", () => {
    expect(replyPreview("  Done: the tests pass.\n")).toBe("Done: the tests pass.");
  });

  it("keeps the first lines, without runs of blank ones", () => {
    expect(replyPreview("One\n\n\n\nTwo\nThree\nFour", 3)).toBe("One\n\nTwo…");
  });

  it("cuts a long reply", () => {
    expect(replyPreview("x".repeat(500), 6, 10)).toBe(`${"x".repeat(10)}…`);
  });
});
