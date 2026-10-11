// App shortcuts, checked before a key reaches the shell. Defaults follow Windows Terminal.

export type Command =
  | { type: "newTab"; profileIndex?: number }
  | { type: "closePane" }
  | { type: "cycleTab"; delta: number }
  | { type: "goToTab"; index: number };

/** The parts of a KeyboardEvent that matter; `altGraph` is getModifierState("AltGraph"). */
export interface KeyInput {
  code: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  altGraph: boolean;
}

export function keyInput(e: KeyboardEvent): KeyInput {
  return {
    code: e.code,
    ctrlKey: e.ctrlKey,
    shiftKey: e.shiftKey,
    altKey: e.altKey,
    metaKey: e.metaKey,
    altGraph: e.getModifierState("AltGraph"),
  };
}

// Physical keys (`code`), so bindings don't move with the keyboard layout.
export function resolveKey(k: KeyInput): Command | undefined {
  // AltGr arrives as Ctrl+Alt and types characters on many layouts (e.g. { on German AltGr+7).
  if (k.metaKey || k.altGraph || !k.ctrlKey) return undefined;
  const digit = /^Digit([1-9])$/.exec(k.code);

  if (k.shiftKey && !k.altKey) {
    if (k.code === "KeyT") return { type: "newTab" };
    if (k.code === "KeyW") return { type: "closePane" };
    if (k.code === "Tab") return { type: "cycleTab", delta: -1 };
    if (digit) return { type: "newTab", profileIndex: Number(digit[1]) - 1 };
  }
  if (!k.shiftKey && !k.altKey && k.code === "Tab") return { type: "cycleTab", delta: 1 };
  if (k.altKey && !k.shiftKey && digit) return { type: "goToTab", index: Number(digit[1]) - 1 };
  return undefined;
}
