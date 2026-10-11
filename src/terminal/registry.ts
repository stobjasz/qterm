// xterm.js instances live here, outside React. A pane component only parks the
// terminal's wrapper element in its container, so switching tabs or re-parenting
// a pane during a split never recreates a terminal or loses its scrollback.
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import "@xterm/xterm/css/xterm.css";

import { onPtyExit, ptyAck, ptyKill, ptyResize, ptySpawn, ptyWrite, type SessionId } from "../ipc";
import { buildKeymap, keyInput, resolveKey, type Command, type Keymap } from "../keybindings";
import type { PaneId } from "../workspace/workspace";
import { terminalOptions } from "./theme";

const RESIZE_DEBOUNCE_MS = 50;
/** Processed output is acknowledged in batches of at least this many bytes... */
const ACK_BATCH_BYTES = 64 * 1024;
/** ...or after this long, whichever comes first. Rust resumes reading at 128 KB unacked. */
const ACK_DELAY_MS = 20;

export interface RegistryEvents {
  onCommand(paneId: PaneId, command: Command): void;
  onTitle(paneId: PaneId, title: string): void;
  onExit(paneId: PaneId, code: number): void;
}

interface Entry {
  term: Terminal;
  fit: FitAddon;
  wrapper: HTMLDivElement;
  profileId: string;
  opened: boolean;
  sessionId?: SessionId;
  resizeTimer?: number;
  /** Output xterm.js has processed but Rust hasn't been told about yet. */
  pendingAck: number;
  ackTimer?: number;
}

export interface FontSettings {
  family: string;
  size: number;
}

export class TerminalRegistry {
  private entries = new Map<PaneId, Entry>();
  private keymap: Keymap = buildKeymap();
  private font: FontSettings = { family: terminalOptions.fontFamily!, size: terminalOptions.fontSize! };

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
  attach(paneId: PaneId, profileId: string, host: HTMLElement): void {
    const entry = this.entries.get(paneId) ?? this.create(paneId, profileId);
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
    window.clearTimeout(entry.resizeTimer);
    window.clearTimeout(entry.ackTimer);
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

  private create(paneId: PaneId, profileId: string): Entry {
    const wrapper = document.createElement("div");
    wrapper.className = "terminal-wrapper";
    const term = new Terminal({ ...terminalOptions, fontFamily: this.font.family, fontSize: this.font.size });
    const entry: Entry = { term, fit: new FitAddon(), wrapper, profileId, opened: false, pendingAck: 0 };
    this.entries.set(paneId, entry);
    return entry;
  }

  // xterm measures glyphs on open, so this waits until the wrapper is in the document.
  private open(paneId: PaneId, entry: Entry): void {
    const { term, fit } = entry;
    term.loadAddon(fit);
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

    // Acknowledge only after xterm has parsed the data, so a slow renderer slows the shell.
    const onOutput = (data: Uint8Array) => term.write(data, () => this.processed(entry, data.length));
    ptySpawn(entry.profileId, term.cols, term.rows, onOutput)
      .then((id) => {
        // The pane may have been closed while the shell was starting.
        if (this.entries.get(paneId) !== entry) return void ptyKill(id);
        entry.sessionId = id;
        this.flushAck(entry); // output may have arrived before the id did
      })
      .catch((err) => term.write(`\r\n\x1b[31mqterm: could not start shell: ${err}\x1b[0m\r\n`));
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
