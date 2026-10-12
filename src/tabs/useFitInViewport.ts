import { useLayoutEffect, useState, type RefObject } from "react";

/**
 * Where to put a popup opened at (x, y): below and right of it, flipped up / left
 * where it wouldn't fit (the tab bar sits at the console's bottom edge).
 */
export function useFitInViewport(ref: RefObject<HTMLElement | null>, x: number, y: number): { left: number; top: number } {
  const [position, setPosition] = useState({ left: x, top: y });
  useLayoutEffect(() => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    const margin = 4;
    setPosition({
      left: x + box.width + margin > window.innerWidth ? Math.max(margin, x - box.width) : x,
      top: y + box.height + margin > window.innerHeight ? Math.max(margin, y - box.height) : y,
    });
  }, [ref, x, y]);
  return position;
}
