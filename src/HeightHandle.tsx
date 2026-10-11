import { useRef, useState } from "react";

import { resizeConsole, saveConsoleHeight } from "./ipc";

/** Height the handle resets to on double-click (share of the work area). */
const DEFAULT_HEIGHT = 0.5;

// The console's bottom edge: drag to resize, double-click to reset. The window
// resizes live (at most once per frame); the height is saved when the drag ends.
export function HeightHandle() {
  const [dragging, setDragging] = useState(false);
  const target = useRef(0);
  const frame = useRef<number>(undefined);
  const lastShare = useRef<Promise<number>>(undefined);

  const resize = () => {
    frame.current = undefined;
    lastShare.current = resizeConsole(target.current);
  };

  return (
    <div
      className={`height-handle${dragging ? " dragging" : ""}`}
      role="separator"
      aria-orientation="horizontal"
      aria-label="Resize console"
      title="Drag to resize, double-click for half the screen"
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault(); // keep keyboard focus in the terminal
        e.currentTarget.setPointerCapture(e.pointerId);
        lastShare.current = undefined; // a click without movement saves nothing
        setDragging(true);
      }}
      onPointerMove={(e) => {
        if (!dragging) return;
        // The window's top stays put, so the pointer's y is the wanted height.
        target.current = e.clientY + 2;
        frame.current ??= requestAnimationFrame(resize);
      }}
      onPointerUp={() => {
        if (!dragging) return;
        setDragging(false);
        if (frame.current !== undefined) {
          cancelAnimationFrame(frame.current);
          resize();
        }
        void lastShare.current?.then(saveConsoleHeight);
      }}
      onDoubleClick={() => void saveConsoleHeight(DEFAULT_HEIGHT)}
    />
  );
}
