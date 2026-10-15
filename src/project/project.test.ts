import { describe, expect, it } from "vitest";

import type { ProjectInfo } from "../ipc";
import { gitSummary, projectLook } from "./project";

describe("gitSummary", () => {
  it("names the branch, the changes and how far it is from its upstream", () => {
    expect(gitSummary({ branch: "main", ahead: 2, behind: 1, changed: 3, untracked: 1 })).toBe("main · 3 changed, 1 new · ↑2 ↓1");
    expect(gitSummary({ branch: "feature/x", ahead: 0, behind: 0, changed: 0, untracked: 0 })).toBe("feature/x · clean");
    expect(gitSummary({ branch: "a1b2c3d", ahead: null, behind: null, changed: 0, untracked: 2 })).toBe("a1b2c3d · 2 new");
  });
});

describe("projectLook", () => {
  const info = (settings: Partial<NonNullable<ProjectInfo["settings"]>> | null): ProjectInfo => ({
    git: null,
    tasks: null,
    settingsError: null,
    settings: settings && { path: "C:/w/.qterm.toml", name: null, tabColor: null, icon: null, snippets: [], triggers: [], ...settings },
  });

  it("takes the name, colour and icon the project sets", () => {
    expect(projectLook(info({ name: " Web shop ", tabColor: "green", icon: "🛒" }))).toEqual({ name: "Web shop", color: "green", icon: "🛒" });
    expect(projectLook(info({ tabColor: "teal" }))).toEqual({ color: "teal" });
  });

  it("gives nothing without settings, or with only snippets", () => {
    expect(projectLook(undefined)).toBeUndefined();
    expect(projectLook(info(null))).toBeUndefined();
    expect(projectLook(info({ snippets: [{ name: "x", command: "y", run: false }] }))).toBeUndefined();
  });
});
