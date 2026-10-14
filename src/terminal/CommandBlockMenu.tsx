import { useRef } from "react";

import { useDismiss } from "../tabs/useDismiss";
import { useFitInViewport } from "../tabs/useFitInViewport";
import type { CommandBlock } from "./registry";

interface Props {
  block: CommandBlock;
  /** Where it was clicked, in page pixels. */
  x: number;
  y: number;
  onCopyOutput(): void;
  onCopyCommand(): void;
  onSelectOutput(): void;
  onRunAgain(): void;
  onClose(): void;
}

/** A click on a command's ✓/✗ bar: what can be done with that command and its output. */
export function CommandBlockMenu({ block, x, y, onCopyOutput, onCopyCommand, onSelectOutput, onRunAgain, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const position = useFitInViewport(ref, x, y);

  useDismiss(ref, onClose);

  const act = (action: () => void) => () => {
    onClose();
    action();
  };
  const status = block.exitCode === undefined ? "" : block.exitCode === 0 ? "✓ " : `✗ exit ${block.exitCode} · `;

  return (
    <div ref={ref} className="tab-style-menu command-block-menu" role="menu" aria-label="Command" style={position}>
      <div className="tab-style-label" title={block.command}>
        {status}
        {block.command}
      </div>
      <button role="menuitem" disabled={!block.hasOutput} onClick={act(onCopyOutput)}>
        Copy output
      </button>
      <button role="menuitem" onClick={act(onCopyCommand)}>
        Copy command
      </button>
      <button role="menuitem" disabled={!block.hasOutput} onClick={act(onSelectOutput)}>
        Select output
      </button>
      <button role="menuitem" onClick={act(onRunAgain)}>
        Run again
      </button>
    </div>
  );
}
