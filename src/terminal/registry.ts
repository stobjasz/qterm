// xterm.js instances live here, outside React. A pane component only parks the
// terminal's wrapper element in its container, so switching tabs or re-parenting
// a pane during a split never recreates a terminal or loses its scrollback.
import { Terminal, type IDecoration, type IMarker } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon, type ISearchOptions } from "@xterm/addon-search";
import { SerializeAddon } from "@xterm/addon-serialize";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { openUrl } from "@tauri-apps/plugin-opener";
import { WebglAddon } from "@xterm/addon-webgl";
import { ImageAddon } from "@xterm/addon-image";
import { LigaturesAddon } from "@xterm/addon-ligatures";
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
import { hasContent, plainLines } from "./content";
import { parseOsc7, parseOsc9 } from "./cwd";
import { formatClock, formatDuration, parseMark } from "./marks";
import { findDevServerUrl } from "./devServer";
import { matching, type Trigger } from "./triggers";
import { findInLines, SEARCH_ALL_LIMIT, type SearchHit, type SearchOptions } from "./searchAll";
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
/** Startup input for a shell with prompt marks waits for its prompt, but not longer than this... */
const STARTUP_PROMPT_WAIT_MS = 10_000;
/** ...and for one without, until its output has been quiet this long. */
const STARTUP_QUIET_MS = 500;
/** A shell ringing over and over reports one bell per this interval. */
const BELL_INTERVAL_MS = 1000;

export interface RegistryEvents {
  onCommand(paneId: PaneId, command: Command): void;
  onTitle(paneId: PaneId, title: string): void;
  onExit(paneId: PaneId, code: number): void;
  /** The shell reported its working directory (shell integration, OSC 7 / 9;9). */
  onCwd(paneId: PaneId, cwd: string): void;
  /** The terminal printed "claude --resume <id>" (only while detection is on). */
  onClaudeSession(paneId: PaneId, sessionId: string): void;
  onSearchResults(paneId: PaneId, results: { index: number; count: number }): void;
  /** First output since the pane went into the background (see setBackground). */
  onActivity(paneId: PaneId): void;
  onBell(paneId: PaneId): void;
  /** Shift+right-click on the pane, at page position (x, y). */
  onPaneMenu(paneId: PaneId, x: number, y: number): void;
  /** A command the user ran ended (shell integration marks). */
  onCommandFinished(paneId: PaneId, finished: FinishedCommand): void;
  /** A click on a command's ✓/✗ bar, at page position (x, y). */
  onCommandBlock(paneId: PaneId, block: CommandBlock, x: number, y: number): void;
  /** A line matched a mark / notify trigger (at most every TRIGGER_REPEAT_MS per trigger and pane). */
  onTrigger(paneId: PaneId, trigger: Trigger, line: string): void;
  /**
   * The user pasted (Ctrl+Shift+V, right-click, the browser's paste) this clipboard
   * text, "" when it holds none (an image, say). Nothing reaches the pane until the
   * handler calls pasteText.
   */
  onPaste(paneId: PaneId, text: string): void;
  /** A program printed the local address it serves on (a dev server), once per address until the command ends. */
  onDevServer(paneId: PaneId, url: string, port: number): void;
}

/** One trigger in one pane fires at most this often: a chatty build can't flood you. */
const TRIGGER_REPEAT_MS = 3000;

/** A finished command, as its bar's menu sees it (see blockOutput, selectBlock). */
export interface CommandBlock {
  /** Its prompt marker's id. */
  id: number;
  command: string;
  exitCode?: number;
  hasOutput: boolean;
  /** Date.now() of the Enter that ran it, and how long it ran. */
  startedAt?: number;
  durationMs?: number;
}

export interface FinishedCommand {
  command: string;
  /** Undefined when the shell doesn't say (cmd). */
  exitCode?: number;
  durationMs: number;
  /** Date.now() of the Enter that ran it. */
  startedAt: number;
}

/** A line on screen (wrapped rows joined) and where each of its characters is. */
export interface ScreenLine {
  text: string;
  /** Per UTF-16 unit of `text`: its row in the viewport and its column. */
  cells: { row: number; col: number }[];
}

/** See TerminalRegistry.screen. */
export interface ScreenText {
  lines: ScreenLine[];
  /** The cell grid's top-left corner on the page, and one cell's size, in CSS pixels. */
  left: number;
  top: number;
  cellWidth: number;
  cellHeight: number;
}

/** Most recent commands remembered per pane; older ones lose their marks. */
const MAX_MARKS = 500;

/** One prompt and the command typed at it, from OSC 133 marks. */
interface CommandMark {
  /** Where the prompt starts (A). */
  prompt: IMarker;
  /** Where typing starts (B), and its column. */
  input?: IMarker;
  inputCol: number;
  /** Date.now() of the Enter that ran it. */
  startedAt?: number;
  /** Where it ended (D): output is between the command line and this. */
  end?: IMarker;
  /** Date.now() when it ended. */
  finishedAt?: number;
  exitCode?: number;
  command?: string;
  decoration?: IDecoration;
}

/** How to start a pane's shell. */
export interface PaneSpec {
  profileId: string;
  /** Start in this folder (else the profile's default). */
  cwd?: string;
  /** Typed into the shell once it has started, e.g. "claude --resume <id>\r". */
  startupInput?: string;
  /**
   * The shell marks its prompt (shell integration): startup input waits for it. Typed
   * any earlier, it can reach the console before the shell reads input, and be lost.
   */
  marksPrompt?: boolean;
  /** The profile's own look, instead of the global theme / font size. */
  theme?: Theme;
  fontSize?: number;
  /** Output saved before the last restart, shown above the new shell. */
  restored?: string;
  /** Run as administrator (Windows' sudo, inline). */
  elevated?: boolean;
}

export interface Behavior {
  copyOnSelect: boolean;
  rightClickPaste: boolean;
  claudeSessions: boolean;
  /** Sixel, iTerm (IIP) and Kitty images. */
  inlineImages: boolean;
  /** Needs a font with ligatures (Cascadia Code, Fira Code, ...). */
  ligatures: boolean;
}

export interface FontSettings {
  family: string;
  size: number;
}

interface Entry {
  term: Terminal;
  fit: FitAddon;
  search: SearchAddon;
  serialize: SerializeAddon;
  wrapper: HTMLDivElement;
  spec: PaneSpec;
  /** Latest folder the shell reported; file links resolve against it. */
  cwd?: string;
  opened: boolean;
  /** Its shell has been started (see start). */
  started: boolean;
  sessionId?: SessionId;
  resizeTimer?: number;
  /** Output xterm.js has processed but Rust hasn't been told about yet. */
  pendingAck: number;
  ackTimer?: number;
  copyTimer?: number;
  /** Line feeds since the last scan for Claude session ids, and the ids already reported. */
  linesSinceScan: number;
  /** Date.now() each trigger last fired here (by label). */
  triggerTimes: Map<string, number>;
  /** Dev server addresses reported since the last command ended. */
  devUrls: Set<string>;
  scanTimer?: number;
  claudeSeen: Set<string>;
  /** In a background tab, and output has been reported since. */
  background: boolean;
  activityReported: boolean;
  lastBell: number;
  /** Date.now() of the latest output (busy/idle status). */
  lastOutput: number;
  /** Startup input not typed yet, and the timer that types it if the prompt doesn't come. */
  startupInput?: string;
  startupTimer?: number;
  /** Input produced before the shell's session id was known, e.g. the reply to ConPTY's cursor query. */
  earlyInput: string[];
  /** Lines sent to the shell (Enter, pasted lines, startup input) since it started. */
  commands: number;
  /** Prompts and commands, oldest first (needs shell integration). */
  marks: CommandMark[];
  webgl?: WebglAddon;
  images?: ImageAddon;
  ligatures?: LigaturesAddon;
  /** Settles once restored output is on screen (or right away without any). */
  ready: Promise<void>;
  markReady(): void;
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
  private triggers: readonly Trigger[] = [];

  /** Triggers of the project a pane is in (its .qterm.toml), on top of the settings' own. */
  private paneTriggers = new Map<PaneId, readonly Trigger[]>();

  /** [[triggers]], compiled (triggers.ts). */
  setTriggers(triggers: readonly Trigger[]): void {
    this.triggers = triggers;
  }

  /** The pane's own extra triggers (none: an empty list). */
  setPaneTriggers(paneId: PaneId, triggers: readonly Trigger[]): void {
    if (triggers.length) this.paneTriggers.set(paneId, triggers);
    else this.paneTriggers.delete(paneId);
  }

  private behavior: Behavior = { copyOnSelect: false, rightClickPaste: true, claudeSessions: false, inlineImages: true, ligatures: false };
  /** Pane → every pane its typing goes to (broadcasting tabs only). */
  private broadcast = new Map<PaneId, PaneId[]>();

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
    this.start(paneId, entry);
  }

  focus(paneId: PaneId): void {
    this.entries.get(paneId)?.term.focus();
  }

  dispose(paneId: PaneId): void {
    const entry = this.entries.get(paneId);
    if (!entry) return;
    this.entries.delete(paneId);
    this.paneTriggers.delete(paneId);
    for (const timer of [entry.resizeTimer, entry.ackTimer, entry.copyTimer, entry.scanTimer, entry.startupTimer]) {
      window.clearTimeout(timer);
    }
    if (entry.sessionId !== undefined) void ptyKill(entry.sessionId);
    entry.term.dispose();
    entry.wrapper.remove();
  }

  disposeAll(): void {
    for (const paneId of [...this.entries.keys()]) this.dispose(paneId);
  }

  /** Panes of broadcasting tabs, each mapped to all panes of its tab. */
  setBroadcast(groups: Map<PaneId, PaneId[]>): void {
    this.broadcast = groups;
  }

  /**
   * Panes in background tabs. Each reports its first output (onActivity) once;
   * coming to the foreground resets that.
   */
  setBackground(background: ReadonlySet<PaneId>): void {
    for (const [paneId, entry] of this.entries) {
      entry.background = background.has(paneId);
      if (!entry.background) entry.activityReported = false;
    }
  }

  /**
   * What the pane shows right now (either screen), as lines of text with wrapped rows
   * joined, each character's row and column on screen, and where the cells are on the
   * page: what quick select labels.
   */
  screen(paneId: PaneId): ScreenText | undefined {
    const entry = this.entries.get(paneId);
    const screenEl = entry?.term.element?.querySelector(".xterm-screen");
    if (!entry || !screenEl) return undefined;
    const { term } = entry;
    const buffer = term.buffer.active;
    const box = screenEl.getBoundingClientRect();
    const lines: ScreenLine[] = [];
    for (let row = 0; row < term.rows; row++) {
      const line = buffer.getLine(buffer.viewportY + row);
      if (!line) continue;
      const current = line.isWrapped && lines.length ? lines[lines.length - 1] : undefined;
      const target = current ?? { text: "", cells: [] };
      for (let col = 0; col < term.cols; col++) {
        const cell = line.getCell(col);
        if (!cell || cell.getWidth() === 0) continue; // the second half of a wide character
        const chars = cell.getChars() || " ";
        target.text += chars;
        for (let i = 0; i < chars.length; i++) target.cells.push({ row, col });
      }
      if (!current) lines.push(target);
    }
    return { lines, left: box.left, top: box.top, cellWidth: box.width / term.cols, cellHeight: box.height / term.rows };
  }

  /** Everything the pane shows and keeps (normal screen), as plain text; wrapped lines joined. */
  plainText(paneId: PaneId): string | undefined {
    const buffer = this.entries.get(paneId)?.term.buffer.normal;
    if (!buffer) return undefined;
    const lines: string[] = [];
    for (let y = 0; y < buffer.length; y++) {
      const line = buffer.getLine(y);
      if (!line) continue;
      const text = line.translateToString(true);
      if (line.isWrapped && lines.length) lines[lines.length - 1] += text;
      else lines.push(text);
    }
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    return lines.join("\r\n") + "\r\n";
  }

  /** The pane's output as an HTML page, colours included. */
  html(paneId: PaneId): string | undefined {
    return this.entries.get(paneId)?.serialize.serializeAsHTML({ includeGlobalBackground: true });
  }

  /** The pane's output (normal screen, colours included), last `lines` rows. */
  serialize(paneId: PaneId, lines: number): string | undefined {
    return this.entries.get(paneId)?.serialize.serialize({ scrollback: lines, excludeAltBuffer: true, excludeModes: true });
  }

  /**
   * Whether the pane's output is worth keeping across a restart: something was run
   * in it (or it brought back earlier output) and it shows more than prompts and
   * banners. Undefined until its shell has started (a restored tab not yet shown).
   */
  worthSaving(paneId: PaneId): boolean | undefined {
    const entry = this.entries.get(paneId);
    if (!entry?.started) return undefined;
    if (entry.commands === 0 && !entry.spec.restored) return false;
    const buffer = entry.term.buffer.normal;
    function* lines() {
      for (let y = 0; y < buffer.length; y++) yield buffer.getLine(y)?.translateToString(true) ?? "";
    }
    return hasContent(lines());
  }

  /** The pane's PTY session, once its shell is running. */
  sessionOf(paneId: PaneId): SessionId | undefined {
    return this.entries.get(paneId)?.sessionId;
  }

  /** Date.now() of the pane's latest output, 0 if none. */
  lastOutput(paneId: PaneId): number {
    return this.entries.get(paneId)?.lastOutput ?? 0;
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
      entry.term.options.fontSize = entry.spec.fontSize ?? font.size;
      this.fit(paneId);
    }
  }

  setTheme(theme: Theme): void {
    if (theme === this.theme) return;
    this.theme = theme;
    for (const entry of this.entries.values()) {
      if (!entry.spec.theme) entry.term.options.theme = xtermTheme(theme);
    }
  }

  setBehavior(behavior: Behavior): void {
    const enablingClaude = behavior.claudeSessions && !this.behavior.claudeSessions;
    const previous = this.behavior;
    this.behavior = behavior;
    for (const entry of this.entries.values()) {
      if (!entry.opened) continue;
      if (behavior.ligatures !== previous.ligatures) this.applyLigatures(entry);
      if (behavior.inlineImages !== previous.inlineImages) this.applyImages(entry);
    }
    // Only output printed from now on counts, not whatever is already in the scrollback.
    if (enablingClaude) for (const entry of this.entries.values()) entry.linesSinceScan = 0;
  }

  /**
   * Clears the pane's history like Windows Terminal's "Clear buffer": scrollback and
   * screen, keeping the line with the cursor. Nothing is left worth saving.
   */
  clearHistory(paneId: PaneId): void {
    const entry = this.entries.get(paneId);
    if (!entry) return;
    entry.term.clear();
    entry.commands = 0;
    entry.spec.restored = undefined;
  }

  /**
   * Matches in every pane's output, pane by pane. A restored pane whose tab hasn't
   * been shown yet has no shell or buffer, so its saved output is searched instead.
   */
  searchAll(query: string, options: SearchOptions): SearchHit[] {
    const hits: SearchHit[] = [];
    for (const [paneId, entry] of this.entries) {
      const lines = entry.started ? bufferLines(entry.term) : entry.spec.restored ? plainLines(entry.spec.restored) : [];
      const found = findInLines(lines, query, options);
      for (let index = 0; index < found.length && hits.length < SEARCH_ALL_LIMIT; index++) {
        hits.push({ paneId, index, ...found[index], text: lines[found[index].line] });
      }
      if (hits.length >= SEARCH_ALL_LIMIT) break;
    }
    return hits;
  }

  /** Scrolls to a pane's `index`-th match and selects it, once the pane's output is there. */
  async revealMatch(paneId: PaneId, index: number, query: string, options: SearchOptions): Promise<void> {
    const entry = this.entries.get(paneId);
    if (!entry) return;
    await entry.ready;
    const found = findInLines(bufferLines(entry.term), query, options);
    const match = found[Math.min(index, found.length - 1)];
    if (!match) return;
    const { term } = entry;
    term.scrollToLine(Math.max(0, match.line - Math.floor(term.rows / 3)));
    term.select(match.col, match.line, match.length);
    term.focus();
  }

  /** A command typed at the latest prompt is still running (known with shell integration only). */
  commandRunning(paneId: PaneId): boolean {
    const marks = this.entries.get(paneId)?.marks ?? [];
    const last = marks[marks.length - 1];
    return Boolean(last && last.startedAt !== undefined && !last.end);
  }

  /** Scrolls to the previous (-1) or next (1) command's prompt; past the last one, to the bottom. */
  scrollToCommand(paneId: PaneId, direction: -1 | 1): void {
    const entry = this.entries.get(paneId);
    if (!entry) return;
    const { term } = entry;
    const top = term.buffer.active.viewportY;
    const lines = entry.marks.map((m) => m.prompt.line).filter((line) => line >= 0);
    const above = lines.filter((line) => line < top);
    const target = direction < 0 ? above[above.length - 1] : lines.find((line) => line > top);
    if (target !== undefined) term.scrollToLine(target);
    else if (direction < 0) term.scrollToTop();
    else term.scrollToBottom();
  }

  /** Copies the output of the last finished command; false when there is none. */
  copyLastOutput(paneId: PaneId): boolean {
    const text = this.lastCommandOutput(paneId);
    if (!text) return false;
    void writeText(text);
    return true;
  }

  /** The output of the last finished command ("" when there is none). */
  lastCommandOutput(paneId: PaneId): string {
    const entry = this.entries.get(paneId);
    const mark = entry?.marks.filter((m) => m.end && m.input && m.end.line >= 0 && m.input.line >= 0).pop();
    return entry && mark ? outputOf(entry.term, mark) : "";
  }

  /** The selected text ("" when nothing is selected). */
  selection(paneId: PaneId): string {
    return this.entries.get(paneId)?.term.getSelection() ?? "";
  }

  /** A full-screen program (an editor, a TUI) has the pane: the alternate screen is up. */
  fullScreen(paneId: PaneId): boolean {
    return this.entries.get(paneId)?.term.buffer.active.type === "alternate";
  }

  /** The output of the command whose prompt marker has this id ("" if gone or none). */
  blockOutput(paneId: PaneId, id: number): string {
    const entry = this.entries.get(paneId);
    const mark = entry?.marks.find((m) => m.prompt.id === id);
    return entry && mark ? outputOf(entry.term, mark) : "";
  }

  /** Selects that command's output on screen (the selection can then be copied). */
  selectBlock(paneId: PaneId, id: number): boolean {
    const entry = this.entries.get(paneId);
    const mark = entry?.marks.find((m) => m.prompt.id === id);
    const range = entry && mark ? outputRange(entry.term, mark) : undefined;
    if (!entry || !range) return false;
    entry.term.selectLines(range.start, range.end);
    entry.term.scrollToLine(range.start);
    return true;
  }

  /** Copies the selection; returns false when nothing is selected. */
  copy(paneId: PaneId): boolean {
    const selection = this.entries.get(paneId)?.term.getSelection();
    if (!selection) return false;
    void writeText(selection);
    return true;
  }

  /** Pastes the clipboard as the user asked for it (see RegistryEvents.onPaste). */
  async paste(paneId: PaneId): Promise<void> {
    if (!this.entries.has(paneId)) return;
    const text = await readText().catch(() => "");
    this.events.onPaste(paneId, text ?? "");
  }

  /**
   * Types a snippet: pasted (so a multi-line one isn't run line by line), then Enter
   * as a keystroke of its own when `run`, since a bracketed paste never runs.
   */
  typeSnippet(paneId: PaneId, command: string, run: boolean): void {
    const term = this.entries.get(paneId)?.term;
    if (!term) return;
    term.paste(command);
    if (run) term.input("\r", true);
  }

  /** Types `text` as a paste: broadcast like typing, and bracketed when the shell asked for it. */
  pasteText(paneId: PaneId, text: string): void {
    this.entries.get(paneId)?.term.paste(text);
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
    let markReady = () => {};
    const ready = new Promise<void>((resolve) => (markReady = resolve));
    const wrapper = document.createElement("div");
    wrapper.className = "terminal-wrapper";
    const term = new Terminal({
      ...terminalOptions,
      fontFamily: this.font.family,
      fontSize: spec.fontSize ?? this.font.size,
      theme: xtermTheme(spec.theme ?? this.theme),
    });
    const entry: Entry = {
      term,
      fit: new FitAddon(),
      search: new SearchAddon(),
      serialize: new SerializeAddon(),
      wrapper,
      spec,
      cwd: spec.cwd,
      opened: false,
      started: false,
      pendingAck: 0,
      linesSinceScan: 0,
      triggerTimes: new Map(),
      devUrls: new Set(),
      claudeSeen: new Set(),
      background: false,
      activityReported: false,
      lastBell: 0,
      lastOutput: 0,
      earlyInput: [],
      commands: 0,
      marks: [],
      ready,
      markReady,
    };
    this.entries.set(paneId, entry);
    return entry;
  }

  // xterm measures glyphs on open, so this waits until the wrapper is in the document.
  private open(paneId: PaneId, entry: Entry): void {
    const { term, fit, search } = entry;
    term.loadAddon(fit);
    term.loadAddon(search);
    term.loadAddon(entry.serialize);
    // Unicode 11 widths: emoji and symbols (Claude Code's UI is full of them) take
    // the cells the shell expects, so lines don't drift.
    term.loadAddon(new Unicode11Addon());
    term.unicode.activeVersion = "11";
    // Ctrl+click, like Windows Terminal and VS Code: a plain click still selects text.
    term.loadAddon(new WebLinksAddon((event, uri) => event.ctrlKey && void openUrl(uri)));
    this.wireFileLinks(entry);
    term.open(entry.wrapper);
    // Ligatures first: the WebGL renderer builds its glyph atlas with them in mind.
    if (this.behavior.ligatures) entry.ligatures = loadAddon(term, () => new LigaturesAddon());
    entry.webgl = loadWebgl(term);
    if (this.behavior.inlineImages) entry.images = loadAddon(term, () => new ImageAddon());
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
      // A broadcasting tab sends keystrokes to every pane in it.
      for (const target of this.broadcast.get(paneId) ?? [paneId]) {
        const targetEntry = this.entries.get(target);
        if (targetEntry && data.includes("\r")) {
          targetEntry.commands++;
          // Enter at a prompt starts the command typed there (its duration counts from now).
          const mark = targetEntry.marks[targetEntry.marks.length - 1];
          if (mark?.input && mark.startedAt === undefined) mark.startedAt = Date.now();
        }
        const session = targetEntry?.sessionId;
        if (session !== undefined) void ptyWrite(session, data);
        else if (target === paneId) entry.earlyInput.push(data);
      }
    });
    term.onBell(() => {
      const now = Date.now();
      if (now - entry.lastBell < BELL_INTERVAL_MS) return;
      entry.lastBell = now;
      this.events.onBell(paneId);
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
    term.parser.registerOscHandler(133, (data) => {
      this.onMark(paneId, entry, data);
      return true;
    });
    term.onLineFeed(() => {
      // Only the shell's own output: not the restored lines written before it started.
      if (entry.sessionId !== undefined) {
        if (this.triggers.length || this.paneTriggers.has(paneId)) this.checkTriggers(paneId, entry);
        this.checkDevServer(paneId, entry);
      }
      if (!this.behavior.claudeSessions) return;
      entry.linesSinceScan++;
      entry.scanTimer ??= window.setTimeout(() => this.scanForClaude(paneId, entry), CLAUDE_SCAN_DELAY_MS);
    });

    // A restored pane in a tab that isn't showing has no size yet. Its old output and
    // its shell wait for the first real fit: at the 80x24 placeholder, the jump to the
    // real size makes ConPTY repaint over the restored lines.
    if (!entry.spec.restored || entry.wrapper.clientWidth > 0) this.start(paneId, entry);
  }

  /** Shows any restored output, then starts the pane's shell. Runs once per pane. */
  private start(paneId: PaneId, entry: Entry): void {
    if (entry.started) return;
    entry.started = true;
    const { term } = entry;
    entry.startupInput = entry.spec.startupInput;
    // Acknowledge only after xterm has parsed the data, so a slow renderer slows the shell.
    const onOutput = (data: Uint8Array) =>
      term.write(data, () => {
        this.processed(entry, data.length);
        entry.lastOutput = Date.now();
        if (entry.background && !entry.activityReported) {
          entry.activityReported = true;
          this.events.onActivity(paneId);
        }
        // Without prompt marks: type the startup input once the shell has gone quiet,
        // waiting for input (ConPTY's own first output comes before the shell is up).
        if (entry.startupInput && !entry.spec.marksPrompt) {
          window.clearTimeout(entry.startupTimer);
          entry.startupTimer = window.setTimeout(() => this.typeStartupInput(entry), STARTUP_QUIET_MS);
        }
      });
    // Earlier output first: ConPTY asks where the cursor is and starts the shell there.
    (entry.spec.restored ? showRestored(term, entry.spec.restored) : Promise.resolve())
      .then(() => {
        entry.markReady();
        return ptySpawn(paneId, entry.spec.profileId, term.cols, term.rows, entry.spec.cwd, onOutput, entry.spec.elevated);
      })
      .then((id) => {
        // The pane may have been closed while the shell was starting.
        if (this.entries.get(paneId) !== entry) return void ptyKill(id);
        entry.sessionId = id;
        this.flushAck(entry); // output may have arrived before the id did
        for (const data of entry.earlyInput.splice(0)) void ptyWrite(id, data);
        // With prompt marks, the first prompt types it (onMark); this is the safety net.
        // (The prompt may already have come, before the id did.)
        if (entry.startupInput && entry.spec.marksPrompt) {
          if (entry.marks.some((m) => m.input)) this.typeStartupInput(entry);
          else entry.startupTimer = window.setTimeout(() => this.typeStartupInput(entry), STARTUP_PROMPT_WAIT_MS);
        }
      })
      .catch((err) => term.write(`\r\n\x1b[31mqterm: could not start shell: ${err}\x1b[0m\r\n`));
  }

  /** Types the pane's startup input (once), now that its shell reads input. */
  private typeStartupInput(entry: Entry): void {
    window.clearTimeout(entry.startupTimer);
    entry.startupTimer = undefined;
    if (!entry.startupInput || entry.sessionId === undefined) return;
    void ptyWrite(entry.sessionId, entry.startupInput);
    entry.commands++;
    entry.startupInput = undefined;
  }

  /** Turns ligatures on or off for an open terminal; the renderer is reloaded after. */
  private applyLigatures(entry: Entry): void {
    entry.webgl?.dispose();
    entry.ligatures?.dispose();
    entry.ligatures = this.behavior.ligatures ? loadAddon(entry.term, () => new LigaturesAddon()) : undefined;
    entry.webgl = loadWebgl(entry.term);
  }

  private applyImages(entry: Entry): void {
    entry.images?.dispose();
    entry.images = this.behavior.inlineImages ? loadAddon(entry.term, () => new ImageAddon()) : undefined;
  }

  /**
   * The line that just ended (wrapped rows joined) against the triggers: highlight it,
   * or report it. Full-screen programs (the alternate screen) redraw all the time and
   * don't count.
   */
  private checkTriggers(paneId: PaneId, entry: Entry): void {
    const { term } = entry;
    if (term.buffer.active.type !== "normal") return;
    const line = lastLine(term);
    if (!line) return;
    const { text, start, end, cursor } = line;
    const now = Date.now();
    const triggers = [...this.triggers, ...(this.paneTriggers.get(paneId) ?? [])];
    for (const trigger of matching(triggers, text)) {
      if (trigger.action === "highlight") {
        const marker = term.registerMarker(start - cursor);
        if (marker) term.registerDecoration({ marker, width: term.cols, height: end - start + 1, backgroundColor: trigger.color, layer: "bottom" });
        continue;
      }
      if (now - (entry.triggerTimes.get(trigger.label) ?? 0) < TRIGGER_REPEAT_MS) continue;
      entry.triggerTimes.set(trigger.label, now);
      this.events.onTrigger(paneId, trigger, text.trim());
    }
  }

  /** A local server address in the line that just ended (either screen: dev tools draw dashboards too). */
  private checkDevServer(paneId: PaneId, entry: Entry): void {
    const line = lastLine(entry.term);
    if (!line?.text.includes("://")) return;
    const found = findDevServerUrl(line.text);
    if (!found || entry.devUrls.has(found.url)) return;
    entry.devUrls.add(found.url);
    this.events.onDevServer(paneId, found.url, found.port);
  }

  /** OSC 133: A = prompt, B = typing starts, D = the command ended. */
  private onMark(paneId: PaneId, entry: Entry, data: string): void {
    const mark = parseMark(data);
    if (!mark) return;
    const { term } = entry;
    const last = entry.marks[entry.marks.length - 1];
    switch (mark.kind) {
      case "A": {
        const prompt = term.registerMarker(0);
        if (!prompt) return;
        entry.marks.push({ prompt, inputCol: 0 });
        for (const old of entry.marks.splice(0, Math.max(0, entry.marks.length - MAX_MARKS))) disposeMark(old);
        return;
      }
      case "B":
        if (last && !last.input) {
          last.input = term.registerMarker(0);
          last.inputCol = term.buffer.active.cursorX;
        }
        // The first prompt waits for typing: the startup input can go now.
        if (entry.startupInput) this.typeStartupInput(entry);
        return;
      case "C":
        return;
      case "D": {
        // D comes before the next prompt's A, so it closes the latest prompt, if a
        // command was run there.
        if (!last?.input || last.startedAt === undefined || last.end) return;
        const command = commandAt(term, last);
        if (!command) {
          // Enter on an empty prompt: nothing ran.
          entry.marks.pop();
          disposeMark(last);
          return;
        }
        last.end = term.registerMarker(0);
        last.exitCode = mark.exitCode;
        last.command = command;
        last.finishedAt = Date.now();
        const startedAt = last.startedAt;
        const durationMs = last.finishedAt - startedAt;
        last.decoration = decorate(term, last, (x, y) =>
          this.events.onCommandBlock(paneId, { id: last.prompt.id, command, exitCode: mark.exitCode, hasOutput: outputOf(term, last) !== "", startedAt, durationMs }, x, y),
        );
        // Its server, if it ran one, has stopped: a later run may announce the same address again.
        entry.devUrls.clear();
        this.events.onCommandFinished(paneId, { command, exitCode: mark.exitCode, durationMs, startedAt });
        return;
      }
    }
  }

  private wireClipboard(paneId: PaneId, entry: Entry): void {
    const { term } = entry;
    // The browser's own paste (into xterm's textarea) goes the same way as Ctrl+Shift+V.
    // Captured on the wrapper, so it never reaches xterm's handler.
    entry.wrapper.addEventListener(
      "paste",
      (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.events.onPaste(paneId, e.clipboardData?.getData("text/plain") ?? "");
      },
      true,
    );
    // Like Windows Terminal: right-click copies the selection, or pastes without one.
    entry.wrapper.addEventListener("contextmenu", (e) => {
      // Shift+right-click: the pane's own menu (its background) instead.
      if (e.shiftKey) {
        e.preventDefault();
        this.events.onPaneMenu(paneId, e.clientX, e.clientY);
        return;
      }
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
function loadWebgl(term: Terminal): WebglAddon | undefined {
  try {
    const webgl = new WebglAddon();
    webgl.onContextLoss(() => webgl.dispose());
    term.loadAddon(webgl);
    return webgl;
  } catch (err) {
    console.warn("qterm: WebGL renderer unavailable, using DOM renderer", err);
    return undefined;
  }
}

/** Loads an optional addon; one that fails is left out rather than breaking the pane. */
function loadAddon<T extends { dispose(): void }>(term: Terminal, make: () => T): T | undefined {
  try {
    const addon = make();
    term.loadAddon(addon as never);
    return addon;
  } catch (err) {
    console.warn("qterm: addon unavailable", err);
    return undefined;
  }
}

/**
 * Puts output saved before a restart above the new shell: the old text, then a dim
 * divider on the line after its last text. Resolves once both are on screen; the
 * shell starts after that, and ConPTY (PSEUDOCONSOLE_INHERIT_CURSOR) asks where the
 * cursor is, so the new prompt appears right under the divider with the old output
 * still in view.
 */
function showRestored(term: Terminal, saved: string): Promise<void> {
  const when = new Date().toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  return new Promise((resolve) => {
    term.write(`${saved}\x1b[0m`, () => {
      // The saved screen ends with the cursor where the program left it, which may be
      // mid-screen (an editor, Claude Code's input box): go below the last text instead.
      const buffer = term.buffer.active;
      const cursor = buffer.baseY + buffer.cursorY;
      let last = buffer.length - 1;
      while (last > cursor && !buffer.getLine(last)?.translateToString(true).trim()) last--;
      const down = last > cursor ? `\x1b[${last - cursor}B` : "";
      term.write(`${down}\r\n\x1b[90m──── restored ${when} ────\x1b[0m\r\n`, resolve);
    });
  });
}

/** The command typed at a prompt: from where typing started, over wrapped lines. */
function commandAt(term: Terminal, mark: CommandMark): string {
  const buffer = term.buffer.active;
  const start = mark.input?.line ?? -1;
  if (start < 0) return "";
  let text = buffer.getLine(start)?.translateToString(true, mark.inputCol) ?? "";
  for (let line = start + 1; buffer.getLine(line)?.isWrapped; line++) text += buffer.getLine(line)!.translateToString(true);
  return text.trim();
}

/** The lines of a command's output: below its command line (and the rows that wrapped), above its end. */
function outputRange(term: Terminal, mark: CommandMark): { start: number; end: number } | undefined {
  if (!mark.input || !mark.end || mark.input.line < 0 || mark.end.line < 0) return undefined;
  const buffer = term.buffer.normal;
  let start = mark.input.line + 1;
  while (buffer.getLine(start)?.isWrapped) start++;
  let end = mark.end.line - 1;
  while (end >= start && !buffer.getLine(end)?.translateToString(true).trim()) end--;
  return end >= start ? { start, end } : undefined;
}

/** A command's output as text, wrapped rows joined; "" when it printed nothing. */
function outputOf(term: Terminal, mark: CommandMark): string {
  const range = outputRange(term, mark);
  if (!range) return "";
  const buffer = term.buffer.normal;
  let text = "";
  for (let line = range.start; line <= range.end; line++) {
    const row = buffer.getLine(line);
    if (!row) break;
    text += (row.isWrapped || !text ? "" : "\n") + row.translateToString(!buffer.getLine(line + 1)?.isWrapped);
  }
  return text.replace(/\s+$/, "");
}

/**
 * A thin bar at the prompt's left edge: green for exit 0, red otherwise, grey when
 * unknown. Clicking it opens the command's menu (copy, select, run again).
 */
function decorate(term: Terminal, mark: CommandMark, onClick: (x: number, y: number) => void): IDecoration | undefined {
  const decoration = term.registerDecoration({ marker: mark.prompt, x: 0, width: 1, layer: "top" });
  decoration?.onRender((el) => {
    const state = mark.exitCode === undefined ? "unknown" : mark.exitCode === 0 ? "ok" : "failed";
    el.classList.add("command-mark", state);
    const when =
      mark.startedAt !== undefined && mark.finishedAt !== undefined
        ? `\nRan at ${formatClock(mark.startedAt, Date.now(), true)}, took ${formatDuration(mark.finishedAt - mark.startedAt)}`
        : "";
    el.title = `${mark.command}${mark.exitCode === undefined ? "" : ` (exit ${mark.exitCode})`}${when}\nClick for copy, select and run again`;
    el.setAttribute("role", "button");
    el.setAttribute("aria-label", `Command: ${mark.command}`);
    if (el.dataset.wired) return;
    el.dataset.wired = "";
    // Before xterm's own mousedown, which would start a selection.
    el.addEventListener("mousedown", (e) => {
      e.stopPropagation();
      e.preventDefault();
    });
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      onClick(e.clientX, e.clientY);
    });
  });
  return decoration;
}

function disposeMark(mark: CommandMark): void {
  mark.decoration?.dispose();
  mark.prompt.dispose();
  mark.input?.dispose();
  mark.end?.dispose();
}

/**
 * The line the cursor just left (wrapped rows joined): its text, its first and last row,
 * and the cursor's row. Undefined at the very top.
 */
function lastLine(term: Terminal): { text: string; start: number; end: number; cursor: number } | undefined {
  const buffer = term.buffer.active;
  const cursor = buffer.baseY + buffer.cursorY;
  const end = cursor - 1;
  if (end < 0) return undefined;
  let start = end;
  while (start > 0 && buffer.getLine(start)?.isWrapped) start--;
  let text = "";
  for (let y = start; y <= end; y++) text += buffer.getLine(y)?.translateToString(true) ?? "";
  return { text, start, end, cursor };
}

/** The text of every line of the pane's normal buffer (scrollback included). */
function bufferLines(term: Terminal): string[] {
  const buffer = term.buffer.normal;
  const lines: string[] = [];
  for (let y = 0; y < buffer.length; y++) lines.push(buffer.getLine(y)?.translateToString(true) ?? "");
  return lines;
}
