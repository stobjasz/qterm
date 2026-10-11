import { describe, expect, it } from "vitest";

import {
  equalized,
  insertSplit,
  layoutRects,
  neighbor,
  paneIds,
  removePane,
  resizeAt,
  resizeToward,
  swapLeaves,
  type LayoutNode,
} from "./layout";

const leaf = (pane: string): LayoutNode => ({ kind: "leaf", pane });
const row = (children: LayoutNode[], sizes?: number[]): LayoutNode => ({
  kind: "split",
  dir: "row",
  children,
  sizes: sizes ?? children.map(() => 1 / children.length),
});
const column = (children: LayoutNode[], sizes?: number[]): LayoutNode => ({
  kind: "split",
  dir: "column",
  children,
  sizes: sizes ?? children.map(() => 1 / children.length),
});

describe("insertSplit", () => {
  it("turns a single pane into a two-way split", () => {
    expect(insertSplit(leaf("a"), "a", "row", "b")).toEqual(row([leaf("a"), leaf("b")]));
  });

  it("adds a sibling when splitting in the parent's direction, giving equal thirds", () => {
    const twice = insertSplit(insertSplit(leaf("a"), "a", "row", "b"), "b", "row", "c");
    expect(twice).toEqual(row([leaf("a"), leaf("b"), leaf("c")]));
  });

  it("inserts the new pane right after the split one", () => {
    const tree = insertSplit(row([leaf("a"), leaf("b")]), "a", "row", "n");
    expect(paneIds(tree)).toEqual(["a", "n", "b"]);
  });

  it("nests a split when the direction differs", () => {
    const tree = insertSplit(row([leaf("a"), leaf("b")]), "b", "column", "c");
    expect(tree).toEqual(row([leaf("a"), column([leaf("b"), leaf("c")])]));
  });
});

describe("removePane", () => {
  it("returns nothing when the last pane goes", () => {
    expect(removePane(leaf("a"), "a")).toBeUndefined();
  });

  it("collapses a split that is left with one child", () => {
    expect(removePane(row([leaf("a"), leaf("b")]), "b")).toEqual(leaf("a"));
  });

  it("gives the freed space to the remaining siblings in proportion", () => {
    const tree = removePane(row([leaf("a"), leaf("b"), leaf("c")], [0.5, 0.25, 0.25]), "c");
    expect(tree).toEqual(row([leaf("a"), leaf("b")], [2 / 3, 1 / 3]));
  });

  it("flattens a collapsed child into a parent with the same direction", () => {
    // row[a, column[b, row[c, d]]] minus b → row[a, c, d]
    const tree = removePane(row([leaf("a"), column([leaf("b"), row([leaf("c"), leaf("d")])])]), "b");
    expect(tree).toEqual(row([leaf("a"), leaf("c"), leaf("d")], [0.5, 0.25, 0.25]));
  });

  it("leaves the tree alone for unknown panes", () => {
    const tree = row([leaf("a"), leaf("b")]);
    expect(removePane(tree, "x")).toEqual(tree);
  });
});

describe("layoutRects", () => {
  it("lays out nested splits in unit space", () => {
    const rects = layoutRects(row([leaf("a"), column([leaf("b"), leaf("c")])], [0.25, 0.75]));
    expect(rects.a).toEqual({ x: 0, y: 0, w: 0.25, h: 1 });
    expect(rects.b).toEqual({ x: 0.25, y: 0, w: 0.75, h: 0.5 });
    expect(rects.c).toEqual({ x: 0.25, y: 0.5, w: 0.75, h: 0.5 });
  });
});

describe("neighbor", () => {
  // ┌───┬───┐
  // │   │ b │
  // │ a ├───┤
  // │   │ c │
  // └───┴───┘
  const tree = row([leaf("a"), column([leaf("b"), leaf("c")])]);

  it("finds the adjacent pane in each direction", () => {
    expect(neighbor(tree, "a", "right")).toBe("b"); // tie on distance: b and c overlap a equally, first wins
    expect(neighbor(tree, "b", "down")).toBe("c");
    expect(neighbor(tree, "c", "up")).toBe("b");
    expect(neighbor(tree, "c", "left")).toBe("a");
  });

  it("returns nothing at the edge", () => {
    expect(neighbor(tree, "a", "left")).toBeUndefined();
    expect(neighbor(tree, "b", "up")).toBeUndefined();
  });

  it("prefers the pane with the most overlap", () => {
    // left column split 70/30; from the right pane, moving left lands on the taller one
    const lopsided = row([column([leaf("top"), leaf("bottom")], [0.7, 0.3]), leaf("r")]);
    expect(neighbor(lopsided, "r", "left")).toBe("top");
  });
});

describe("resizing", () => {
  it("moves a divider and keeps both sides above the minimum", () => {
    const tree = row([leaf("a"), leaf("b")]);
    expect(resizeAt(tree, [], 0, 0.2)).toEqual(row([leaf("a"), leaf("b")], [0.7, 0.3]));
    const clamped = resizeAt(tree, [], 0, 0.9) as Extract<LayoutNode, { kind: "split" }>;
    expect(clamped.sizes[1]).toBeCloseTo(0.1);
  });

  it("resizes inside a nested split by path", () => {
    const tree = row([leaf("a"), column([leaf("b"), leaf("c")])]);
    const resized = resizeAt(tree, [1], 0, -0.1);
    expect(resized).toEqual(row([leaf("a"), column([leaf("b"), leaf("c")], [0.4, 0.6])]));
  });

  it("grows the focused pane toward the direction when there is a divider on that side", () => {
    const tree = row([leaf("a"), leaf("b"), leaf("c")], [0.3, 0.4, 0.3]);
    expect((resizeToward(tree, "b", "right", 0.1) as Extract<LayoutNode, { kind: "split" }>).sizes).toEqual([
      0.3, 0.5, 0.2,
    ]);
  });

  it("moves the pane's other divider when it sits at the edge", () => {
    const tree = row([leaf("a"), leaf("b")]);
    // b is the last child: "right" pushes its left divider right, shrinking it
    expect(resizeToward(tree, "b", "right", 0.1)).toEqual(row([leaf("a"), leaf("b")], [0.6, 0.4]));
  });

  it("uses the nearest ancestor split along the axis", () => {
    const tree = row([leaf("a"), column([leaf("b"), leaf("c")])]);
    expect(resizeToward(tree, "c", "left", 0.1)).toEqual(
      row([leaf("a"), column([leaf("b"), leaf("c")])], [0.4, 0.6]),
    );
  });

  it("does nothing without a split on that axis", () => {
    const tree = row([leaf("a"), leaf("b")]);
    expect(resizeToward(tree, "a", "up", 0.1)).toBe(tree);
  });

  it("equalizes every split", () => {
    const tree = row([leaf("a"), column([leaf("b"), leaf("c")], [0.9, 0.1])], [0.2, 0.8]);
    expect(equalized(tree)).toEqual(row([leaf("a"), column([leaf("b"), leaf("c")])]));
  });
});

describe("swapLeaves", () => {
  it("exchanges two panes and keeps the shape and sizes", () => {
    const tree = row([leaf("a"), column([leaf("b"), leaf("c")], [0.3, 0.7])], [0.4, 0.6]);
    expect(swapLeaves(tree, "a", "c")).toEqual(row([leaf("c"), column([leaf("b"), leaf("a")], [0.3, 0.7])], [0.4, 0.6]));
  });
});
