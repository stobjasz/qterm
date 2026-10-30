import { useEffect, type RefObject } from "react";

/** Keep a modal's keyboard input away from the terminal behind it. */
export function useModalFocus(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const focusable = () => [...(ref.current?.querySelectorAll<HTMLElement>("button, input, select, textarea, a[href], [tabindex]") ?? [])]
      .filter((el) => !el.hasAttribute("disabled") && el.tabIndex >= 0 && !el.hidden && el.getClientRects().length > 0);
    const focus = () => (focusable()[0] ?? ref.current)?.focus();
    const contain = (event: FocusEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) focus();
    };
    const tab = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || !ref.current) return;
      const items = focusable();
      if (!items.length) { event.preventDefault(); ref.current.focus(); return; }
      const first = items[0], last = items[items.length - 1];
      if (!ref.current.contains(document.activeElement) || (event.shiftKey ? document.activeElement === first : document.activeElement === last)) {
        event.preventDefault(); (event.shiftKey ? last : first).focus();
      }
    };
    if (ref.current && !ref.current.contains(document.activeElement)) focus();
    window.addEventListener("focusin", contain, true);
    window.addEventListener("keydown", tab, true);
    return () => { window.removeEventListener("focusin", contain, true); window.removeEventListener("keydown", tab, true); };
  }, [ref]);
}
