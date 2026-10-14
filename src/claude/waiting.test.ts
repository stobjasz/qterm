import { describe, expect, it } from "vitest";

import { nextWaiting } from "./waiting";

describe("next pane where Claude waits", () => {
  const order = ["a", "b", "c", "d"];

  it("goes forward from the current pane and wraps around", () => {
    const waiting = new Set(["b", "d"]);
    expect(nextWaiting(order, waiting, "a")).toBe("b");
    expect(nextWaiting(order, waiting, "b")).toBe("d");
    expect(nextWaiting(order, waiting, "d")).toBe("b");
  });

  it("starts at the first waiting pane without a current one", () => {
    expect(nextWaiting(order, new Set(["c"]), undefined)).toBe("c");
    expect(nextWaiting(order, new Set(["c"]), "gone")).toBe("c");
  });

  it("has nowhere to go when nothing waits (or only panes that are gone)", () => {
    expect(nextWaiting(order, new Set(), "a")).toBeUndefined();
    expect(nextWaiting(order, new Set(["x"]), "a")).toBeUndefined();
  });
});
