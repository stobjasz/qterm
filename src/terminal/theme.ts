import type { ITerminalOptions } from "@xterm/xterm";

// Colours come from the selected theme (themes.ts), applied by the registry.
export const terminalOptions: ITerminalOptions = {
  allowTransparency: true,
  // Needed by the search addon's match highlighting (decorations).
  allowProposedApi: true,
  cursorBlink: true,
  fontFamily: '"Cascadia Mono", "Cascadia Code", Consolas, monospace',
  fontSize: 14,
  scrollback: 10_000,
};
