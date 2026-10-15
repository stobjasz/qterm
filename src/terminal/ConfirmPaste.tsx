import { useEffect, useRef } from "react";

import { pastedLines } from "./paste";

/** Lines of the paste shown in the dialog; the rest is counted. */
const PREVIEW_LINES = 8;

interface Props {
  text: string;
  onPaste(): void;
  onCancel(): void;
}

/** Pasting several lines into a shell, where each would run as a command: ask first (Cancel has the focus). */
export function ConfirmPaste({ text, onPaste, onCancel }: Props) {
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => cancel.current?.focus(), []);
  const lines = pastedLines(text);
  const more = lines.length - PREVIEW_LINES;
  return (
    <div className="palette-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div
        className="palette confirm-close"
        role="alertdialog"
        aria-label={`Paste ${lines.length} lines?`}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Escape") onCancel();
        }}
      >
        <p>
          You're pasting <strong>{lines.length} lines</strong> into a shell. Each line runs as a command as soon as it arrives.
        </p>
        <pre className="paste-preview" aria-label="What will be pasted">
          {lines.slice(0, PREVIEW_LINES).join("\n")}
          {more > 0 && `\n… and ${more} more line${more === 1 ? "" : "s"}`}
        </pre>
        <div className="settings-actions">
          <span className="settings-hint">Settings → Terminal can switch this question off.</span>
          <button ref={cancel} onClick={onCancel}>
            Cancel
          </button>
          <button className="primary" onClick={onPaste}>
            Paste {lines.length} lines
          </button>
        </div>
      </div>
    </div>
  );
}
