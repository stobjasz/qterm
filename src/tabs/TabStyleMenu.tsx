import { useEffect, useRef, useState, type CSSProperties } from "react";

import { TAB_COLORS, type TabColor } from "../workspace/workspace";

/** The palette tab colours map to (One Dark's, readable on every theme). */
export const TAB_COLOR_VALUES: Record<TabColor, string> = {
  red: "#e06c75",
  orange: "#d19a66",
  yellow: "#e5c07b",
  green: "#98c379",
  teal: "#56b6c2",
  blue: "#61afef",
  purple: "#c678dd",
  pink: "#f06292",
};

const QUICK_ICONS = ["🚀", "🐍", "🐳", "🔧", "🧪", "🌐", "📦", "🔥", "⭐", "🛠"];

interface Props {
  /** Where the right-click was, in page pixels. */
  x: number;
  y: number;
  color?: TabColor;
  icon?: string;
  onChange(style: { color?: TabColor | null; icon?: string | null }): void;
  onClose(): void;
}

/** Right-click on a tab: its colour and icon. Changes apply at once; Esc or a click outside closes it. */
export function TabStyleMenu({ x, y, color, icon, onChange, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [text, setText] = useState(icon ?? "");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && onClose();
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
    };
  }, [onClose]);

  return (
    <div ref={ref} className="tab-style-menu" role="dialog" aria-label="Tab colour and icon" style={{ left: x, top: y }}>
      <div className="tab-style-label">Colour</div>
      <div className="tab-style-colors" role="radiogroup" aria-label="Tab colour">
        <button role="radio" aria-checked={!color} className="tab-style-swatch none" title="No colour" onClick={() => onChange({ color: null })} />
        {TAB_COLORS.map((name) => (
          <button
            key={name}
            role="radio"
            aria-checked={color === name}
            aria-label={name}
            title={name}
            className="tab-style-swatch"
            style={{ "--swatch": TAB_COLOR_VALUES[name] } as CSSProperties}
            onClick={() => onChange({ color: name })}
          />
        ))}
      </div>
      <div className="tab-style-label">Icon</div>
      <div className="tab-style-icons">
        {QUICK_ICONS.map((emoji) => (
          <button
            key={emoji}
            aria-pressed={icon === emoji}
            onClick={() => {
              setText(emoji);
              onChange({ icon: emoji });
            }}
          >
            {emoji}
          </button>
        ))}
      </div>
      <div className="tab-style-row">
        <input
          type="text"
          aria-label="Tab icon"
          placeholder="Any emoji or up to 4 letters"
          value={text}
          maxLength={8}
          onChange={(e) => {
            setText(e.target.value);
            onChange({ icon: e.target.value || null });
          }}
        />
        <button
          onClick={() => {
            setText("");
            onChange({ color: null, icon: null });
          }}
        >
          Reset
        </button>
      </div>
    </div>
  );
}
