// The documentation keeps up with the shortcuts: every action can be looked up by
// name in the user guide and in the settings file's own comments.
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { ACTION_LIST } from "../src/keybindings";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("shortcut documentation", () => {
  const guide = read("../docs/user-guide.md");
  const defaults = read("../src-tauri/src/config/default.toml");

  it.each(ACTION_LIST.map((a) => [a.name, a.defaultChord]))("lists %s in the user guide and default.toml", (name, chord) => {
    expect(guide).toContain(`| \`${name}\` |`);
    expect(defaults).toMatch(new RegExp(`^#\\s+${name}\\s+= "${chord.replace(/[+]/g, "\\+")}"`, "m"));
  });
});
