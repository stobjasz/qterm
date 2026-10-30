/** Orders writes to each store and remembers only snapshots that reached disk.
 * A rejected write does not poison the queue or acknowledge the failed snapshot.
 */
export class Persistence {
  private tails = new Map<string, Promise<void>>();
  private saved = new Map<string, string>();

  constructor(private report: (store: string, error?: string) => void) {}

  run(store: string, operation: () => Promise<void>): Promise<void> {
    const previous = this.tails.get(store) ?? Promise.resolve();
    const result = previous.then(async () => {
      try {
        await operation();
        this.report(store);
      } catch (error) {
        this.report(store, String(error));
        throw error;
      }
    });
    // The caller receives the rejection; later operations can still proceed.
    const settled = result.catch(() => {});
    this.tails.set(store, settled);
    void settled.then(() => { if (this.tails.get(store) === settled) this.tails.delete(store); });
    return result;
  }

  save(store: string, snapshot: string, write: (snapshot: string) => Promise<void>): Promise<void> {
    return this.run(store, async () => {
      if (this.saved.get(store) === snapshot) return;
      await write(snapshot);
      this.saved.set(store, snapshot);
    });
  }
}

export interface OutputSnapshot {
  paneId: string;
  /** Output revision captured before serialization, never the write completion time. */
  revision: number;
  text: string;
}

/** Record successful panes even when another fails. Never prune until writes finish. */
export async function persistOutput(
  snapshots: OutputSnapshot[],
  saved: Map<string, number>,
  write: (paneId: string, text: string) => Promise<void>,
  prune: () => Promise<void>,
): Promise<void> {
  const results = await Promise.allSettled(snapshots.map(async ({ paneId, revision, text }) => {
    await write(paneId, text);
    saved.set(paneId, revision);
  }));
  const failures = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
  if (failures.length) throw new Error(failures.map((r) => String(r.reason)).join("; "));
  await prune();
}
