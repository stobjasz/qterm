import { useEffect, type RefObject } from "react";

/**
 * Closes a menu on Escape or a click outside it. Escape is caught before anything else
 * sees it (capture phase) and not passed on: menus opened from a terminal (right-click on
 * a tab, Shift+right-click on a pane, a command's bar) leave the keyboard focus in the
 * terminal, which would otherwise take the key and send it to the shell.
 */
export function useDismiss(ref: RefObject<HTMLElement | null>, onClose: () => void, active = true): void {
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("mousedown", onDown);
    };
  }, [ref, onClose, active]);
}

/**
 * Closes a panel on Escape. When the keyboard is still in a terminal (the panel was
 * opened with a shortcut typed there), the terminal would take the key and send it to
 * the shell, so it's caught first there and not passed on. Elsewhere the panel's own
 * fields see Escape first (a search box clears itself) and the panel closes after,
 * unless one of them handled it.
 */
export function useEscape(onClose: () => void): void {
  useEffect(() => {
    const fromTerminal = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || !(e.target instanceof Element) || !e.target.closest(".xterm")) return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };
    const elsewhere = (e: KeyboardEvent) => e.key === "Escape" && !e.defaultPrevented && onClose();
    window.addEventListener("keydown", fromTerminal, true);
    window.addEventListener("keydown", elsewhere);
    return () => {
      window.removeEventListener("keydown", fromTerminal, true);
      window.removeEventListener("keydown", elsewhere);
    };
  }, [onClose]);
}
