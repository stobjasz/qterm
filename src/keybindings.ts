// App shortcuts, checked before a key reaches the shell. Defaults follow Windows
// Terminal; the [keybindings] table in config.toml overrides them by action name.
import type { Direction, SplitDir } from "./workspace/layout";

export type Command =
  | { type: "newTab"; profileIndex?: number }
  | { type: "closePane" }
  | { type: "cycleTab"; delta: number }
  | { type: "goToTab"; index: number }
  | { type: "split"; dir: SplitDir }
  | { type: "moveFocus"; direction: Direction }
  | { type: "resizePane"; direction: Direction }
  | { type: "equalize" }
  | { type: "copy" }
  | { type: "paste" }
  | { type: "find" }
  | { type: "settings" }
  | { type: "zoomPane" }
  | { type: "toggleBroadcast" }
  | { type: "swapPane"; direction: Direction }
  | { type: "commandPalette" }
  | { type: "clearHistory" }
  | { type: "scrollToCommand"; direction: -1 | 1 }
  | { type: "copyLastOutput" }
  | { type: "searchAll" }
  | { type: "paneBackground" };

const ACTIONS = {
  new_tab: { command: { type: "newTab" }, chord: "ctrl+shift+t" },
  close_pane: { command: { type: "closePane" }, chord: "ctrl+shift+w" },
  next_tab: { command: { type: "cycleTab", delta: 1 }, chord: "ctrl+tab" },
  prev_tab: { command: { type: "cycleTab", delta: -1 }, chord: "ctrl+shift+tab" },
  split_right: { command: { type: "split", dir: "row" }, chord: "alt+shift+=" },
  split_down: { command: { type: "split", dir: "column" }, chord: "alt+shift+-" },
  equalize: { command: { type: "equalize" }, chord: "alt+shift+0" },
  focus_left: { command: { type: "moveFocus", direction: "left" }, chord: "alt+left" },
  focus_right: { command: { type: "moveFocus", direction: "right" }, chord: "alt+right" },
  focus_up: { command: { type: "moveFocus", direction: "up" }, chord: "alt+up" },
  focus_down: { command: { type: "moveFocus", direction: "down" }, chord: "alt+down" },
  resize_left: { command: { type: "resizePane", direction: "left" }, chord: "alt+shift+left" },
  resize_right: { command: { type: "resizePane", direction: "right" }, chord: "alt+shift+right" },
  resize_up: { command: { type: "resizePane", direction: "up" }, chord: "alt+shift+up" },
  resize_down: { command: { type: "resizePane", direction: "down" }, chord: "alt+shift+down" },
  copy: { command: { type: "copy" }, chord: "ctrl+shift+c" },
  paste: { command: { type: "paste" }, chord: "ctrl+shift+v" },
  find: { command: { type: "find" }, chord: "ctrl+shift+f" },
  settings: { command: { type: "settings" }, chord: "ctrl+," },
  command_palette: { command: { type: "commandPalette" }, chord: "ctrl+shift+p" },
  zoom_pane: { command: { type: "zoomPane" }, chord: "alt+shift+z" },
  toggle_broadcast: { command: { type: "toggleBroadcast" }, chord: "alt+shift+b" },
  // Unbound by default (good combos are scarce); bind in settings or use the palette.
  swap_left: { command: { type: "swapPane", direction: "left" }, chord: "" },
  swap_right: { command: { type: "swapPane", direction: "right" }, chord: "" },
  swap_up: { command: { type: "swapPane", direction: "up" }, chord: "" },
  swap_down: { command: { type: "swapPane", direction: "down" }, chord: "" },
  clear_history: { command: { type: "clearHistory" }, chord: "" },
  // Command marks need shell integration (PowerShell, cmd, Git Bash).
  prev_command: { command: { type: "scrollToCommand", direction: -1 }, chord: "ctrl+up" },
  next_command: { command: { type: "scrollToCommand", direction: 1 }, chord: "ctrl+down" },
  copy_last_output: { command: { type: "copyLastOutput" }, chord: "" },
  search_all: { command: { type: "searchAll" }, chord: "alt+shift+f" },
  // Also Shift+right-click on the pane.
  pane_background: { command: { type: "paneBackground" }, chord: "" },
} satisfies Record<string, { command: Command; chord: string }>;

type Action = keyof typeof ACTIONS;

const LABELS: Record<Action, string> = {
  new_tab: "New tab",
  close_pane: "Close pane",
  next_tab: "Next tab",
  prev_tab: "Previous tab",
  split_right: "Split right",
  split_down: "Split down",
  equalize: "Equalize panes",
  focus_left: "Focus pane left",
  focus_right: "Focus pane right",
  focus_up: "Focus pane up",
  focus_down: "Focus pane down",
  resize_left: "Resize pane left",
  resize_right: "Resize pane right",
  resize_up: "Resize pane up",
  resize_down: "Resize pane down",
  copy: "Copy",
  paste: "Paste",
  find: "Find",
  settings: "Settings",
  command_palette: "Command palette",
  zoom_pane: "Zoom pane",
  toggle_broadcast: "Type into all panes of the tab",
  swap_left: "Swap pane left",
  swap_right: "Swap pane right",
  swap_up: "Swap pane up",
  swap_down: "Swap pane down",
  clear_history: "Clear pane history",
  prev_command: "Scroll to previous command",
  next_command: "Scroll to next command",
  copy_last_output: "Copy last command's output",
  search_all: "Search all panes",
  pane_background: "Pane background…",
};

/** Every rebindable action with its config name, label, command and default chord. */
export const ACTION_LIST = (Object.keys(ACTIONS) as Action[]).map((name) => ({
  name,
  label: LABELS[name],
  command: ACTIONS[name].command as Command,
  defaultChord: ACTIONS[name].chord as string,
}));

/** The parts of a KeyboardEvent that matter; `altGraph` is getModifierState("AltGraph"). */
export interface KeyInput {
  code: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  altGraph: boolean;
}

export interface Keymap {
  /** Normalized chord ("ctrl+shift+KeyT") → command. */
  chords: Map<string, Command>;
  /** Problems in the overrides; the affected actions keep their defaults. */
  errors: string[];
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

export function buildKeymap(overrides: Record<string, string> = {}): Keymap {
  const errors: string[] = [];
  const chordOf = new Map<Action, string | undefined>();
  for (const action of Object.keys(ACTIONS) as Action[]) {
    const chord: string = ACTIONS[action].chord;
    chordOf.set(action, chord ? parseChord(chord).chord : undefined);
  }

  for (const [name, text] of Object.entries(overrides)) {
    if (!(name in ACTIONS)) {
      errors.push(`keybindings: unknown action "${name}"`);
      continue;
    }
    if (text.trim() === "") {
      chordOf.set(name as Action, undefined);
      continue;
    }
    const parsed = parseChord(text);
    if (parsed.error) errors.push(`keybindings.${name}: ${parsed.error}`);
    else chordOf.set(name as Action, parsed.chord);
  }

  const chords = new Map<string, Command>();
  const owner = new Map<string, Action>();
  // Overridden actions first, so an override wins a clash with another action's default.
  const order = [...chordOf.keys()].sort((a, b) => Number(b in overrides) - Number(a in overrides));
  for (const action of order) {
    const chord = chordOf.get(action);
    if (!chord) continue;
    const taken = owner.get(chord);
    if (taken) {
      errors.push(`keybindings: "${overrides[taken] ?? overrides[action]}" is bound to both ${taken} and ${action}`);
      continue;
    }
    owner.set(chord, action);
    chords.set(chord, ACTIONS[action].command);
  }
  return { chords, errors };
}

export function resolveKey(k: KeyInput, keymap: Keymap): Command | undefined {
  // AltGr arrives as Ctrl+Alt and types characters on many layouts (e.g. { on German AltGr+7).
  if (k.metaKey || k.altGraph) return undefined;
  const chord = [k.ctrlKey && "ctrl", k.altKey && "alt", k.shiftKey && "shift", k.code].filter(Boolean).join("+");
  const bound = keymap.chords.get(chord);
  if (bound) return bound;

  // Fixed numbered shortcuts: Ctrl+Alt+N goes to tab N, Ctrl+Shift+N opens profile N.
  const digit = /^Digit([1-9])$/.exec(k.code);
  if (!digit || !k.ctrlKey) return undefined;
  const n = Number(digit[1]) - 1;
  if (k.altKey && !k.shiftKey) return { type: "goToTab", index: n };
  if (k.shiftKey && !k.altKey) return { type: "newTab", profileIndex: n };
  return undefined;
}

const KEY_ALIASES: Record<string, string> = {
  tab: "Tab",
  left: "ArrowLeft",
  right: "ArrowRight",
  up: "ArrowUp",
  down: "ArrowDown",
  "=": "Equal",
  equal: "Equal",
  plus: "Equal",
  "-": "Minus",
  minus: "Minus",
  "`": "Backquote",
  "~": "Backquote",
  backquote: "Backquote",
  pageup: "PageUp",
  pagedown: "PageDown",
  home: "Home",
  end: "End",
  insert: "Insert",
  delete: "Delete",
  space: "Space",
  enter: "Enter",
  ",": "Comma",
  ".": "Period",
  "/": "Slash",
  "\\": "Backslash",
  "[": "BracketLeft",
  "]": "BracketRight",
  ";": "Semicolon",
  "'": "Quote",
};

/** "Shift+Alt+Plus" → "alt+shift+Equal"; modifiers in a fixed order, key as a KeyboardEvent.code. */
function parseChord(text: string): { chord?: string; error?: string } {
  const parts = text.toLowerCase().split("+").map((p) => p.trim());
  // "ctrl++" means ctrl and the "+" key, which sits on Equal.
  if (text.trim().endsWith("++")) parts.splice(parts.length - 2, 2, "plus");
  const mods = new Set<string>();
  let code: string | undefined;
  for (const part of parts) {
    if (part === "ctrl" || part === "control") mods.add("ctrl");
    else if (part === "alt") mods.add("alt");
    else if (part === "shift") mods.add("shift");
    else if (code) return { error: `"${text}" has more than one key` };
    else {
      code = keyCode(part);
      if (!code) return { error: `unknown key "${part}" in "${text}"` };
    }
  }
  if (!code) return { error: `"${text}" has no key` };
  if (!mods.has("ctrl") && !mods.has("alt") && !/^F\d+$/.test(code)) {
    return { error: `"${text}" needs ctrl or alt (only F-keys work alone)` };
  }
  return { chord: [...["ctrl", "alt", "shift"].filter((m) => mods.has(m)), code].join("+") };
}

function keyCode(name: string): string | undefined {
  if (/^[a-z]$/.test(name)) return `Key${name.toUpperCase()}`;
  if (/^[0-9]$/.test(name)) return `Digit${name}`;
  if (/^f([1-9]|1[0-9]|2[0-4])$/.test(name)) return name.toUpperCase();
  return KEY_ALIASES[name];
}
