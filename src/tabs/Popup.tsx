import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { useDismiss } from "./useDismiss";

interface Props {
  /** The button that opens it. */
  label: string;
  title?: string;
  icon: ReactNode;
  menuLabel: string;
  className?: string;
  children(close: () => void): ReactNode;
}

/** A tab-bar button with a menu that opens upward; closes on outside click or Escape. */
export function Popup({ label, title, icon, menuLabel, className, children }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setOpen(false), []);
  useDismiss(ref, close, open);
  // Opens to the right of its button; moved left as far as needed to stay in the window.
  const menu = useRef<HTMLDivElement>(null);
  const [shift, setShift] = useState(0);
  useLayoutEffect(() => {
    if (!open || !menu.current) return setShift(0);
    const overflow = menu.current.getBoundingClientRect().right - shift - (window.innerWidth - 8);
    setShift(overflow > 0 ? overflow : 0);
  }, [open]);

  return (
    <div className={`popup ${className ?? ""}`} ref={ref}>
      <button
        className="tab-new"
        aria-label={label}
        title={title ?? label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {icon}
      </button>
      {open && (
        <div className="menu" role="menu" aria-label={menuLabel} ref={menu} style={shift ? { left: -shift } : undefined}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}
