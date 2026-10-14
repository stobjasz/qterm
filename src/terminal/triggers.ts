// [[triggers]]: output patterns that highlight a line, mark the tab or notify.

export type TriggerAction = "notify" | "mark" | "highlight";

export interface TriggerDef {
  name?: string | null;
  pattern: string;
  regex: boolean;
  action: TriggerAction;
  color?: string | null;
}

export interface Trigger {
  /** What the tab marker and notification call it. */
  label: string;
  action: TriggerAction;
  color: string;
  test(line: string): boolean;
}

/** A dark amber that keeps any theme's text readable. */
export const HIGHLIGHT_COLOR = "#5c4b00";

/** The usable triggers, and a message for each one whose regular expression doesn't compile. */
export function compileTriggers(defs: readonly TriggerDef[]): { triggers: Trigger[]; errors: string[] } {
  const triggers: Trigger[] = [];
  const errors: string[] = [];
  for (const def of defs) {
    const label = def.name?.trim() || def.pattern;
    let test: (line: string) => boolean;
    if (def.regex) {
      let re: RegExp;
      try {
        re = new RegExp(def.pattern);
      } catch (e) {
        errors.push(`trigger "${label}": the pattern isn't a valid regular expression (${(e as Error).message})`);
        continue;
      }
      test = (line) => re.test(line);
    } else {
      const needle = def.pattern.toLowerCase();
      test = (line) => line.toLowerCase().includes(needle);
    }
    triggers.push({ label, action: def.action, color: def.color ?? HIGHLIGHT_COLOR, test });
  }
  return { triggers, errors };
}

/** The triggers a line sets off, in the order they're listed. */
export function matching(triggers: readonly Trigger[], line: string): Trigger[] {
  return line.trim() ? triggers.filter((t) => t.test(line)) : [];
}
