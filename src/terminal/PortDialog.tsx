import { useEffect, useRef } from "react";

import type { PortOwner } from "../ipc";
import { programName } from "../tabs/ConfirmClose";

interface Props {
  owner: PortOwner;
  /** Where it runs when it's in one of qterm's panes, e.g. "2 · PowerShell". */
  paneLabel?: string;
  onGoToPane?(): void;
  onEnd(): void;
  onCancel(): void;
}

/** "Who uses this port?": the process listening on it, its pane, and ending it (Cancel has the focus). */
export function PortDialog({ owner, paneLabel, onGoToPane, onEnd, onCancel }: Props) {
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => cancel.current?.focus(), []);
  const name = owner.process ? programName(owner.process) : `process ${owner.pid}`;
  return (
    <div className="palette-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div
        className="palette confirm-close"
        role="alertdialog"
        aria-label={`Port ${owner.port}`}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Escape") onCancel();
        }}
      >
        <p>
          <strong>{name}</strong>
          {owner.process && ` (process ${owner.pid})`} listens on port <strong>{owner.port}</strong> ({owner.addresses.join(", ")}),{" "}
          {paneLabel ? (
            <>
              in the pane <strong>{paneLabel}</strong>.
            </>
          ) : (
            "outside qterm."
          )}
        </p>
        <p className="settings-hint">Ending it also ends the programs it started.</p>
        <div className="settings-actions">
          <button ref={cancel} onClick={onCancel}>
            Cancel
          </button>
          {onGoToPane && <button onClick={onGoToPane}>Go to its pane</button>}
          <button className="danger" onClick={onEnd}>
            End {name}
          </button>
        </div>
      </div>
    </div>
  );
}
