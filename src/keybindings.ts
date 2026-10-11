// App shortcuts, checked before a key reaches the shell. Defaults follow Windows Terminal.
import type { Direction, SplitDir } from "./workspace/layout";

export type Command =
  | { type: "newTab"; profileIndex?: number }
  | { type: "closePane" }
  | { type: "cycleTab"; delta: number }
  | { type: "goToTab"; index: number }
  | { type: "split"; dir: SplitDir }
  | { type: "moveFocus"; direction: Direction }
  | { type: "resizePane"; direction: Direction }
  | { type: "equalize" };

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

const ARROWS: Record<string, Direction> = {
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "up",
  ArrowDown: "down",
};

// Physical keys (`code`), so bindings don't move with the keyboard layout.
export function resolveKey(k: KeyInput): Command | undefined {
  // AltGr arrives as Ctrl+Alt and types characters on many layouts (e.g. { on German AltGr+7).
  if (k.metaKey || k.altGraph) return undefined;
  return k.ctrlKey ? resolveCtrl(k) : k.altKey ? resolveAlt(k) : undefined;
}

function resolveCtrl(k: KeyInput): Command | undefined {
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

function resolveAlt(k: KeyInput): Command | undefined {
  const arrow = ARROWS[k.code];
  if (!k.shiftKey) return arrow ? { type: "moveFocus", direction: arrow } : undefined;
  if (k.code === "Equal") return { type: "split", dir: "row" };
  if (k.code === "Minus") return { type: "split", dir: "column" };
  if (k.code === "Digit0") return { type: "equalize" };
  if (arrow) return { type: "resizePane", direction: arrow };
  return undefined;
}
