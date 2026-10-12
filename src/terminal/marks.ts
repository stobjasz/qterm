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

/** "2m 03s", "45s", "1h 02m". */
export function formatDuration(ms: number): string {
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h) return `${h}h ${String(m).padStart(2, "0")}m`;
  if (m) return `${m}m ${String(s).padStart(2, "0")}s`;
  return `${s}s`;
}
