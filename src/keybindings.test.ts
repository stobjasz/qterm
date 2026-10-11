import { describe, expect, it } from "vitest";

import { resolveKey, type KeyInput } from "./keybindings";

function key(code: string, mods: Partial<KeyInput> = {}): KeyInput {
  return { code, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, altGraph: false, ...mods };
}

describe("resolveKey", () => {
  it("maps tab management shortcuts", () => {
    expect(resolveKey(key("KeyT", { ctrlKey: true, shiftKey: true }))).toEqual({ type: "newTab" });
    expect(resolveKey(key("KeyW", { ctrlKey: true, shiftKey: true }))).toEqual({ type: "closePane" });
    expect(resolveKey(key("Tab", { ctrlKey: true }))).toEqual({ type: "cycleTab", delta: 1 });
    expect(resolveKey(key("Tab", { ctrlKey: true, shiftKey: true }))).toEqual({ type: "cycleTab", delta: -1 });
  });

  it("opens the Nth profile with Ctrl+Shift+N", () => {
    expect(resolveKey(key("Digit2", { ctrlKey: true, shiftKey: true }))).toEqual({ type: "newTab", profileIndex: 1 });
  });

  it("goes to the Nth tab with Ctrl+Alt+N", () => {
    expect(resolveKey(key("Digit1", { ctrlKey: true, altKey: true }))).toEqual({ type: "goToTab", index: 0 });
    expect(resolveKey(key("Digit9", { ctrlKey: true, altKey: true }))).toEqual({ type: "goToTab", index: 8 });
  });

  it("leaves AltGr combinations to the shell (AltGr reports as Ctrl+Alt)", () => {
    expect(resolveKey(key("Digit7", { ctrlKey: true, altKey: true, altGraph: true }))).toBeUndefined();
  });

  it("leaves shell keys alone", () => {
    expect(resolveKey(key("KeyC", { ctrlKey: true }))).toBeUndefined(); // SIGINT
    expect(resolveKey(key("KeyT", { ctrlKey: true }))).toBeUndefined();
    expect(resolveKey(key("Tab"))).toBeUndefined(); // completion
    expect(resolveKey(key("Digit1", { ctrlKey: true }))).toBeUndefined();
  });

  it("ignores the Windows key", () => {
    expect(resolveKey(key("KeyT", { ctrlKey: true, shiftKey: true, metaKey: true }))).toBeUndefined();
  });
});
