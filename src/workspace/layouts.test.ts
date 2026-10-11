import { describe, expect, it } from "vitest";

import { buildLayout, layoutFromTab, type LayoutDef } from "./layouts";
import { openTab, splitPane, emptyWorkspace } from "./workspace";

const pwsh = { id: "pwsh", name: "PowerShell" };
const cmd = { id: "cmd", name: "Command Prompt" };
const profiles = [pwsh, cmd];

let n = 0;
const nextId = () => `p${++n}`;

describe("buildLayout", () => {
  it("turns a definition into a split tree with a shell, folder and command per pane", () => {
    n = 0;
    const def: LayoutDef = {
      name: "dev",
      split: "row",
      panes: [
        { profile: "cmd", cwd: "C:/api", command: "npm run dev" },
        { split: "column", panes: [{}, { profile: "Command Prompt" }] },
      ],
    };
    const built = buildLayout(def, profiles, pwsh, nextId);

    expect(built.root).toEqual({
      kind: "split",
      dir: "row",
      sizes: [0.5, 0.5],
      children: [
        { kind: "leaf", pane: "p1" },
        { kind: "split", dir: "column", sizes: [0.5, 0.5], children: [{ kind: "leaf", pane: "p2" }, { kind: "leaf", pane: "p3" }] },
      ],
    });
    expect(built.panes.map((p) => [p.id, p.profileId, p.cwd])).toEqual([
      ["p1", "cmd", "C:/api"],
      ["p2", "pwsh", undefined],
      ["p3", "cmd", undefined],
    ]);
    expect(built.commands).toEqual(new Map([["p1", "npm run dev"]]));
    expect(built.unknownProfiles).toEqual([]);
  });

  it("uses the default profile for unknown references and reports them", () => {
    const built = buildLayout({ name: "x", profile: "fish" }, profiles, pwsh, nextId);
    expect(built.root.kind).toBe("leaf");
    expect(built.panes[0].profileId).toBe("pwsh");
    expect(built.unknownProfiles).toEqual(["fish"]);
  });

  it("treats a single-child split as that child", () => {
    const built = buildLayout({ name: "x", split: "row", panes: [{ cwd: "D:/" }] }, profiles, pwsh, nextId);
    expect(built.root.kind).toBe("leaf");
    expect(built.panes[0].cwd).toBe("D:/");
  });
});

describe("layoutFromTab", () => {
  it("captures splits, profiles and folders (not sizes or commands)", () => {
    let ws = openTab(emptyWorkspace(), { tab: "t1", pane: "a" }, pwsh, "C:/one");
    ws = splitPane(ws, "a", "row", "b", cmd, "C:/two");
    ws = splitPane(ws, "b", "column", "c", pwsh);
    expect(layoutFromTab(ws, ws.tabs[0], "mine")).toEqual({
      name: "mine",
      split: "row",
      panes: [
        { profile: "pwsh", cwd: "C:/one" },
        { split: "column", panes: [{ profile: "cmd", cwd: "C:/two" }, { profile: "pwsh" }] },
      ],
    });
  });

  it("round-trips through buildLayout", () => {
    let ws = openTab(emptyWorkspace(), { tab: "t1", pane: "a" }, pwsh, "C:/one");
    ws = splitPane(ws, "a", "column", "b", cmd);
    const def = layoutFromTab(ws, ws.tabs[0], "again");
    const built = buildLayout(def, profiles, pwsh, nextId);
    expect(built.panes.map((p) => [p.profileId, p.cwd])).toEqual([
      ["pwsh", "C:/one"],
      ["cmd", undefined],
    ]);
  });
});
