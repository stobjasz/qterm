import { useState } from "react";

import { cleanName, MAX_NAME } from "./named";

interface Props {
  /** Names already saved: saving under one of them replaces it. */
  existing: string[];
  onSave(name: string): void;
  onClose(): void;
}

/** Palette → "Save all tabs as a workspace…": asks for the name. */
export function SaveWorkspaceDialog({ existing, onSave, onClose }: Props) {
  const [name, setName] = useState("");
  const clean = cleanName(name);
  const replaces = existing.find((n) => n.toLowerCase() === clean.toLowerCase());
  const save = () => {
    if (!clean) return;
    onClose();
    onSave(clean);
  };
  return (
    <div className="palette-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form
        className="palette workspace-dialog"
        role="dialog"
        aria-label="Save workspace"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <label className="settings-field">
          <span className="settings-label">Save all tabs as a workspace named</span>
          <input
            autoFocus
            maxLength={MAX_NAME}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                onClose();
              }
              e.stopPropagation();
            }}
          />
          <span className="settings-hint">
            {replaces ? `Replaces the workspace “${replaces}”.` : "Open it again from the palette (Workspace)."}
          </span>
        </label>
        <div className="settings-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={!clean}>
            Save
          </button>
        </div>
      </form>
    </div>
  );
}
