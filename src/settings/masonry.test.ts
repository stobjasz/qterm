import { describe, expect, it } from "vitest";

import { columnCount, pack, spanThatFits } from "./masonry";

describe("settings layout", () => {
  it("fits as many 340px columns as the width allows, at least one", () => {
    expect(columnCount(5064)).toBe(14);
    expect(columnCount(693)).toBe(1);
    expect(columnCount(694)).toBe(2);
    expect(columnCount(100)).toBe(1);
  });

  it("puts each group where it starts highest, so short ones don't leave holes", () => {
    // Three columns: a tall group, two short ones, then one more that goes under the shortest.
    const { placements, height } = pack(
      [
        { span: 1, height: 500 },
        { span: 1, height: 100 },
        { span: 1, height: 200 },
        { span: 1, height: 50 },
      ],
      3,
      10,
    );
    expect(placements).toEqual([
      { column: 0, top: 0 },
      { column: 1, top: 0 },
      { column: 2, top: 0 },
      { column: 1, top: 110 },
    ]);
    expect(height).toBe(500);
  });

  it("gives a wide group a run of columns under the lowest of them", () => {
    const { placements } = pack(
      [
        { span: 1, height: 300 },
        { span: 1, height: 100 },
        { span: 1, height: 100 },
        { span: 2, height: 80 },
      ],
      3,
      10,
    );
    // Columns 1 and 2 end at 110: the two-column group goes there, not under column 0.
    expect(placements[3]).toEqual({ column: 1, top: 110 });
  });

  it("widens a group only as far as needed to fit the height", () => {
    // 900px of content: halves with each extra column.
    const measure = (span: number) => ({ height: Math.ceil(900 / span), overflows: false });
    expect(spanThatFits(measure, 6, 600)).toBe(2);
    expect(spanThatFits(measure, 6, 1000)).toBe(1);
    expect(spanThatFits(measure, 2, 100)).toBe(2);
  });

  it("widens a group whose content sticks out sideways, even when it's short", () => {
    // Something 500px wide doesn't fit one column, but does two.
    const measure = (span: number) => ({ height: 200, overflows: span * 340 < 500 });
    expect(spanThatFits(measure, 6, 600)).toBe(2);
    // Too tall at every width: the widest, the shortest it gets.
    const tall = (span: number) => ({ height: Math.ceil(5000 / span), overflows: span < 3 });
    expect(spanThatFits(tall, 6, 600)).toBe(6);
    // Overflowing at every width: the widest.
    expect(spanThatFits(() => ({ height: 100, overflows: true }), 4, 600)).toBe(4);
  });
});
