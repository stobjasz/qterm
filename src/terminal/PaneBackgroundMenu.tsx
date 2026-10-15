import { useRef, type CSSProperties } from "react";

import { useDismiss } from "../tabs/useDismiss";
import { useFitInViewport } from "../tabs/useFitInViewport";

/** Dark tints that keep any theme's text readable; any other colour via "Custom". */
export const PANE_TINTS: { name: string; color: string }[] = [
  { name: "Slate", color: "#1e2430" },
  { name: "Navy", color: "#14213d" },
  { name: "Teal", color: "#12302f" },
  { name: "Forest", color: "#16291c" },
  { name: "Olive", color: "#2a2a16" },
  { name: "Rust", color: "#33201a" },
  { name: "Wine", color: "#331a24" },
  { name: "Plum", color: "#2a1a33" },
];

interface Props {
  /** Where it was asked for, in page pixels. */
  x: number;
  y: number;
  /** The pane's own colour, if it has one. */
  color?: string;
  /** A colour ("#rrggbb"), or null for the default (its shell's, else the console's). */
  onChange(color: string | null): void;
  /** The shell the pane runs, and switching it to another. */
  shell?: string;
  onSwitchShell?(): void;
  onClose(): void;
}

/** Shift+right-click on a pane, or "Pane background…": that one pane's background. */
export function PaneBackgroundMenu({ x, y, color, onChange, shell, onSwitchShell, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const position = useFitInViewport(ref, x, y);

  useDismiss(ref, onClose);

  return (
    <div ref={ref} className="tab-style-menu" role="dialog" aria-label="Pane background" style={position}>
      <div className="tab-style-label">Pane background</div>
      <div className="tab-style-colors" role="radiogroup" aria-label="Pane background">
        <button role="radio" aria-checked={!color} className="tab-style-swatch none" title="Default (its shell's)" aria-label="Default" onClick={() => onChange(null)} />
        {PANE_TINTS.map((tint) => (
          <button
            key={tint.color}
            role="radio"
            aria-checked={color === tint.color}
            aria-label={tint.name}
            title={tint.name}
            className="tab-style-swatch"
            style={{ "--swatch": tint.color } as CSSProperties}
            onClick={() => onChange(tint.color)}
          />
        ))}
      </div>
      <div className="tab-style-row">
        <label className="pane-color-custom">
          Custom
          <input type="color" aria-label="Custom colour" value={color ?? "#1e2430"} onChange={(e) => onChange(e.target.value)} />
        </label>
        <button onClick={() => onChange(null)}>Reset</button>
      </div>
      {onSwitchShell && (
        <div className="tab-style-row">
          <span className="pane-shell-name">{shell}</span>
          <button
            onClick={() => {
              onClose();
              onSwitchShell();
            }}
          >
            Switch shell…
          </button>
        </div>
      )}
    </div>
  );
}
