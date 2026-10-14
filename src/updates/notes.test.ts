import { describe, expect, it } from "vitest";

import { parseInline, parseNotes } from "./notes";

describe("release notes", () => {
  it("reads headings, list items (with continuation lines) and paragraphs", () => {
    const blocks = parseNotes("New in **0.2.1**.\r\n\r\n## New\r\n\r\n- **Quick select** (Alt+Shift+S):\r\n  copies `text`.\r\n- Second\r\n\r\nThe end\r\ncontinues here.");
    expect(blocks.map((b) => b.kind)).toEqual(["paragraph", "heading", "item", "item", "paragraph"]);
    expect(blocks[2].inlines).toEqual([
      { kind: "bold", text: "Quick select" },
      { kind: "text", text: " (Alt+Shift+S):" },
      { kind: "text", text: " " },
      { kind: "text", text: "copies " },
      { kind: "code", text: "text" },
      { kind: "text", text: "." },
    ]);
    expect(blocks[4].inlines).toEqual([{ kind: "text", text: "The end continues here." }]);
  });

  it("keeps https links and leaves everything else as text", () => {
    expect(parseInline("See the [user guide](https://github.com/x/y) or [this](javascript:alert(1)).")).toEqual([
      { kind: "text", text: "See the " },
      { kind: "link", text: "user guide", url: "https://github.com/x/y" },
      { kind: "text", text: " or [this](javascript:alert(1))." },
    ]);
  });
});
