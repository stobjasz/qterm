import { expect, it } from "vitest";
import { commandRun } from "../problems/runs";
import { worktreeRuns } from "./worktreeRuns";

it("associates only retained native runs in the worktree or its subfolders after task creation", () => {
  const run = (cwd?: string, startedAt = 20, shellKind: "powershell" | "bash" | "wsl" = "powershell") => commandRun({ paneId: "p", cwd, shellKind, command: "check", startedAt, finishedAt: 30, output: "" });
  const values = [run("C:\\tasks\\fix"), run("/c/tasks/fix/src", 20, "bash"), run("C:\\tasks\\fix-other"), run("C:\\tasks\\fix", 9), run(undefined), run("C:\\tasks\\fix", 20, "wsl")];
  expect(worktreeRuns("C:/tasks/fix", 10, values)).toEqual(values.slice(0, 2));
});
