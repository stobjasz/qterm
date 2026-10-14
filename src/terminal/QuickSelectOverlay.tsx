import type { Target } from "./quickSelect";

export interface QuickSelectItem {
  label: string;
  target: Target;
  /** Where the target starts on the page, in CSS pixels. */
  left: number;
  top: number;
}

interface Props {
  items: QuickSelectItem[];
  /** The letters typed so far; labels that don't start with them are hidden. */
  typed: string;
}

/** Labels over every target on screen (Alt+Shift+S); App handles the keys. */
export function QuickSelectOverlay({ items, typed }: Props) {
  return (
    <div className="quick-select" role="status" aria-label="Quick select">
      {items
        .filter((item) => item.label.startsWith(typed))
        .map((item) => (
          <span key={item.label} className="quick-select-label" style={{ left: item.left, top: item.top }} title={item.target.text}>
            <span className="quick-select-typed">{typed}</span>
            {item.label.slice(typed.length)}
          </span>
        ))}
      <div className="quick-select-hint">Type a label to copy it · Shift+label opens it · Esc cancels</div>
    </div>
  );
}
