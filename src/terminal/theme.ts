import type { ITerminalOptions } from "@xterm/xterm";

// The console's translucent background is painted by `.console` in App.css;
// the terminal itself draws a fully transparent background on top of it.
export const terminalOptions: ITerminalOptions = {
  allowTransparency: true,
  cursorBlink: true,
  fontFamily: '"Cascadia Mono", "Cascadia Code", Consolas, monospace',
  fontSize: 14,
  scrollback: 10_000,
  theme: {
    background: "rgba(0, 0, 0, 0)",
    foreground: "#d8dee9",
    cursor: "#e5c07b",
    selectionBackground: "rgba(229, 192, 123, 0.35)",
    scrollbarSliderBackground: "rgba(255, 255, 255, 0.12)",
    scrollbarSliderHoverBackground: "rgba(255, 255, 255, 0.22)",
    scrollbarSliderActiveBackground: "rgba(229, 192, 123, 0.45)",
  },
};
