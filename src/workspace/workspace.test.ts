import { describe, expect, it } from "vitest";

import {
  activateIndex,
  activateTab,
  activeTab,
  closePane,
  cycleTab,
  emptyWorkspace,
  equalizeActive,
  focusPane,
  moveFocus,
  openTab,
  resizeDivider,
  resizeFocused,
  setPaneTitle,
  splitPane,
  tabTitle,
  type Workspace,
} from "./workspace";

const pwsh = { id: "pwsh", name: "PowerShell" };
const cmd = { id: "cmd", name: "Command Prompt" };

function withTabs(count: number): Workspace {
  let ws = emptyWorkspace();
  for (let i = 1; i <= count; i++) ws = openTab(ws, { tab: `t${i}`, pane: `p${i}` }, pwsh);
  return ws;
}

describe("openTab", () => {
  it("appends a tab with one pane and activates it", () => {
    const ws = openTab(withTabs(1), { tab: "t2", pane: "p2" }, cmd);

    expect(ws.tabs.map((t) => t.id)).toEqual(["t1", "t2"]);
    expect(ws.activeTab).toBe("t2");
    expect(ws.tabs[1].root).toEqual({ kind: "leaf", pane: "p2" });
    expect(ws.tabs[1].focusedPane).toBe("p2");
    expect(ws.panes.p2).toEqual({ id: "p2", profileId: "cmd", profileName: "Command Prompt", title: "" });
  });
});

describe("closePane", () => {
  it("removes the pane and its tab", () => {
    const ws = closePane(withTabs(2), "p1");

    expect(ws.tabs.map((t) => t.id)).toEqual(["t2"]);
    expect(ws.panes.p1).toBeUndefined();
  });

  it("activates the tab to the right when the active tab closes", () => {
    const ws = closePane(activateTab(withTabs(3), "t2"), "p2");
    expect(ws.activeTab).toBe("t3");
  });

  it("activates the tab to the left when the last tab closes", () => {
    const ws = closePane(withTabs(3), "p3");
    expect(ws.activeTab).toBe("t2");
  });

  it("keeps the active tab when another tab closes", () => {
    const ws = closePane(activateTab(withTabs(3), "t3"), "p1");
    expect(ws.activeTab).toBe("t3");
  });

  it("leaves an empty workspace after the only tab closes", () => {
    const ws = closePane(withTabs(1), "p1");
    expect(ws.tabs).toEqual([]);
    expect(ws.activeTab).toBeUndefined();
  });

  it("ignores unknown panes", () => {
    const ws = withTabs(2);
    expect(closePane(ws, "nope")).toBe(ws);
  });
});

describe("tab switching", () => {
  it("cycles forward and wraps around", () => {
    const ws = withTabs(3); // t3 active
    expect(cycleTab(ws, 1).activeTab).toBe("t1");
    expect(cycleTab(ws, -1).activeTab).toBe("t2");
  });

  it("activates by index", () => {
    expect(activateIndex(withTabs(3), 0).activeTab).toBe("t1");
  });

  it("treats an index past the end as the last tab", () => {
    expect(activateIndex(activateTab(withTabs(3), "t1"), 8).activeTab).toBe("t3");
  });

  it("ignores unknown tab ids", () => {
    const ws = withTabs(2);
    expect(activateTab(ws, "nope")).toBe(ws);
  });
});

describe("titles", () => {
  it("uses the profile name until the shell sets a title", () => {
    let ws = withTabs(1);
    expect(tabTitle(ws, ws.tabs[0])).toBe("PowerShell");

    ws = setPaneTitle(ws, "p1", "C:\\Users\\me");
    expect(tabTitle(ws, ws.tabs[0])).toBe("C:\\Users\\me");
  });

  it("shows the profile name instead of a bare executable path", () => {
    const ws = setPaneTitle(withTabs(1), "p1", "C:\\Program Files\\PowerShell\\7\\pwsh.exe");
    expect(tabTitle(ws, ws.tabs[0])).toBe("PowerShell");
  });

  it("falls back to the profile name when the shell clears its title", () => {
    const ws = setPaneTitle(withTabs(1), "p1", "  ");
    expect(tabTitle(ws, ws.tabs[0])).toBe("PowerShell");
  });
});

describe("splits", () => {
  const split = (ws: Workspace, pane: string, newPane: string, dir: "row" | "column" = "row") =>
    splitPane(ws, pane, dir, newPane, cmd);

  it("splits the pane, registers the new one and focuses it", () => {
    const ws = split(withTabs(1), "p1", "n1");

    expect(ws.tabs[0].root).toEqual({
      kind: "split",
      dir: "row",
      children: [
        { kind: "leaf", pane: "p1" },
        { kind: "leaf", pane: "n1" },
      ],
      sizes: [0.5, 0.5],
    });
    expect(ws.tabs[0].focusedPane).toBe("n1");
    expect(ws.panes.n1.profileName).toBe("Command Prompt");
  });

  it("closing one pane of a split keeps the tab and focuses a remaining pane", () => {
    const ws = closePane(split(split(withTabs(1), "p1", "n1"), "n1", "n2"), "n2");

    expect(ws.tabs).toHaveLength(1);
    expect(ws.tabs[0].focusedPane).toBe("n1");
    expect(ws.panes.n2).toBeUndefined();
  });

  it("closing an unfocused pane keeps focus where it is", () => {
    const ws = closePane(split(withTabs(1), "p1", "n1"), "p1");
    expect(ws.tabs[0].focusedPane).toBe("n1");
  });

  it("focusing a pane also activates its tab", () => {
    let ws = activateTab(split(withTabs(2), "p1", "n1"), "t2");
    ws = focusPane(ws, "p1"); // p1 lives in the inactive t1

    expect(ws.activeTab).toBe("t1");
    expect(ws.tabs[0].focusedPane).toBe("p1");
  });

  it("moves focus between panes of the active tab", () => {
    const ws = split(withTabs(1), "p1", "n1"); // focus on n1 (right)
    expect(activeTab(moveFocus(ws, "left"))?.focusedPane).toBe("p1");
    expect(moveFocus(ws, "right")).toBe(ws);
  });

  it("resizes the focused pane and equalizes the active tab", () => {
    let ws = split(withTabs(1), "p1", "n1"); // n1 focused, last child
    ws = resizeFocused(ws, "left", 0.1);
    expect(ws.tabs[0].root.kind === "split" && ws.tabs[0].root.sizes).toEqual([0.4, 0.6]);

    ws = equalizeActive(ws);
    expect(ws.tabs[0].root.kind === "split" && ws.tabs[0].root.sizes).toEqual([0.5, 0.5]);
  });

  it("drags a divider in a given tab", () => {
    const ws = resizeDivider(split(withTabs(1), "p1", "n1"), "t1", [], 0, 0.25);
    expect(ws.tabs[0].root.kind === "split" && ws.tabs[0].root.sizes).toEqual([0.75, 0.25]);
  });
});
