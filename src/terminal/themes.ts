// Built-in colour themes. A theme colours the terminal (ANSI palette, text,
// cursor), the translucent console behind it (`background` + the opacity setting)
// and the chrome (accent line, tabs, menus).
import type { ITheme } from "@xterm/xterm";

export interface Theme {
  label: string;
  background: string;
  foreground: string;
  cursor: string;
  accent: string;
  /** black, red, green, yellow, blue, magenta, cyan, white, then the bright eight. */
  ansi: readonly string[];
  light?: boolean;
}

const ONE_DARK_ANSI = [
  "#282c34", "#e06c75", "#98c379", "#e5c07b", "#61afef", "#c678dd", "#56b6c2", "#abb2bf",
  "#5c6370", "#e06c75", "#98c379", "#e5c07b", "#61afef", "#c678dd", "#56b6c2", "#ffffff",
];

const SOLARIZED_ANSI = [
  "#073642", "#dc322f", "#859900", "#b58900", "#268bd2", "#d33682", "#2aa198", "#eee8d5",
  "#002b36", "#cb4b16", "#586e75", "#657b83", "#839496", "#6c71c4", "#93a1a1", "#fdf6e3",
];

export const THEMES: Record<string, Theme> = {
  qterm: {
    label: "qterm",
    background: "#0e1016",
    foreground: "#d8dee9",
    cursor: "#e5c07b",
    accent: "#e5c07b",
    ansi: ONE_DARK_ANSI,
  },
  campbell: {
    label: "Campbell (Windows Terminal)",
    background: "#0c0c0c",
    foreground: "#cccccc",
    cursor: "#ffffff",
    accent: "#3b78ff",
    ansi: [
      "#0c0c0c", "#c50f1f", "#13a10e", "#c19c00", "#0037da", "#881798", "#3a96dd", "#cccccc",
      "#767676", "#e74856", "#16c60c", "#f9f1a5", "#3b78ff", "#b4009e", "#61d6d6", "#f2f2f2",
    ],
  },
  "one-dark": {
    label: "One Dark",
    background: "#282c34",
    foreground: "#abb2bf",
    cursor: "#528bff",
    accent: "#61afef",
    ansi: ONE_DARK_ANSI,
  },
  dracula: {
    label: "Dracula",
    background: "#282a36",
    foreground: "#f8f8f2",
    cursor: "#f8f8f2",
    accent: "#bd93f9",
    ansi: [
      "#21222c", "#ff5555", "#50fa7b", "#f1fa8c", "#bd93f9", "#ff79c6", "#8be9fd", "#f8f8f2",
      "#6272a4", "#ff6e6e", "#69ff94", "#ffffa5", "#d6acff", "#ff92df", "#a4ffff", "#ffffff",
    ],
  },
  nord: {
    label: "Nord",
    background: "#2e3440",
    foreground: "#d8dee9",
    cursor: "#d8dee9",
    accent: "#88c0d0",
    ansi: [
      "#3b4252", "#bf616a", "#a3be8c", "#ebcb8b", "#81a1c1", "#b48ead", "#88c0d0", "#e5e9f0",
      "#4c566a", "#bf616a", "#a3be8c", "#ebcb8b", "#81a1c1", "#b48ead", "#8fbcbb", "#eceff4",
    ],
  },
  "gruvbox-dark": {
    label: "Gruvbox Dark",
    background: "#282828",
    foreground: "#ebdbb2",
    cursor: "#ebdbb2",
    accent: "#fabd2f",
    ansi: [
      "#282828", "#cc241d", "#98971a", "#d79921", "#458588", "#b16286", "#689d6a", "#a89984",
      "#928374", "#fb4934", "#b8bb26", "#fabd2f", "#83a598", "#d3869b", "#8ec07c", "#ebdbb2",
    ],
  },
  "tokyo-night": {
    label: "Tokyo Night",
    background: "#1a1b26",
    foreground: "#c0caf5",
    cursor: "#c0caf5",
    accent: "#7aa2f7",
    ansi: [
      "#15161e", "#f7768e", "#9ece6a", "#e0af68", "#7aa2f7", "#bb9af7", "#7dcfff", "#a9b1d6",
      "#414868", "#f7768e", "#9ece6a", "#e0af68", "#7aa2f7", "#bb9af7", "#7dcfff", "#c0caf5",
    ],
  },
  "solarized-dark": {
    label: "Solarized Dark",
    background: "#002b36",
    foreground: "#839496",
    cursor: "#93a1a1",
    accent: "#b58900",
    ansi: SOLARIZED_ANSI,
  },
  "solarized-light": {
    label: "Solarized Light",
    background: "#fdf6e3",
    foreground: "#586e75",
    cursor: "#586e75",
    accent: "#268bd2",
    ansi: SOLARIZED_ANSI,
    light: true,
  },
};

export const DEFAULT_THEME = "qterm";

export function themeOrDefault(name: string | undefined): Theme {
  return THEMES[name ?? DEFAULT_THEME] ?? THEMES[DEFAULT_THEME];
}

const ANSI_KEYS = [
  "black", "red", "green", "yellow", "blue", "magenta", "cyan", "white",
  "brightBlack", "brightRed", "brightGreen", "brightYellow", "brightBlue", "brightMagenta", "brightCyan", "brightWhite",
] as const;

/** The xterm.js theme. Its background stays transparent: the console paints it. */
export function xtermTheme(theme: Theme): ITheme {
  const palette = Object.fromEntries(ANSI_KEYS.map((key, i) => [key, theme.ansi[i]]));
  return {
    ...palette,
    background: "rgba(0, 0, 0, 0)",
    foreground: theme.foreground,
    cursor: theme.cursor,
    cursorAccent: theme.background,
    selectionBackground: withAlpha(theme.accent, 0.35),
    scrollbarSliderBackground: withAlpha(theme.foreground, 0.12),
    scrollbarSliderHoverBackground: withAlpha(theme.foreground, 0.22),
    scrollbarSliderActiveBackground: withAlpha(theme.accent, 0.45),
  };
}

/** "#rrggbb" + alpha → "rgba(r, g, b, a)". */
export function withAlpha(hex: string, alpha: number): string {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
