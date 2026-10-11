import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import "@xterm/xterm/css/xterm.css";

import { onPtyExit, onQuakeVisibility, ptyKill, ptyResize, ptySpawn, ptyWrite, type SessionId } from "../ipc";
import { terminalOptions } from "./theme";

export type Renderer = "webgl" | "dom";

const RESIZE_DEBOUNCE_MS = 50;

interface Props {
  onRenderer?: (renderer: Renderer) => void;
}

// One xterm.js instance bound to one PTY session for the lifetime of the component.
// M3 moves instances into a registry outside React so splits don't recreate them.
export function TerminalPane({ onRenderer }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current!;
    const term = new Terminal(terminalOptions);
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    onRenderer?.(loadWebgl(term));
    fit.fit();

    let sessionId: SessionId | undefined;
    let disposed = false;
    ptySpawn(term.cols, term.rows, (data) => term.write(data))
      .then((id) => {
        // StrictMode (and fast unmounts) can dispose us before the spawn resolves.
        if (disposed) void ptyKill(id);
        else sessionId = id;
      })
      .catch((err) => term.write(`\r\n\x1b[31mqterm: could not start shell: ${err}\x1b[0m\r\n`));

    const input = term.onData((data) => {
      if (sessionId !== undefined) void ptyWrite(sessionId, data);
    });

    let resizeTimer: number | undefined;
    const resize = term.onResize(({ cols, rows }) => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        if (sessionId !== undefined) void ptyResize(sessionId, cols, rows);
      }, RESIZE_DEBOUNCE_MS);
    });
    const observer = new ResizeObserver(() => fit.fit());
    observer.observe(host);

    const unlisteners = [
      onPtyExit(({ id, code }) => {
        if (id !== sessionId) return;
        sessionId = undefined;
        term.write(`\r\n\x1b[90m[process exited with code ${code}]\x1b[0m\r\n`);
      }),
      onQuakeVisibility(({ visible }) => {
        if (visible) term.focus();
      }),
    ];
    term.focus();

    return () => {
      disposed = true;
      window.clearTimeout(resizeTimer);
      observer.disconnect();
      input.dispose();
      resize.dispose();
      unlisteners.forEach((p) => p.then((unlisten) => unlisten()));
      if (sessionId !== undefined) void ptyKill(sessionId);
      term.dispose();
    };
  }, [onRenderer]);

  return <div className="terminal-pane" ref={hostRef} />;
}

// WebGL is much faster for heavy output; the DOM renderer is the fallback when
// WebGL2 is unavailable or the GPU context is lost.
function loadWebgl(term: Terminal): Renderer {
  try {
    const webgl = new WebglAddon();
    webgl.onContextLoss(() => webgl.dispose());
    term.loadAddon(webgl);
    return "webgl";
  } catch {
    return "dom";
  }
}
