// Command marks (OSC 133, as Windows Terminal and VS Code use them): the shell
// integration reports where each prompt starts (A), where typing starts (B) and
// that a command ended (D, with its exit code when the shell knows it).

export type Mark = { kind: "A" } | { kind: "B" } | { kind: "C" } | { kind: "D"; exitCode?: number };

/** The payload of an OSC 133 sequence, e.g. "D;1" or "A"; undefined if not one we use. */
export function parseMark(data: string): Mark | undefined {
  const [kind, ...params] = data.split(";");
  switch (kind) {
    case "A":
    case "B":
    case "C":
      return { kind };
    case "D": {
      const code = params[0] === undefined || params[0] === "" ? undefined : Number(params[0]);
      return { kind: "D", exitCode: code === undefined || Number.isNaN(code) ? undefined : code };
    }
    default:
      return undefined;
  }
}

/** "2m 03s", "45s", "1h 02m"; under a second "0.4s". */
export function formatDuration(ms: number): string {
  if (ms < 950) return `${(Math.max(0, ms) / 1000).toFixed(1)}s`;
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h) return `${h}h ${String(m).padStart(2, "0")}m`;
  if (m) return `${m}m ${String(s).padStart(2, "0")}s`;
  return `${s}s`;
}

/** When something happened: "14:32" today (with seconds, "14:32:05", when asked), "Mon 14:32" this week, else the date. */
export function formatClock(ms: number, now: number, seconds = false): string {
  const at = new Date(ms);
  const time = at.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", ...(seconds ? { second: "2-digit" } : {}) });
  if (at.toDateString() === new Date(now).toDateString()) return time;
  const days = (now - ms) / 86_400_000;
  if (days >= 0 && days < 6) return `${at.toLocaleDateString(undefined, { weekday: "short" })} ${time}`;
  return at.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
