import { useEffect, useState, type CSSProperties } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { onQuakeVisibility } from "./ipc";
import { TerminalPane, type Renderer } from "./terminal/TerminalPane";

const DEFAULT_SLIDE_MS = 150;

export default function App() {
  const [shown, setShown] = useState(false);
  const [slideMs, setSlideMs] = useState(DEFAULT_SLIDE_MS);
  const [renderer, setRenderer] = useState<Renderer>();

  useEffect(() => {
    const unlisten = onQuakeVisibility(({ visible, slideMs }) => {
      setSlideMs(slideMs);
      setShown(visible);
    });
    // The window may already be on screen before this listener exists (first launch).
    void getCurrentWindow()
      .isVisible()
      .then((visible) => visible && setShown(true));
    return () => void unlisten.then((fn) => fn());
  }, []);

  return (
    <div className={`console${shown ? " shown" : ""}`} style={{ "--slide-ms": `${slideMs}ms` } as CSSProperties}>
      <TerminalPane onRenderer={setRenderer} />
      {import.meta.env.DEV && renderer && <span className="dev-badge">{renderer}</span>}
    </div>
  );
}
