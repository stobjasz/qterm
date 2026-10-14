import { openUrl } from "@tauri-apps/plugin-opener";

import { useEscape } from "../tabs/useDismiss";
import { ACTION_LIST } from "../keybindings";

const GUIDE = "https://github.com/stobjasz/qterm/blob/master/docs/user-guide.md";

/** "ctrl+shift+t" → "Ctrl+Shift+T", "alt+left" → "Alt+←". */
export function chordLabel(chord: string): string {
  const names: Record<string, string> = { left: "←", right: "→", up: "↑", down: "↓", pageup: "PgUp", pagedown: "PgDn", space: "Space", enter: "Enter", tab: "Tab" };
  return chord
    .split("+")
    .map((part, i, all) => (part === "" && i === all.length - 1 ? "+" : names[part] ?? (part.length === 1 ? part.toUpperCase() : part[0].toUpperCase() + part.slice(1))))
    .filter((part, i, all) => !(part === "" && i < all.length - 1))
    .join("+");
}

/** The show / hide hotkey as people know it: "Backquote" → "~", "ScrollLock" → "Scroll Lock". */
export function hotkeyLabel(name: string): string {
  if (name === "Backquote" || name === "~" || name === "`") return "~";
  return name.replace(/([a-z])([A-Z])/g, "$1 $2");
}

/** Things done with the mouse that nothing on screen hints at. */
const GESTURES: [string, string][] = [
  ["Double-click a tab", "rename it"],
  ["Drag a tab", "move it"],
  ["Middle-click a tab", "close it"],
  ["Right-click a tab", "its colour and icon"],
  ["Shift+right-click a pane", "its background colour"],
  ["Right-click in a pane", "copy the selection, or paste"],
  ["Click a command's ✓/✗ bar", "copy or select its output, run it again"],
  ["Ctrl+click a link or file:line", "open it (browser, editor)"],
  ["Drop files from Explorer", "type their paths, quoted for the shell"],
  ["Drag the console's bottom edge", "its height (double-click: half the screen)"],
];

const TIPS: string[] = [
  "Ctrl+Shift+P finds anything: actions, tabs, shells, recent commands and folders, workspaces, snippets, Claude sessions.",
  "Alt+Shift+S labels every link, file, hash and IP on screen: type a label to copy it, Shift+label to open it.",
  "📌 keeps the console open while you work elsewhere.",
  "The ✳ menu has your Claude Code sessions, which panes are waiting for you, and your plan usage.",
  "Profiles, layouts, snippets and triggers live in the settings file (Settings → Open settings file).",
];

interface Props {
  /** The [keybindings] overrides, so the sheet shows the keys in effect. */
  overrides: Record<string, string>;
  /** The show / hide hotkey, as shown in the tray ("~"). */
  hotkey: string;
  onClose(): void;
}

/** "Shortcuts and tips": every shortcut in effect, the hidden gestures, a few tips. */
export function HelpSheet({ overrides, hotkey, onClose }: Props) {
  useEscape(onClose);
  const shortcuts = ACTION_LIST.map((a) => [a.label, overrides[a.name] ?? a.defaultChord] as const).filter(([, chord]) => chord);
  return (
    <section className="settings-panel help-sheet" role="dialog" aria-label="Shortcuts and tips" aria-modal="true">
      <header>
        <h2>Shortcuts and tips</h2>
        <button className="icon-button" aria-label="Close shortcuts and tips" title="Close (Esc)" onClick={onClose}>
          ×
        </button>
      </header>
      <div className="settings-body">
        <div className="help-columns">
          <section aria-label="Keyboard">
            <h3>Keyboard</h3>
            <dl>
              <div className="help-row">
                <dt>{hotkey}</dt>
                <dd>Show / hide the console</dd>
              </div>
              {shortcuts.map(([label, chord]) => (
                <div key={label} className="help-row">
                  <dt>{chordLabel(chord)}</dt>
                  <dd>{label}</dd>
                </div>
              ))}
              <div className="help-row">
                <dt>Ctrl+Shift+1…9</dt>
                <dd>New tab with shell 1…9</dd>
              </div>
              <div className="help-row">
                <dt>Ctrl+Alt+1…9</dt>
                <dd>Go to tab 1…9</dd>
              </div>
            </dl>
          </section>
          <section aria-label="Mouse">
            <h3>Mouse</h3>
            <dl>
              {GESTURES.map(([what, does]) => (
                <div key={what} className="help-row">
                  <dt>{what}</dt>
                  <dd>{does}</dd>
                </div>
              ))}
            </dl>
          </section>
          <section aria-label="Tips">
            <h3>Tips</h3>
            <ul>
              {TIPS.map((tip) => (
                <li key={tip}>{tip}</li>
              ))}
            </ul>
          </section>
        </div>
      </div>
      <footer>
        <span className="settings-hint">Change any shortcut in Settings → Keyboard shortcuts.</span>
        <button className="link-button" onClick={() => void openUrl(GUIDE)}>
          User guide
        </button>
        <button className="primary" onClick={onClose}>
          Close
        </button>
      </footer>
    </section>
  );
}
