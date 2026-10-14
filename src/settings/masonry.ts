// The settings panel's layout: as many columns as fit, each group as tall as its
// content, placed masonry-style; a group taller than the panel spans more columns
// (its settings flowing in that many inner columns) until it fits.

export const MIN_COLUMN = 300;
export const GAP = 14;

export interface Placement {
  column: number;
  top: number;
}

/** Columns that fit in `width`, at least one. */
export function columnCount(width: number, min = MIN_COLUMN, gap = GAP): number {
  return Math.max(1, Math.floor((width + gap) / (min + gap)));
}

/**
 * Places items (in order) where they start highest: an item spanning `span` columns
 * goes to the run of columns whose lowest bottom is the highest, leftmost on a tie.
 * Returns each item's column and top, and the total height.
 */
export function pack(items: readonly { span: number; height: number }[], columns: number, gap = GAP): { placements: Placement[]; height: number } {
  const bottoms = new Array<number>(columns).fill(0);
  const placements = items.map(({ span, height }) => {
    const width = Math.min(Math.max(1, span), columns);
    let best = 0;
    let bestTop = Infinity;
    for (let start = 0; start + width <= columns; start++) {
      const top = Math.max(...bottoms.slice(start, start + width));
      if (top < bestTop) {
        best = start;
        bestTop = top;
      }
    }
    for (let c = best; c < best + width; c++) bottoms[c] = bestTop + height + gap;
    return { column: best, top: bestTop };
  });
  return { placements, height: Math.max(0, ...bottoms) - (items.length ? gap : 0) };
}

/** The narrowest span (1…columns) whose measured height fits; the widest if none does. */
export function spanThatFits(heightAt: (span: number) => number, columns: number, available: number): number {
  for (let span = 1; span <= columns; span++) {
    if (heightAt(span) <= available) return span;
  }
  return columns;
}

/**
 * Lays out the `.settings-group`s in `container` (their content in a
 * `.settings-group-body`): measures each group's height at growing widths, then
 * positions them absolutely. `available` is the height to fit into.
 */
export function layoutGroups(container: HTMLElement, available: number): void {
  const width = container.clientWidth;
  const columns = columnCount(width);
  const columnWidth = (width - (columns - 1) * GAP) / columns;
  const groups = [...container.querySelectorAll<HTMLElement>(":scope > .settings-group")].filter((g) => !g.hidden);
  const spanWidth = (span: number) => span * columnWidth + (span - 1) * GAP;
  const items = groups.map((group) => {
    const body = group.querySelector<HTMLElement>(".settings-group-body");
    // A group that lays itself out by width (the shortcuts grid) gets no inner columns.
    const inner = group.dataset.layout !== "grid";
    group.style.position = "absolute";
    const heightAt = (span: number) => {
      group.style.width = `${spanWidth(span)}px`;
      if (body && inner) body.style.columnCount = String(span);
      return group.offsetHeight;
    };
    const span = columns === 1 ? 1 : spanThatFits(heightAt, columns, available);
    const height = heightAt(span);
    return { group, span, height };
  });
  const { placements, height } = pack(items, columns);
  items.forEach(({ group }, i) => {
    group.style.left = `${placements[i].column * (columnWidth + GAP)}px`;
    group.style.top = `${placements[i].top}px`;
  });
  container.style.height = `${height}px`;
}
