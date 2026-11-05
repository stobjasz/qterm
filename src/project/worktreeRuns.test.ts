import { expect, it } from "vitest";
import { commandRun } from "../problems/runs";
import { worktreeRuns } from "./worktreeRuns";

it("associates only retained native runs in the worktree or its subfolders after task creation", () => {
  const run = (cwd?: string, startedAt = 20, shellKind: "powershell" | "bash" | "wsl" = "powershell") => commandRun({ paneId: "p", cwd, shellKind, command: "check", startedAt, finishedAt: 30, output: "" });
  const values = [run("C:\\tasks\\fix"), run("/c/tasks/fix/src", 20, "bash"), run("C:\\tasks\\fix-other"), run("C:\\tasks\\fix", 9), run(undefined), run("C:\\tasks\\fix", 20, "wsl")];
  expect(worktreeRuns("C:/tasks/fix", 10, values)).toEqual(values.slice(0, 2));
});

it("keeps Linux worktree history case-sensitive and scoped to its captured distribution",()=>{
  const run=(cwd:string,environment:string)=>commandRun({paneId:"p",cwd,environment,shellKind:"wsl",command:"check",startedAt:20,finishedAt:30,output:""});
  const values=[run("/c/Task","wsl:ubuntu"),run("/c/Task/src","wsl:ubuntu"),run("/c/task","wsl:ubuntu"),run("/c/Task-other","wsl:ubuntu"),run("/c/Task","wsl:debian"),run("/c/Task","native")];
  expect(worktreeRuns("/c/Task",10,values,"wsl:ubuntu")).toEqual(values.slice(0,2));
  expect(worktreeRuns("C:/Task",10,values)).toEqual([]);
});
