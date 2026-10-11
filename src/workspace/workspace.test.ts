import { describe, expect, it } from "vitest";

import {
  activateIndex,
  activateTab,
  closePane,
  cycleTab,
  emptyWorkspace,
  openTab,
  setPaneTitle,
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
