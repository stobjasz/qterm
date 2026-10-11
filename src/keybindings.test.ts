import { describe, expect, it } from "vitest";

import { buildKeymap, resolveKey, type KeyInput } from "./keybindings";

function key(code: string, mods: Partial<KeyInput> = {}): KeyInput {
  return { code, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, altGraph: false, ...mods };
}

const defaults = buildKeymap();

describe("default keymap", () => {
  it("has no errors", () => {
    expect(defaults.errors).toEqual([]);
  });

  it("maps tab management shortcuts", () => {
    expect(resolveKey(key("KeyT", { ctrlKey: true, shiftKey: true }), defaults)).toEqual({ type: "newTab" });
    expect(resolveKey(key("KeyW", { ctrlKey: true, shiftKey: true }), defaults)).toEqual({ type: "closePane" });
    expect(resolveKey(key("Tab", { ctrlKey: true }), defaults)).toEqual({ type: "cycleTab", delta: 1 });
    expect(resolveKey(key("Tab", { ctrlKey: true, shiftKey: true }), defaults)).toEqual({ type: "cycleTab", delta: -1 });
  });

  it("opens the Nth profile with Ctrl+Shift+N", () => {
    expect(resolveKey(key("Digit2", { ctrlKey: true, shiftKey: true }), defaults)).toEqual({
      type: "newTab",
      profileIndex: 1,
    });
  });

  it("goes to the Nth tab with Ctrl+Alt+N", () => {
    expect(resolveKey(key("Digit1", { ctrlKey: true, altKey: true }), defaults)).toEqual({ type: "goToTab", index: 0 });
    expect(resolveKey(key("Digit9", { ctrlKey: true, altKey: true }), defaults)).toEqual({ type: "goToTab", index: 8 });
  });

  it("maps pane shortcuts on Alt+Shift / Alt", () => {
    expect(resolveKey(key("Equal", { altKey: true, shiftKey: true }), defaults)).toEqual({ type: "split", dir: "row" });
    expect(resolveKey(key("Minus", { altKey: true, shiftKey: true }), defaults)).toEqual({
      type: "split",
      dir: "column",
    });
    expect(resolveKey(key("ArrowLeft", { altKey: true }), defaults)).toEqual({ type: "moveFocus", direction: "left" });
    expect(resolveKey(key("ArrowDown", { altKey: true }), defaults)).toEqual({ type: "moveFocus", direction: "down" });
    expect(resolveKey(key("ArrowUp", { altKey: true, shiftKey: true }), defaults)).toEqual({
      type: "resizePane",
      direction: "up",
    });
    expect(resolveKey(key("Digit0", { altKey: true, shiftKey: true }), defaults)).toEqual({ type: "equalize" });
  });

  it("maps clipboard, search and settings shortcuts", () => {
    expect(resolveKey(key("KeyC", { ctrlKey: true, shiftKey: true }), defaults)).toEqual({ type: "copy" });
    expect(resolveKey(key("KeyV", { ctrlKey: true, shiftKey: true }), defaults)).toEqual({ type: "paste" });
    expect(resolveKey(key("KeyF", { ctrlKey: true, shiftKey: true }), defaults)).toEqual({ type: "find" });
    expect(resolveKey(key("Comma", { ctrlKey: true }), defaults)).toEqual({ type: "settings" });
  });

  it("leaves AltGr combinations to the shell (AltGr reports as Ctrl+Alt)", () => {
    expect(resolveKey(key("Digit7", { ctrlKey: true, altKey: true, altGraph: true }), defaults)).toBeUndefined();
  });

  it("leaves shell keys alone", () => {
    expect(resolveKey(key("KeyC", { ctrlKey: true }), defaults)).toBeUndefined(); // SIGINT
    expect(resolveKey(key("KeyT", { ctrlKey: true }), defaults)).toBeUndefined();
    expect(resolveKey(key("Tab"), defaults)).toBeUndefined(); // completion
    expect(resolveKey(key("Digit1", { ctrlKey: true }), defaults)).toBeUndefined();
    expect(resolveKey(key("KeyB", { altKey: true }), defaults)).toBeUndefined(); // readline: word back
    expect(resolveKey(key("Equal", { altKey: true }), defaults)).toBeUndefined();
  });

  it("ignores the Windows key", () => {
    expect(resolveKey(key("KeyT", { ctrlKey: true, shiftKey: true, metaKey: true }), defaults)).toBeUndefined();
  });
});

describe("keybinding overrides", () => {
  it("rebinds an action and frees its default chord", () => {
    const keymap = buildKeymap({ new_tab: "ctrl+t" });
    expect(keymap.errors).toEqual([]);
    expect(resolveKey(key("KeyT", { ctrlKey: true }), keymap)).toEqual({ type: "newTab" });
    expect(resolveKey(key("KeyT", { ctrlKey: true, shiftKey: true }), keymap)).toBeUndefined();
  });

  it("accepts modifiers in any order and case, and key aliases", () => {
    const keymap = buildKeymap({ split_right: "Shift+Alt+Plus", focus_left: "ALT+LEFT" });
    expect(keymap.errors).toEqual([]);
    expect(resolveKey(key("Equal", { altKey: true, shiftKey: true }), keymap)).toEqual({ type: "split", dir: "row" });
  });

  it("unbinds with an empty string", () => {
    const keymap = buildKeymap({ equalize: "" });
    expect(resolveKey(key("Digit0", { altKey: true, shiftKey: true }), keymap)).toBeUndefined();
  });

  it("allows function keys without modifiers", () => {
    const keymap = buildKeymap({ new_tab: "f2" });
    expect(resolveKey(key("F2"), keymap)).toEqual({ type: "newTab" });
  });

  it("reports unknown actions and keys, and skips them", () => {
    const keymap = buildKeymap({ new_tabb: "ctrl+t", close_pane: "ctrl+shift+banana" });
    expect(keymap.errors).toEqual([
      'keybindings: unknown action "new_tabb"',
      'keybindings.close_pane: unknown key "banana" in "ctrl+shift+banana"',
    ]);
    // close_pane keeps its default when the override is invalid
    expect(resolveKey(key("KeyW", { ctrlKey: true, shiftKey: true }), keymap)).toEqual({ type: "closePane" });
  });

  it("rejects chords that would swallow normal typing", () => {
    const keymap = buildKeymap({ new_tab: "shift+t" });
    expect(keymap.errors).toEqual(['keybindings.new_tab: "shift+t" needs ctrl or alt (only F-keys work alone)']);
  });

  it("reports two actions on one chord", () => {
    const keymap = buildKeymap({ close_pane: "ctrl+shift+t" });
    expect(keymap.errors).toEqual(['keybindings: "ctrl+shift+t" is bound to both close_pane and new_tab']);
  });
});
