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
  moveTab,
  openTab,
  renameTab,
  restoreWorkspace,
  saveWorkspace,
  setPaneCwd,
  setTabStyle,
  setPaneBackground,
  resizeDivider,
  resizeFocused,
  setPaneTitle,
  splitPane,
  swapPane,
  tabTitle,
  toggleBroadcast,
  toggleZoom,
  withClaudeTitles,
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

  it("names a tab after the Claude session in its focused pane, until renamed", () => {
    let ws = setPaneTitle(withTabs(1), "p1", "C:\work");
    ws = withClaudeTitles(ws, new Map([["p1", "Fix the login redirect"]]));
    expect(tabTitle(ws, ws.tabs[0])).toBe("Fix the login redirect");
    // Claude has exited and the shell titles itself again: the name stays.
    ws = setPaneTitle(ws, "p1", "C:\work\app");
    expect(tabTitle(ws, ws.tabs[0])).toBe("Fix the login redirect");
    // A name given by hand wins.
    ws = renameTab(ws, "t1", "mine");
    expect(tabTitle(ws, ws.tabs[0])).toBe("mine");
  });

  it("keeps the workspace as it is when no Claude title changed", () => {
    const ws = withClaudeTitles(withTabs(1), new Map([["p1", "A"]]));
    expect(withClaudeTitles(ws, new Map([["p1", "A"], ["gone", "B"]]))).toBe(ws);
  });

  it("keeps the Claude title across a restart", () => {
    const ws = withClaudeTitles(withTabs(1), new Map([["p1", "Fix the login redirect"]]));
    const restored = restoreWorkspace(saveWorkspace(ws), [pwsh])!;
    expect(tabTitle(restored, restored.tabs[0])).toBe("Fix the login redirect");
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

describe("tab rename and reorder", () => {
  it("a custom title wins over the shell's, and clearing it restores the shell's", () => {
    let ws = setPaneTitle(withTabs(1), "p1", "C:\work");
    ws = renameTab(ws, "t1", "  build  ");
    expect(tabTitle(ws, ws.tabs[0])).toBe("build");
    ws = renameTab(ws, "t1", "   ");
    expect(tabTitle(ws, ws.tabs[0])).toBe("C:\work");
  });

  it("moves a tab to a new position and keeps it active", () => {
    const ws = moveTab(activateTab(withTabs(3), "t1"), "t1", 2);
    expect(ws.tabs.map((t) => t.id)).toEqual(["t2", "t3", "t1"]);
    expect(ws.activeTab).toBe("t1");
    expect(moveTab(ws, "t3", 0).tabs.map((t) => t.id)).toEqual(["t3", "t2", "t1"]);
  });

  it("clamps the target position and ignores unknown tabs", () => {
    const ws = withTabs(2);
    expect(moveTab(ws, "t1", 99).tabs.map((t) => t.id)).toEqual(["t2", "t1"]);
    expect(moveTab(ws, "nope", 0)).toBe(ws);
  });
});

describe("working directories", () => {
  it("records the folder a pane reported", () => {
    const ws = setPaneCwd(withTabs(1), "p1", "C:\src");
    expect(ws.panes.p1.cwd).toBe("C:\src");
    expect(setPaneCwd(ws, "p1", "C:\src")).toBe(ws);
  });

  it("starts new tabs and splits in the given folder", () => {
    let ws = openTab(emptyWorkspace(), { tab: "t1", pane: "p1" }, pwsh, "D:\a");
    ws = splitPane(ws, "p1", "row", "p2", pwsh, "D:\b");
    expect(ws.panes.p1.cwd).toBe("D:\a");
    expect(ws.panes.p2.cwd).toBe("D:\b");
  });
});

describe("save and restore", () => {
  const profiles = [pwsh, cmd];

  it("round-trips tabs, layout, profiles, folders and custom titles", () => {
    let ws = openTab(emptyWorkspace(), { tab: "t1", pane: "p1" }, pwsh, "C:\a");
    ws = splitPane(ws, "p1", "column", "p2", cmd, "C:\b");
    ws = renameTab(setPaneTitle(ws, "p1", "shell title"), "t1", "mine");
    ws = openTab(ws, { tab: "t2", pane: "p3" }, cmd);

    const restored = restoreWorkspace(saveWorkspace(ws), profiles)!;
    expect(restored.tabs).toEqual(ws.tabs);
    expect(restored.activeTab).toBe("t2");
    expect(restored.panes.p2).toEqual({ id: "p2", profileId: "cmd", profileName: "Command Prompt", title: "", cwd: "C:\b" });
    expect(restored.panes.p1.title, "shell titles are not saved; the shell sets them again").toBe("");
  });

  it("does not change when only shell titles change", () => {
    const ws = withTabs(1);
    expect(saveWorkspace(setPaneTitle(ws, "p1", "x"))).toBe(saveWorkspace(ws));
  });

  it("moves panes of a profile that no longer exists to the default profile", () => {
    const saved = saveWorkspace(openTab(emptyWorkspace(), { tab: "t1", pane: "p1" }, { id: "wsl:Gone", name: "Gone" }));
    const restored = restoreWorkspace(saved, profiles)!;
    expect(restored.panes.p1.profileId).toBe("pwsh");
    expect(restored.panes.p1.profileName).toBe("PowerShell");
  });

  it("rejects damaged or empty sessions", () => {
    expect(restoreWorkspace("not json", profiles)).toBeUndefined();
    expect(restoreWorkspace(JSON.stringify({ version: 1, tabs: [] }), profiles)).toBeUndefined();
    expect(restoreWorkspace(JSON.stringify({ version: 1, tabs: [{ id: "t", root: { kind: "leaf", pane: "x" } }] }), profiles)).toBeUndefined();
    expect(restoreWorkspace(saveWorkspace(withTabs(1)), [])).toBeUndefined();
  });
});

describe("pane tools", () => {
  const twoPanes = () => splitPane(withTabs(1), "p1", "row", "p2", pwsh); // p2 focused, right

  it("zooms the focused pane and toggles back", () => {
    let ws = toggleZoom(twoPanes());
    expect(ws.tabs[0].zoomed).toBe("p2");
    ws = toggleZoom(ws);
    expect(ws.tabs[0].zoomed).toBeUndefined();
  });

  it("does not zoom a tab with a single pane", () => {
    const ws = withTabs(1);
    expect(toggleZoom(ws)).toBe(ws);
  });

  it("leaves zoom when moving focus, splitting, or closing the zoomed pane", () => {
    expect(moveFocus(toggleZoom(twoPanes()), "left").tabs[0].zoomed).toBeUndefined();
    expect(splitPane(toggleZoom(twoPanes()), "p2", "row", "p3", pwsh).tabs[0].zoomed).toBeUndefined();
    expect(closePane(toggleZoom(twoPanes()), "p2").tabs[0].zoomed).toBeUndefined();
  });

  it("swaps the focused pane with its neighbour and keeps focus on it", () => {
    const ws = swapPane(twoPanes(), "left");
    expect(paneOrder(ws)).toEqual(["p2", "p1"]);
    expect(ws.tabs[0].focusedPane).toBe("p2");
    expect(swapPane(ws, "left")).toBe(ws);
  });

  it("toggles broadcast for the active tab only", () => {
    let ws = openTab(twoPanes(), { tab: "t2", pane: "p3" }, pwsh);
    ws = toggleBroadcast(activateTab(ws, "t1"));
    expect(ws.tabs.map((t) => Boolean(t.broadcast))).toEqual([true, false]);
    expect(toggleBroadcast(ws).tabs[0].broadcast).toBeUndefined();
  });

  it("does not save zoom or broadcast", () => {
    const ws = toggleBroadcast(toggleZoom(twoPanes()));
    expect(restoreWorkspace(saveWorkspace(ws), [pwsh])!.tabs[0]).not.toHaveProperty("zoomed");
    expect(restoreWorkspace(saveWorkspace(ws), [pwsh])!.tabs[0]).not.toHaveProperty("broadcast");
  });
});

function paneOrder(ws: Workspace): string[] {
  return JSON.stringify(ws.tabs[0].root).match(/p\d+/g) ?? [];
}

describe("administrator panes", () => {
  it("are marked, but a restart reopens them unelevated", () => {
    const ws = openTab(emptyWorkspace(), { tab: "t1", pane: "p1" }, { id: "pwsh", name: "PowerShell" }, "C:/x", true);
    expect(ws.panes.p1.elevated).toBe(true);
    const restored = restoreWorkspace(saveWorkspace(ws), [{ id: "pwsh", name: "PowerShell" }])!;
    expect(restored.panes.p1.elevated).toBeUndefined();
    expect(restored.panes.p1.cwd).toBe("C:/x");
  });
});

describe("tab style and Claude sessions across restarts", () => {
  const profiles = [{ id: "pwsh", name: "PowerShell" }];
  const base = () => openTab(emptyWorkspace(), { tab: "t1", pane: "p1" }, profiles[0], "C:/x");

  it("keeps a tab's colour and icon, and clears them", () => {
    let ws = setTabStyle(base(), "t1", { color: "green", icon: " 🚀 " });
    expect(ws.tabs[0]).toMatchObject({ color: "green", icon: "🚀" });
    const restored = restoreWorkspace(saveWorkspace(ws), profiles)!;
    expect(restored.tabs[0]).toMatchObject({ color: "green", icon: "🚀" });
    ws = setTabStyle(ws, "t1", { color: null });
    expect(ws.tabs[0].color).toBeUndefined();
    expect(ws.tabs[0].icon).toBe("🚀");
    expect(setTabStyle(ws, "t1", { icon: "toolongicon" }).tabs[0].icon).toBe("tool");
  });

  it("drops colours and icons it doesn't know", () => {
    const text = saveWorkspace(base()).replace('"id":"t1"', '"id":"t1","color":"#ff0000","icon":"way too long"');
    const restored = restoreWorkspace(text, profiles)!;
    expect(restored.tabs[0].color).toBeUndefined();
    expect(restored.tabs[0].icon).toBeUndefined();
  });

  it("remembers which Claude session ran in a pane, if it looks like one", () => {
    const text = saveWorkspace(base(), new Map([["p1", "4c766d1a-f139-42df-90f0-a04fe20d3056"]]));
    expect(restoreWorkspace(text, profiles)!.panes.p1.claudeSession).toBe("4c766d1a-f139-42df-90f0-a04fe20d3056");
    expect(restoreWorkspace(saveWorkspace(base()), profiles)!.panes.p1.claudeSession).toBeUndefined();
    const evil = saveWorkspace(base(), new Map([["p1", "x; rm -rf /"]]));
    expect(restoreWorkspace(evil, profiles)!.panes.p1.claudeSession).toBeUndefined();
  });
});

describe("a background for one pane", () => {
  const profiles = [{ id: "pwsh", name: "PowerShell" }];
  const twoPanes = () => splitPane(openTab(emptyWorkspace(), { tab: "t1", pane: "left" }, profiles[0]), "left", "row", "right", profiles[0]);

  it("is set on that pane only, kept across a restart, and cleared again", () => {
    let ws = setPaneBackground(twoPanes(), "right", "#1A2B3C");
    expect(ws.panes.right.background).toBe("#1a2b3c");
    expect(ws.panes.left.background).toBeUndefined();
    expect(restoreWorkspace(saveWorkspace(ws), profiles)!.panes.right.background).toBe("#1a2b3c");
    ws = setPaneBackground(ws, "right", null);
    expect(ws.panes.right.background).toBeUndefined();
  });

  it("only takes colours like #rrggbb", () => {
    const ws = twoPanes();
    expect(setPaneBackground(ws, "right", "red")).toBe(ws);
    const text = saveWorkspace(ws).replace('"profileId":"pwsh"', '"profileId":"pwsh","background":"url(x)"');
    expect(Object.values(restoreWorkspace(text, profiles)!.panes).every((p) => p.background === undefined)).toBe(true);
  });
});
