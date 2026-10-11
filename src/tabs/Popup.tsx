import { useEffect, useRef, useState, type ReactNode } from "react";

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

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== "Escape") return;
      if (e instanceof MouseEvent && ref.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", close);
    };
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
        <div className="menu" role="menu" aria-label={menuLabel}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}
