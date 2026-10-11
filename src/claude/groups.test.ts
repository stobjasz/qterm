import { describe, expect, it } from "vitest";

import type { ClaudeSession } from "../ipc";
import { groupSessions } from "./groups";

let n = 0;
const session = (cwd: string | null, seenAt: number, title: string | null = null): ClaudeSession => ({
  id: `00000000-0000-0000-0000-${String(++n).padStart(12, "0")}`,
  cwd,
  title,
  profileId: "pwsh",
  seenAt,
});

describe("groupSessions", () => {
  it("groups by folder, newest folder first, newest session first", () => {
    const a1 = session("C:\\work\\api", 100);
    const b1 = session("C:\\work\\web", 300);
    const a2 = session("C:\\work\\api", 200);
    const groups = groupSessions([a1, b1, a2]);

    expect(groups.map((g) => g.label)).toEqual(["web", "api"]);
    expect(groups[1].sessions).toEqual([a2, a1]);
    expect(groups[1].cwd).toBe("C:\\work\\api");
  });

  it("treats Windows paths that differ only in case or a trailing slash as one folder", () => {
    const groups = groupSessions([session("C:\\Work\\API\\", 2), session("c:\\work\\api", 1)]);
    expect(groups).toHaveLength(1);
    expect(groups[0].cwd).toBe("C:\\Work\\API\\"); // shown as the newest session had it
  });

  it("keeps case-sensitive POSIX folders apart", () => {
    expect(groupSessions([session("/home/me/App", 2), session("/home/me/app", 1)])).toHaveLength(2);
  });

  it("puts sessions without a folder in their own group, labelled as such", () => {
    const groups = groupSessions([session(null, 5), session("D:\\x", 1)]);
    expect(groups[0]).toMatchObject({ cwd: null, label: "Folder unknown" });
  });

  it("labels a drive root by the drive", () => {
    expect(groupSessions([session("D:\\", 1)])[0].label).toBe("D:\\");
  });

  it("filters by title, folder or id, case-insensitively", () => {
    const login = session("C:\\work\\api", 3, "Fix the LOGIN flow");
    const web = session("C:\\work\\web", 2, "Dark mode");
    const sessions = [login, web];

    expect(groupSessions(sessions, "login").flatMap((g) => g.sessions)).toEqual([login]);
    expect(groupSessions(sessions, "WORK\\web").flatMap((g) => g.sessions)).toEqual([web]);
    expect(groupSessions(sessions, web.id.slice(-6)).flatMap((g) => g.sessions)).toEqual([web]);
    expect(groupSessions(sessions, "   ")).toHaveLength(2);
    expect(groupSessions(sessions, "nothing like it")).toEqual([]);
  });
});
