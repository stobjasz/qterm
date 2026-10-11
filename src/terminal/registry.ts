// xterm.js instances live here, outside React. A pane component only parks the
// terminal's wrapper element in its container, so switching tabs or re-parenting
// a pane during a split never recreates a terminal or loses its scrollback.
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon, type ISearchOptions } from "@xterm/addon-search";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { openUrl } from "@tauri-apps/plugin-opener";
import { WebglAddon } from "@xterm/addon-webgl";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import "@xterm/xterm/css/xterm.css";

import { findResumeIds } from "../claude/detect";
import {
  onPtyExit,
  openInEditor,
  ptyAck,
  ptyKill,
  ptyResize,
  ptySpawn,
  ptyWrite,
  resolveFiles,
  type SessionId,
} from "../ipc";
import { buildKeymap, keyInput, resolveKey, type Command, type Keymap } from "../keybindings";
import type { PaneId } from "../workspace/workspace";
import { parseOsc7, parseOsc9 } from "./cwd";
import { findFileLinks } from "./links";
import { terminalOptions } from "./theme";
import { THEMES, withAlpha, xtermTheme, type Theme } from "./themes";

const RESIZE_DEBOUNCE_MS = 50;
/** Processed output is acknowledged in batches of at least this many bytes... */
const ACK_BATCH_BYTES = 64 * 1024;
/** ...or after this long, whichever comes first. Rust resumes reading at 128 KB unacked. */
const ACK_DELAY_MS = 20;
const COPY_ON_SELECT_DELAY_MS = 150;
/** New output is scanned for Claude session ids at most this often. */
const CLAUDE_SCAN_DELAY_MS = 300;
/** Never scan more than this many lines back in one go. */
const CLAUDE_SCAN_MAX_LINES = 2000;

export interface RegistryEvents {
  onCommand(paneId: PaneId, command: Command): void;
  onTitle(paneId: PaneId, title: string): void;
  onExit(paneId: PaneId, code: number): void;
  /** The shell reported its working directory (shell integration, OSC 7 / 9;9). */
  onCwd(paneId: PaneId, cwd: string): void;
  /** The terminal printed "claude --resume <id>" (only while detection is on). */
  onClaudeSession(paneId: PaneId, sessionId: string): void;
  onSearchResults(paneId: PaneId, results: { index: number; count: number }): void;
}

/** How to start a pane's shell. */
export interface PaneSpec {
  profileId: string;
  /** Start in this folder (else the profile's default). */
  cwd?: string;
  /** Typed into the shell once it has started, e.g. "claude --resume <id>\r". */
  startupInput?: string;
}

export interface Behavior {
  copyOnSelect: boolean;
  rightClickPaste: boolean;
  claudeSessions: boolean;
}

export interface FontSettings {
  family: string;
  size: number;
}

interface Entry {
  term: Terminal;
  fit: FitAddon;
  search: SearchAddon;
  wrapper: HTMLDivElement;
  spec: PaneSpec;
  /** Latest folder the shell reported; file links resolve against it. */
  cwd?: string;
  opened: boolean;
  sessionId?: SessionId;
  resizeTimer?: number;
  /** Output xterm.js has processed but Rust hasn't been told about yet. */
  pendingAck: number;
  ackTimer?: number;
  copyTimer?: number;
  /** Line feeds since the last scan for Claude session ids, and the ids already reported. */
  linesSinceScan: number;
  scanTimer?: number;
  claudeSeen: Set<string>;
}

const SEARCH_DECORATIONS = (theme: Theme): ISearchOptions["decorations"] => ({
  matchBackground: withAlpha(theme.accent, 0.25),
  activeMatchBackground: withAlpha(theme.accent, 0.6),
  matchOverviewRuler: theme.accent,
  activeMatchColorOverviewRuler: theme.accent,
});

export class TerminalRegistry {
  private entries = new Map<PaneId, Entry>();
  private keymap: Keymap = buildKeymap();
  private font: FontSettings = { family: terminalOptions.fontFamily!, size: terminalOptions.fontSize! };
  private theme: Theme = THEMES.qterm;
  private behavior: Behavior = { copyOnSelect: false, rightClickPaste: true, claudeSessions: false };

  constructor(private events: RegistryEvents) {
    void onPtyExit(({ id, code }) => {
      for (const [paneId, entry] of this.entries) {
        if (entry.sessionId !== id) continue;
        entry.sessionId = undefined;
        entry.term.write(`\r\n\x1b[90m[process exited with code ${code}]\x1b[0m\r\n`);
        this.events.onExit(paneId, code);
      }
    });
  }

  /** Parks the pane's terminal in `host`, creating it and its shell on first use. */
  attach(paneId: PaneId, spec: PaneSpec, host: HTMLElement): void {
    const entry = this.entries.get(paneId) ?? this.create(paneId, spec);
    if (entry.wrapper.parentElement !== host) host.appendChild(entry.wrapper);
    if (!entry.opened) this.open(paneId, entry);
    this.fit(paneId);
  }

  /** Recomputes rows/cols for the pane's current size. Skipped while hidden (zero size). */
  fit(paneId: PaneId): void {
    const entry = this.entries.get(paneId);
    if (!entry?.opened || entry.wrapper.clientWidth === 0) return;
    entry.fit.fit();
  }

  focus(paneId: PaneId): void {
    this.entries.get(paneId)?.term.focus();
  }

  dispose(paneId: PaneId): void {
    const entry = this.entries.get(paneId);
    if (!entry) return;
    this.entries.delete(paneId);
    for (const timer of [entry.resizeTimer, entry.ackTimer, entry.copyTimer, entry.scanTimer]) {
      window.clearTimeout(timer);
    }
    if (entry.sessionId !== undefined) void ptyKill(entry.sessionId);
    entry.term.dispose();
    entry.wrapper.remove();
  }

  disposeAll(): void {
    for (const paneId of [...this.entries.keys()]) this.dispose(paneId);
  }

  setKeymap(keymap: Keymap): void {
    this.keymap = keymap;
  }

  /** Applies to open terminals (re-fitting them) and to terminals created later. */
  setFont(font: FontSettings): void {
    if (font.family === this.font.family && font.size === this.font.size) return;
    this.font = font;
    for (const [paneId, entry] of this.entries) {
      entry.term.options.fontFamily = font.family;
      entry.term.options.fontSize = font.size;
      this.fit(paneId);
    }
  }

  setTheme(theme: Theme): void {
    if (theme === this.theme) return;
    this.theme = theme;
    for (const entry of this.entries.values()) entry.term.options.theme = xtermTheme(theme);
  }

  setBehavior(behavior: Behavior): void {
    const enablingClaude = behavior.claudeSessions && !this.behavior.claudeSessions;
    this.behavior = behavior;
    // Only output printed from now on counts, not whatever is already in the scrollback.
    if (enablingClaude) for (const entry of this.entries.values()) entry.linesSinceScan = 0;
  }

  /** Copies the selection; returns false when nothing is selected. */
  copy(paneId: PaneId): boolean {
    const selection = this.entries.get(paneId)?.term.getSelection();
    if (!selection) return false;
    void writeText(selection);
    return true;
  }

  async paste(paneId: PaneId): Promise<void> {
    const entry = this.entries.get(paneId);
    const text = entry && (await readText().catch(() => ""));
    // term.paste wraps it in bracketed-paste markers when the shell asked for them.
    if (entry && text) entry.term.paste(text);
  }

  /** Finds the next (or previous) match; results arrive through onSearchResults. */
  find(paneId: PaneId, query: string, options: { caseSensitive: boolean; regex: boolean }, backwards = false): void {
    const entry = this.entries.get(paneId);
    if (!entry) return;
    const opts: ISearchOptions = { ...options, decorations: SEARCH_DECORATIONS(this.theme) };
    if (!query) entry.search.clearDecorations();
    else if (backwards) entry.search.findPrevious(query, opts);
    else entry.search.findNext(query, opts);
  }

  clearSearch(paneId: PaneId): void {
    const entry = this.entries.get(paneId);
    entry?.search.clearDecorations();
    entry?.term.clearSelection();
  }

  private processed(entry: Entry, bytes: number): void {
    entry.pendingAck += bytes;
    if (entry.pendingAck >= ACK_BATCH_BYTES) this.flushAck(entry);
    else if (entry.ackTimer === undefined) entry.ackTimer = window.setTimeout(() => this.flushAck(entry), ACK_DELAY_MS);
  }

  private flushAck(entry: Entry): void {
    window.clearTimeout(entry.ackTimer);
    entry.ackTimer = undefined;
    if (entry.sessionId === undefined || entry.pendingAck === 0) return;
    void ptyAck(entry.sessionId, entry.pendingAck);
    entry.pendingAck = 0;
  }

  private create(paneId: PaneId, spec: PaneSpec): Entry {
    const wrapper = document.createElement("div");
    wrapper.className = "terminal-wrapper";
    const term = new Terminal({
      ...terminalOptions,
      fontFamily: this.font.family,
      fontSize: this.font.size,
      theme: xtermTheme(this.theme),
    });
    const entry: Entry = {
      term,
      fit: new FitAddon(),
      search: new SearchAddon(),
      wrapper,
      spec,
      cwd: spec.cwd,
      opened: false,
      pendingAck: 0,
      linesSinceScan: 0,
      claudeSeen: new Set(),
    };
    this.entries.set(paneId, entry);
    return entry;
  }

  // xterm measures glyphs on open, so this waits until the wrapper is in the document.
  private open(paneId: PaneId, entry: Entry): void {
    const { term, fit, search } = entry;
    term.loadAddon(fit);
    term.loadAddon(search);
    // Unicode 11 widths: emoji and symbols (Claude Code's UI is full of them) take
    // the cells the shell expects, so lines don't drift.
    term.loadAddon(new Unicode11Addon());
    term.unicode.activeVersion = "11";
    // Ctrl+click, like Windows Terminal and VS Code: a plain click still selects text.
    term.loadAddon(new WebLinksAddon((event, uri) => event.ctrlKey && void openUrl(uri)));
    this.wireFileLinks(entry);
    term.open(entry.wrapper);
    loadWebgl(term);
    entry.opened = true;
    if (entry.wrapper.clientWidth > 0) fit.fit();

    term.attachCustomKeyEventHandler((e) => {
      const command = resolveKey(keyInput(e), this.keymap);
      if (!command) return true;
      e.preventDefault(); // e.g. keep Ctrl+Tab from moving DOM focus
      if (e.type === "keydown") this.events.onCommand(paneId, command);
      return false;
    });
    term.onData((data) => {
      if (entry.sessionId !== undefined) void ptyWrite(entry.sessionId, data);
    });
    term.onTitleChange((title) => this.events.onTitle(paneId, title));
    term.onResize(({ cols, rows }) => {
      window.clearTimeout(entry.resizeTimer);
      entry.resizeTimer = window.setTimeout(() => {
        if (entry.sessionId !== undefined) void ptyResize(entry.sessionId, cols, rows);
      }, RESIZE_DEBOUNCE_MS);
    });
    search.onDidChangeResults(({ resultIndex, resultCount }) =>
      this.events.onSearchResults(paneId, { index: resultIndex, count: resultCount }),
    );
    this.wireClipboard(paneId, entry);
    this.wireCwd(paneId, entry);
    term.onLineFeed(() => {
      if (!this.behavior.claudeSessions) return;
      entry.linesSinceScan++;
      entry.scanTimer ??= window.setTimeout(() => this.scanForClaude(paneId, entry), CLAUDE_SCAN_DELAY_MS);
    });

    // Acknowledge only after xterm has parsed the data, so a slow renderer slows the shell.
    let pendingInput = entry.spec.startupInput;
    const onOutput = (data: Uint8Array) =>
      term.write(data, () => {
        this.processed(entry, data.length);
        // The shell has started talking, so it is up: type the startup input now.
        if (pendingInput && entry.sessionId !== undefined) {
          void ptyWrite(entry.sessionId, pendingInput);
          pendingInput = undefined;
        }
      });
    ptySpawn(paneId, entry.spec.profileId, term.cols, term.rows, entry.spec.cwd, onOutput)
      .then((id) => {
        // The pane may have been closed while the shell was starting.
        if (this.entries.get(paneId) !== entry) return void ptyKill(id);
        entry.sessionId = id;
        this.flushAck(entry); // output may have arrived before the id did
      })
      .catch((err) => term.write(`\r\n\x1b[31mqterm: could not start shell: ${err}\x1b[0m\r\n`));
  }

  private wireClipboard(paneId: PaneId, entry: Entry): void {
    const { term } = entry;
    // Like Windows Terminal: right-click copies the selection, or pastes without one.
    entry.wrapper.addEventListener("contextmenu", (e) => {
      if (!this.behavior.rightClickPaste) return;
      e.preventDefault();
      if (this.copy(paneId)) term.clearSelection();
      else void this.paste(paneId);
    });
    term.onSelectionChange(() => {
      if (!this.behavior.copyOnSelect || !term.hasSelection()) return;
      window.clearTimeout(entry.copyTimer);
      entry.copyTimer = window.setTimeout(() => this.copy(paneId), COPY_ON_SELECT_DELAY_MS);
    });
  }

  /** Ctrl+click on "src/app.ts:42" opens it in the editor; only existing files are links. */
  private wireFileLinks(entry: Entry): void {
    const { term } = entry;
    term.registerLinkProvider({
      provideLinks: (y, callback) => {
        const text = term.buffer.active.getLine(y - 1)?.translateToString(true) ?? "";
        const found = findFileLinks(text);
        if (found.length === 0) return callback(undefined);
        resolveFiles(
          found.map((f) => f.path),
          entry.cwd,
        ).then(
          (resolved) =>
            callback(
              found.flatMap((link, i) => {
                const file = resolved[i];
                if (!file) return [];
                return [
                  {
                    range: { start: { x: link.start + 1, y }, end: { x: link.end, y } },
                    text: text.slice(link.start, link.end),
                    decorations: { underline: true, pointerCursor: true },
                    activate: (event: MouseEvent) => {
                      if (event.ctrlKey) void openInEditor(file, link.line, link.col);
                    },
                  },
                ];
              }),
            ),
          () => callback(undefined),
        );
      },
    });
  }

  private wireCwd(paneId: PaneId, entry: Entry): void {
    const report = (cwd: string | undefined) => {
      if (cwd) {
        entry.cwd = cwd;
        this.events.onCwd(paneId, cwd);
      }
      return cwd !== undefined;
    };
    entry.term.parser.registerOscHandler(7, (data) => report(parseOsc7(data)));
    // Return false for other OSC 9 uses so xterm's own handling still applies.
    entry.term.parser.registerOscHandler(9, (data) => report(parseOsc9(data)));
  }

  /** Looks for "claude --resume <id>" in the lines printed since the last scan. */
  private scanForClaude(paneId: PaneId, entry: Entry): void {
    entry.scanTimer = undefined;
    // Claude Code prints its resume hint after leaving the alternate screen, if it used one.
    const buffer = entry.term.buffer.normal;
    const last = buffer.baseY + buffer.cursorY;
    // +2: a line may have been half-written at the previous scan.
    const span = Math.min(entry.linesSinceScan + 2, CLAUDE_SCAN_MAX_LINES);
    entry.linesSinceScan = 0;
    let text = "";
    for (let y = Math.max(0, last - span); y <= last; y++) {
      const line = buffer.getLine(y);
      if (line) text += (line.isWrapped ? "" : "\n") + line.translateToString(true);
    }
    for (const id of findResumeIds(text)) {
      if (entry.claudeSeen.has(id)) continue;
      entry.claudeSeen.add(id);
      this.events.onClaudeSession(paneId, id);
    }
  }
}

// WebGL is much faster for heavy output; the DOM renderer is the fallback when
// WebGL2 is unavailable or the GPU context is lost.
function loadWebgl(term: Terminal): void {
  try {
    const webgl = new WebglAddon();
    webgl.onContextLoss(() => webgl.dispose());
    term.loadAddon(webgl);
  } catch (err) {
    console.warn("qterm: WebGL renderer unavailable, using DOM renderer", err);
  }
}
