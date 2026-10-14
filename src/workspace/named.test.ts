import { describe, expect, it } from "vitest";

import { cleanName, parseNamed, removeNamed, serializeNamed, upsertNamed } from "./named";
import { paneIds } from "./layout";
import { appendWorkspace, emptyWorkspace, openTab, restoreWorkspace, saveWorkspace, splitPane, withClaudeTitles } from "./workspace";

const pwsh = { id: "pwsh", name: "PowerShell" };

describe("named workspaces", () => {
  it("saves by name, replacing one of the same name, sorted", () => {
    let list = upsertNamed([], "  dev   setup ", "a", 1);
    list = upsertNamed(list, "API", "b", 2);
    list = upsertNamed(list, "Dev Setup", "c", 3);
    expect(list.map((w) => [w.name, w.session])).toEqual([
      ["API", "b"],
      ["Dev Setup", "c"],
    ]);
    expect(upsertNamed(list, "   ", "x", 4)).toEqual(list);
    expect(removeNamed(list, "API").map((w) => w.name)).toEqual(["Dev Setup"]);
  });

  it("round-trips through workspaces.json and drops malformed entries", () => {
    const list = upsertNamed([], "dev", "{}", 5);
    expect(parseNamed(serializeNamed(list))).toEqual(list);
    expect(parseNamed(JSON.stringify({ workspaces: [{ name: "x" }, { name: " ", savedAt: 1, session: "" }, 3] }))).toEqual([]);
    expect(parseNamed("nope")).toEqual([]);
  });

  it("limits names", () => {
    expect(cleanName("x".repeat(100))).toHaveLength(60);
  });
});

describe("opening a workspace next to the open tabs", () => {
  let n = 0;
  const nextId = (kind: "tab" | "pane") => `${kind}-new${++n}`;

  it("adds its tabs with fresh ids, keeps layout, folders and titles, and activates its first tab", () => {
    let saved = openTab(emptyWorkspace(), { tab: "t1", pane: "p1" }, pwsh, "C:\\work");
    saved = splitPane(saved, "p1", "row", "p2", pwsh);
    saved = withClaudeTitles(saved, new Map([["p2", "Fix login"]]));
    const restored = restoreWorkspace(saveWorkspace(saved, new Map([["p2", "session-1"]])), [pwsh])!;

    const open = openTab(emptyWorkspace(), { tab: "t1", pane: "p1" }, pwsh);
    const merged = appendWorkspace(open, restored, nextId);
    expect(merged.tabs).toHaveLength(2);
    const added = merged.tabs[1];
    expect(merged.activeTab).toBe(added.id);
    expect(added.id).not.toBe("t1");
    const ids = paneIds(added.root);
    expect(ids).toHaveLength(2);
    expect(ids.every((id) => id.startsWith("pane-new"))).toBe(true);
    expect(merged.panes[ids[0]].cwd).toBe("C:\\work");
    expect(merged.panes[ids[1]].claudeTitle).toBe("Fix login");
    // Not resumed: that's for restarts.
    expect(merged.panes[ids[1]].claudeSession).toBeUndefined();
    // The open tab is untouched.
    expect(merged.panes.p1).toBe(open.panes.p1);

    // The same workspace again: no id collides.
    const twice = appendWorkspace(merged, restored, nextId);
    expect(new Set(Object.keys(twice.panes)).size).toBe(Object.keys(twice.panes).length);
    expect(twice.tabs).toHaveLength(3);
  });
});
