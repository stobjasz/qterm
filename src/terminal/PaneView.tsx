import { useEffect, useLayoutEffect, useRef, type CSSProperties } from "react";

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
  /** Its own background (CSS colour), when its shell has one; else the console's. */
  background?: string;
  /** Names its shell (tabs whose panes run different shells). */
  badge?: PaneBadge;
  onFocus(paneId: PaneId): void;
}

export interface PaneBadge {
  name: string;
  /** Its shell's tab colour (CSS), if it has one. */
  color?: string;
  /** Hover text: the shell and its folder. */
  title: string;
}

// A slot for one pane's terminal. It never disposes the terminal: closing a pane
// is an explicit workspace action, not a side effect of unmounting, so a pane can
// move to a new slot when the layout around it changes.
export function PaneView({ pane, registry, spec, focused, broadcast, background, badge, onFocus }: Props) {
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
      style={background ? ({ "--pane-bg": background } as CSSProperties) : undefined}
      data-pane-id={pane.id}
      // Panes all hold an identical "Terminal input" textbox; tests tell them apart by id.
      data-testid={pane.id}
      onFocus={() => onFocus(pane.id)}
    >
      {/* React's own child; the terminal's wrapper is added next to it by the registry. */}
      {badge && (
        <span className="pane-shell" role="note" aria-label={`Shell: ${badge.name}`} title={badge.title} style={badge.color ? ({ "--badge-color": badge.color } as CSSProperties) : undefined}>
          {badge.name}
        </span>
      )}
    </div>
  );
}
