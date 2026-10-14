import { describe, expect, it } from "vitest";

import { chordLabel, hotkeyLabel } from "./HelpSheet";

describe("shortcut labels", () => {
  it("writes chords the way Windows shows them", () => {
    expect(chordLabel("ctrl+shift+t")).toBe("Ctrl+Shift+T");
    expect(chordLabel("alt+shift+left")).toBe("Alt+Shift+←");
    expect(chordLabel("ctrl+,")).toBe("Ctrl+,");
    expect(chordLabel("ctrl+shift+/")).toBe("Ctrl+Shift+/");
    expect(chordLabel("f10")).toBe("F10");
    expect(chordLabel("ctrl+tab")).toBe("Ctrl+Tab");
  });

  it("names the hotkey as it's printed on the key", () => {
    expect(hotkeyLabel("Backquote")).toBe("~");
    expect(hotkeyLabel("ScrollLock")).toBe("Scroll Lock");
    expect(hotkeyLabel("F13")).toBe("F13");
  });
});
