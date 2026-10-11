import { Fragment, useRef } from "react";

import { paneIds, type LayoutNode, type PaneId, type SplitDir } from "../workspace/layout";
import type { Pane } from "../workspace/workspace";
import { PaneView } from "./PaneView";
import type { TerminalRegistry } from "./registry";

interface Props {
  node: LayoutNode;
  /** Child indexes from the tab's root down to `node`. */
  path: number[];
  panes: Record<PaneId, Pane>;
  focusedPane: PaneId;
  showFocus: boolean;
  registry: TerminalRegistry;
  onFocusPane(paneId: PaneId): void;
  /** Divider after child `index` of the split at `path` moved by `delta` (share of the split). */
  onResize(path: number[], index: number, delta: number): void;
}

export function LayoutView(props: Props) {
  const { node, path } = props;
  if (node.kind === "leaf") {
    return (
      <PaneView
        pane={props.panes[node.pane]}
        registry={props.registry}
        focused={props.showFocus && node.pane === props.focusedPane}
        onFocus={props.onFocusPane}
      />
    );
  }
  return (
    <div className={`split split-${node.dir}`}>
      {node.children.map((child, i) => (
        // Keyed by content, so a pane keeps its component when siblings come and go.
        <Fragment key={child.kind === "leaf" ? child.pane : `split:${paneIds(child)[0]}`}>
          {i > 0 && <Divider dir={node.dir} onDrag={(delta) => props.onResize(path, i - 1, delta)} />}
          <div className="split-child" style={{ flex: `${node.sizes[i]} 1 0` }}>
            <LayoutView {...props} node={child} path={[...path, i]} />
          </div>
        </Fragment>
      ))}
    </div>
  );
}

function Divider({ dir, onDrag }: { dir: SplitDir; onDrag(delta: number): void }) {
  const last = useRef<number | undefined>(undefined);
  const horizontal = dir === "row";

  return (
    <div
      className={`divider divider-${dir}`}
      role="separator"
      aria-orientation={horizontal ? "vertical" : "horizontal"}
      onPointerDown={(e) => {
        e.preventDefault(); // keep focus in the terminal
        e.currentTarget.setPointerCapture(e.pointerId);
        last.current = horizontal ? e.clientX : e.clientY;
      }}
      onPointerMove={(e) => {
        if (last.current === undefined) return;
        const position = horizontal ? e.clientX : e.clientY;
        const container = e.currentTarget.parentElement!.getBoundingClientRect();
        const extent = horizontal ? container.width : container.height;
        if (extent > 0) onDrag((position - last.current) / extent);
        last.current = position;
      }}
      onPointerUp={() => (last.current = undefined)}
      onPointerCancel={() => (last.current = undefined)}
    />
  );
}
