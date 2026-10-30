import { describe, expect, it, vi } from "vitest";
import { Persistence, persistOutput } from "./persistence";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("recoverable persistence", () => {
  it("retries an unchanged snapshot after a failed write and clears its error only on recovery", async () => {
    const report = vi.fn();
    const store = new Persistence(report);
    const write = vi.fn().mockRejectedValueOnce(new Error("disk full")).mockResolvedValue(undefined);
    await expect(store.save("Workspace", "layout", write)).rejects.toThrow("disk full");
    expect(report).toHaveBeenLastCalledWith("Workspace", "Error: disk full");
    await store.save("Workspace", "layout", write);
    expect(write).toHaveBeenCalledTimes(2);
    expect(report).toHaveBeenLastCalledWith("Workspace");
    await store.save("Workspace", "layout", write);
    expect(write).toHaveBeenCalledTimes(2);
  });

  it("keeps the newest snapshot on disk when saves overlap", async () => {
    const first = deferred();
    const store = new Persistence(() => {});
    let disk = "";
    const write = vi.fn(async (snapshot: string) => {
      if (snapshot === "old") await first.promise;
      disk = snapshot;
    });
    const old = store.save("Workspace", "old", write);
    const latest = store.save("Workspace", "new", write);
    await Promise.resolve();
    expect(write).toHaveBeenCalledTimes(1);
    first.resolve();
    await Promise.all([old, latest]);
    expect(disk).toBe("new");
  });

  it("does not block a different store behind a failed or slow write", async () => {
    const gate = deferred();
    const report = vi.fn();
    const store = new Persistence(report);
    const slow = store.run("Output", () => gate.promise);
    const write = vi.fn(async () => {});
    await store.save("Workspace", "new", write);
    expect(write).toHaveBeenCalledOnce();
    gate.resolve();
    await slow;
  });

  it("orders clearing output after in-flight saves so a late save cannot resurrect it", async () => {
    const gate = deferred();
    const store = new Persistence(() => {});
    let disk: string | undefined;
    const save = store.run("Output", async () => { await gate.promise; disk = "private output"; });
    const clear = store.run("Output", async () => { disk = undefined; });
    gate.resolve();
    await Promise.all([save, clear]);
    expect(disk).toBeUndefined();
  });
});

describe("output snapshots", () => {
  it("keeps a failed pane dirty while acknowledging successful panes, and preserves old files", async () => {
    const saved = new Map<string, number>();
    const prune = vi.fn(async () => {});
    const snapshots = [
      { paneId: "good", revision: 10, text: "first" },
      { paneId: "failed", revision: 20, text: "second" },
    ];
    const write = vi.fn(async (paneId: string) => { if (paneId === "failed") throw new Error("locked"); });
    await expect(persistOutput(snapshots, saved, write, prune)).rejects.toThrow("locked");
    expect(saved.get("good")).toBe(10);
    expect(saved.has("failed")).toBe(false);
    expect(prune).not.toHaveBeenCalled();
    await persistOutput(snapshots.filter((s) => s.revision > (saved.get(s.paneId) ?? 0)), saved, async () => {}, prune);
    expect(saved.get("failed")).toBe(20);
    expect(prune).toHaveBeenCalledOnce();
  });

  it("does not acknowledge output produced while an older snapshot is being written", async () => {
    const saved = new Map<string, number>();
    const gate = deferred();
    let currentRevision = 10;
    const save = persistOutput([{ paneId: "pane", revision: currentRevision, text: "old" }], saved, () => gate.promise, async () => {});
    currentRevision = 20;
    gate.resolve();
    await save;
    expect(currentRevision > saved.get("pane")!).toBe(true);
  });
});
