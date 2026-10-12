import { useEffect, useLayoutEffect, useRef } from "react";

import type { Pane, PaneId } from "../workspace/workspace";
import type { PaneSpec, TerminalRegistry } from "./registry";

interface Props {
  pane: Pane;
  registry: TerminalRegistry;
  /** How to start the shell; only read the first time this pane is attached. */
  spec(pane: Pane): PaneSpec;
  /** Draw the focus outline (only meaningful when the tab has several panes). */
  focused: boolean;
  broadcast?: boolean;
  onFocus(paneId: PaneId): void;
}

// A slot for one pane's terminal. It never disposes the terminal: closing a pane
// is an explicit workspace action, not a side effect of unmounting, so a pane can
// move to a new slot when the layout around it changes.
export function PaneView({ pane, registry, spec, focused, broadcast, onFocus }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    registry.attach(pane.id, spec(pane), hostRef.current!);
    // Re-attach only when the pane itself changes; the spec matters on creation only.
  }, [registry, pane.id]);

  useEffect(() => {
    const observer = new ResizeObserver(() => registry.fit(pane.id));
    observer.observe(hostRef.current!);
    return () => observer.disconnect();
  }, [registry, pane.id]);

  return (
    <div
      className={`pane${focused ? " focused" : ""}${broadcast ? " broadcast" : ""}`}
      ref={hostRef}
      data-pane-id={pane.id}
      // Panes all hold an identical "Terminal input" textbox; tests tell them apart by id.
      data-testid={pane.id}
      onFocus={() => onFocus(pane.id)}
    />
  );
}
