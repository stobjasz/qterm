import { useEffect, useRef } from "react";

interface Props {
  /** "tab" or "pane": what's being closed. */
  what: "tab" | "pane";
  /** What still runs there, as the user knows it ("Claude Code", "node"). */
  programs: string[];
  onClose(): void;
  onCancel(): void;
}

/** Closing a tab or pane where a program still runs: ask first (Cancel has the focus). */
export function ConfirmClose({ what, programs, onClose, onCancel }: Props) {
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => cancel.current?.focus(), []);
  const list = programs.length > 1 ? `${programs.slice(0, -1).join(", ")} and ${programs[programs.length - 1]}` : programs[0];
  return (
    <div className="palette-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div
        className="palette confirm-close"
        role="alertdialog"
        aria-label={`Close this ${what}?`}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Escape") onCancel();
        }}
      >
        <p>
          <strong>{list}</strong> {programs.length > 1 ? "are" : "is"} still running in this {what}. Closing it ends{" "}
          {programs.length > 1 ? "them" : "it"}.
        </p>
        <div className="settings-actions">
          <button ref={cancel} onClick={onCancel}>
            Cancel
          </button>
          <button className="primary" onClick={onClose}>
            Close {what}
          </button>
        </div>
      </div>
    </div>
  );
}

/** "claude.exe" → "Claude Code", "node.exe" → "node". */
export function programName(exe: string): string {
  const name = exe.replace(/\.exe$/i, "");
  return name.toLowerCase() === "claude" ? "Claude Code" : name;
}
