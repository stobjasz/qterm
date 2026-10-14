import { describe, expect, it } from "vitest";

import { isClaudeAlert, nextWaiting } from "./waiting";

describe("which alerts are Claude's", () => {
  it("counts Claude waiting or stopped, not long commands or triggers", () => {
    expect(isClaudeAlert("permission_prompt")).toBe(true);
    expect(isClaudeAlert(null)).toBe(true);
    expect(isClaudeAlert("stop_failure:rate_limit")).toBe(true);
    expect(isClaudeAlert("command_failed")).toBe(false);
    expect(isClaudeAlert("trigger")).toBe(false);
  });
});

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
