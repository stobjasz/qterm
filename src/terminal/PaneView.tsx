import { useEffect, useLayoutEffect, useRef } from "react";

import type { Pane } from "../workspace/workspace";
import type { TerminalRegistry } from "./registry";

interface Props {
  pane: Pane;
  registry: TerminalRegistry;
}

// A slot for one pane's terminal. It never disposes the terminal: closing a pane
// is an explicit workspace action, not a side effect of unmounting.
export function PaneView({ pane, registry }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    registry.attach(pane.id, pane.profileId, hostRef.current!);
  }, [registry, pane.id, pane.profileId]);

  useEffect(() => {
    const observer = new ResizeObserver(() => registry.fit(pane.id));
    observer.observe(hostRef.current!);
    return () => observer.disconnect();
  }, [registry, pane.id]);

  return <div className="pane" ref={hostRef} />;
}
