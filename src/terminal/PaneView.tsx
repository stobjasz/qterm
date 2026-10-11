import { useEffect, useLayoutEffect, useRef } from "react";

import type { Pane, PaneId } from "../workspace/workspace";
import type { TerminalRegistry } from "./registry";

interface Props {
  pane: Pane;
  registry: TerminalRegistry;
  /** Draw the focus outline (only meaningful when the tab has several panes). */
  focused: boolean;
  onFocus(paneId: PaneId): void;
}

// A slot for one pane's terminal. It never disposes the terminal: closing a pane
// is an explicit workspace action, not a side effect of unmounting, so a pane can
// move to a new slot when the layout around it changes.
export function PaneView({ pane, registry, focused, onFocus }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    registry.attach(pane.id, pane.profileId, hostRef.current!);
  }, [registry, pane.id, pane.profileId]);

  useEffect(() => {
    const observer = new ResizeObserver(() => registry.fit(pane.id));
    observer.observe(hostRef.current!);
    return () => observer.disconnect();
  }, [registry, pane.id]);

  return (
    <div
      className={`pane${focused ? " focused" : ""}`}
      ref={hostRef}
      onFocus={() => onFocus(pane.id)}
    />
  );
}
