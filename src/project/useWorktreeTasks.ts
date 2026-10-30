import { useCallback, useEffect, useState } from "react";
import { createWorktreeTask, onWorktreeTasksChanged, worktreeTaskAction, worktreeTasksSnapshot, type WorktreeSnapshot } from "../ipc";

export function useWorktreeTasks() {
  const [snapshot, setSnapshot] = useState<WorktreeSnapshot>({ tasks: [], revision: -1, error: null, recoveryRequired: false, backupPath: null });
  const [error, setError] = useState<string>();
  const accept = useCallback((value: WorktreeSnapshot) => { setSnapshot((current) => value.revision >= current.revision ? value : current); setError(undefined); return value; }, []);
  useEffect(() => {
    let active = true;
    const listener = onWorktreeTasksChanged((value) => active && accept(value));
    void listener.then(() => worktreeTasksSnapshot()).then((value) => active && accept(value)).catch((e) => active && setError(String(e)));
    return () => { active = false; void listener.then((stop) => stop()).catch(() => {}); };
  }, [accept]);
  const action = useCallback(async (kind: "retry" | "recover" | "complete" | "reopen", taskId?: string) => accept(await worktreeTaskAction(kind, taskId)), [accept]);
  const create = useCallback(async (token: string) => accept(await createWorktreeTask(token)), [accept]);
  const flush = useCallback(async () => { const value = await action("retry"); if (value.error) throw new Error(value.error); }, [action]);
  return { snapshot, action, create, flush, error: error ?? snapshot.error };
}
