import { describe, expect, it } from "vitest";

import defaultToml from "../../src-tauri/src/config/default.toml?raw";
import { THEMES, themeOrDefault, withAlpha, xtermTheme } from "./themes";

const HEX = /^#[0-9a-f]{6}$/;

describe("themes", () => {
  it.each(Object.entries(THEMES))("%s has a full, valid palette", (_, theme) => {
    expect(theme.ansi).toHaveLength(16);
    for (const color of [...theme.ansi, theme.background, theme.foreground, theme.cursor, theme.accent]) {
      expect(color).toMatch(HEX);
    }
  });

  it("the documented settings file names every built-in theme", () => {
    for (const name of Object.keys(THEMES)) expect(defaultToml).toContain(`"${name}"`);
  });

  it("keeps the terminal background transparent so the console tint shows", () => {
    const theme = xtermTheme(THEMES.dracula);
    expect(theme.background).toBe("rgba(0, 0, 0, 0)");
    expect(theme.red).toBe("#ff5555");
    expect(theme.brightWhite).toBe("#ffffff");
  });

  it("falls back to the default for unknown names", () => {
    expect(themeOrDefault("nope")).toBe(THEMES.qterm);
    expect(themeOrDefault(undefined)).toBe(THEMES.qterm);
  });

  it("converts hex to rgba", () => {
    expect(withAlpha("#e5c07b", 0.5)).toBe("rgba(229, 192, 123, 0.5)");
  });
});
