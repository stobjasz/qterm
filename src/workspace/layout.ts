// A tab's pane layout: an N-ary tree of row/column splits. Pure functions only.

export type PaneId = string;
/** "row": children side by side (vertical dividers). "column": stacked. */
export type SplitDir = "row" | "column";
export type Direction = "left" | "right" | "up" | "down";

export type LayoutNode =
  | { kind: "leaf"; pane: PaneId }
  // N-ary so that three splits in one direction make three equal columns. Sizes sum to 1.
  | { kind: "split"; dir: SplitDir; children: LayoutNode[]; sizes: number[] };

type Split = Extract<LayoutNode, { kind: "split" }>;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** No pane can be dragged or nudged below this share of its split. */
export const MIN_SIZE = 0.1;
const EPSILON = 1e-9;

export function paneIds(node: LayoutNode): PaneId[] {
  return node.kind === "leaf" ? [node.pane] : node.children.flatMap(paneIds);
}

/** Splits `target`, putting `newPane` after it. Same direction as the parent adds a sibling. */
export function insertSplit(node: LayoutNode, target: PaneId, dir: SplitDir, newPane: PaneId): LayoutNode {
  const fresh: LayoutNode = { kind: "leaf", pane: newPane };
  if (node.kind === "leaf") {
    return node.pane === target ? split(dir, [node, fresh]) : node;
  }
  const index = node.children.findIndex((child) => child.kind === "leaf" && child.pane === target);
  if (index >= 0 && node.dir === dir) {
    const children = [...node.children];
    children.splice(index + 1, 0, fresh);
    return split(dir, children);
  }
  return { ...node, children: node.children.map((child) => insertSplit(child, target, dir, newPane)) };
}

/** Removes `target`. Single-child splits collapse and same-direction nesting is flattened. */
export function removePane(node: LayoutNode, target: PaneId): LayoutNode | undefined {
  if (node.kind === "leaf") return node.pane === target ? undefined : node;
  if (!paneIds(node).includes(target)) return node;

  const children: LayoutNode[] = [];
  const sizes: number[] = [];
  node.children.forEach((child, i) => {
    const kept = removePane(child, target);
    if (!kept) return;
    if (kept.kind === "split" && kept.dir === node.dir) {
      kept.children.forEach((grandchild, j) => {
        children.push(grandchild);
        sizes.push(node.sizes[i] * kept.sizes[j]);
      });
    } else {
      children.push(kept);
      sizes.push(node.sizes[i]);
    }
  });
  if (children.length === 0) return undefined;
  if (children.length === 1) return children[0];
  const total = sizes.reduce((a, b) => a + b, 0);
  return { ...node, children, sizes: sizes.map((size) => size / total) };
}

/** Each pane's rectangle in unit space (the tab is 1×1). */
export function layoutRects(node: LayoutNode, rect: Rect = { x: 0, y: 0, w: 1, h: 1 }): Record<PaneId, Rect> {
  if (node.kind === "leaf") return { [node.pane]: rect };
  const rects: Record<PaneId, Rect> = {};
  let offset = 0;
  node.children.forEach((child, i) => {
    const share = node.sizes[i];
    const childRect =
      node.dir === "row"
        ? { x: rect.x + offset * rect.w, y: rect.y, w: share * rect.w, h: rect.h }
        : { x: rect.x, y: rect.y + offset * rect.h, w: rect.w, h: share * rect.h };
    Object.assign(rects, layoutRects(child, childRect));
    offset += share;
  });
  return rects;
}

/** The nearest pane in `direction`; among equally near ones, the one sharing the most edge. */
export function neighbor(node: LayoutNode, from: PaneId, direction: Direction): PaneId | undefined {
  const rects = layoutRects(node);
  const cur = rects[from];
  if (!cur) return undefined;

  let best: { pane: PaneId; distance: number; overlap: number } | undefined;
  for (const pane of paneIds(node)) {
    if (pane === from) continue;
    const r = rects[pane];
    const distance = {
      left: cur.x - (r.x + r.w),
      right: r.x - (cur.x + cur.w),
      up: cur.y - (r.y + r.h),
      down: r.y - (cur.y + cur.h),
    }[direction];
    const horizontal = direction === "left" || direction === "right";
    const overlap = horizontal
      ? Math.min(cur.y + cur.h, r.y + r.h) - Math.max(cur.y, r.y)
      : Math.min(cur.x + cur.w, r.x + r.w) - Math.max(cur.x, r.x);
    if (distance < -EPSILON || overlap <= EPSILON) continue;
    const better =
      !best ||
      distance < best.distance - EPSILON ||
      (Math.abs(distance - best.distance) <= EPSILON && overlap > best.overlap + EPSILON);
    if (better) best = { pane, distance, overlap };
  }
  return best?.pane;
}

/** Moves the divider between children `index` and `index + 1` of the split at `path`. */
export function resizeAt(node: LayoutNode, path: number[], index: number, delta: number): LayoutNode {
  if (node.kind === "leaf") return node;
  if (path.length > 0) {
    const [head, ...rest] = path;
    const children = node.children.map((child, i) => (i === head ? resizeAt(child, rest, index, delta) : child));
    return { ...node, children };
  }
  if (index < 0 || index + 1 >= node.sizes.length) return node;
  const pair = node.sizes[index] + node.sizes[index + 1];
  const first = clamp(node.sizes[index] + delta, MIN_SIZE, pair - MIN_SIZE);
  const sizes = [...node.sizes];
  sizes[index] = round(first);
  sizes[index + 1] = round(pair - first);
  return { ...node, sizes };
}

/**
 * Keyboard resize: moves a divider of `pane` in `direction` by `step`, using the
 * nearest enclosing split on that axis. The divider on the `direction` side is
 * used when there is one (the pane grows), otherwise the opposite one (it shrinks).
 */
export function resizeToward(node: LayoutNode, pane: PaneId, direction: Direction, step: number): LayoutNode {
  const axis: SplitDir = direction === "left" || direction === "right" ? "row" : "column";
  const forward = direction === "right" || direction === "down";
  const ancestors = ancestry(node, pane);
  if (!ancestors) return node;

  for (let depth = ancestors.length - 1; depth >= 0; depth--) {
    const { split, index } = ancestors[depth];
    if (split.dir !== axis) continue;
    const path = ancestors.slice(0, depth).map((a) => a.index);
    const last = split.children.length - 1;
    const divider = forward ? (index < last ? index : index - 1) : index > 0 ? index - 1 : index;
    return resizeAt(node, path, divider, forward ? step : -step);
  }
  return node;
}

/** Exchanges two panes' places; the tree's shape and sizes stay. */
export function swapLeaves(node: LayoutNode, a: PaneId, b: PaneId): LayoutNode {
  if (node.kind === "leaf") {
    if (node.pane === a) return { kind: "leaf", pane: b };
    if (node.pane === b) return { kind: "leaf", pane: a };
    return node;
  }
  return { ...node, children: node.children.map((child) => swapLeaves(child, a, b)) };
}

export function equalized(node: LayoutNode): LayoutNode {
  if (node.kind === "leaf") return node;
  return split(node.dir, node.children.map(equalized));
}

function split(dir: SplitDir, children: LayoutNode[]): Split {
  return { kind: "split", dir, children, sizes: children.map(() => 1 / children.length) };
}

/** The splits from the root down to `pane`, with the child index taken at each. */
function ancestry(node: LayoutNode, pane: PaneId): { split: Split; index: number }[] | undefined {
  if (node.kind === "leaf") return node.pane === pane ? [] : undefined;
  for (let i = 0; i < node.children.length; i++) {
    const below = ancestry(node.children[i], pane);
    if (below) return [{ split: node, index: i }, ...below];
  }
  return undefined;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

// Keeps repeated nudges from accumulating float noise like 0.19999999999999998.
function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}
