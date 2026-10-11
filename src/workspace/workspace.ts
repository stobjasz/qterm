// Tabs, panes and their layout as plain immutable data. No DOM, no IPC:
// every operation is a pure function so it can be unit-tested.
import {
  equalized,
  insertSplit,
  neighbor,
  paneIds,
  removePane,
  resizeAt,
  resizeToward,
  type Direction,
  type LayoutNode,
  type PaneId,
  type SplitDir,
} from "./layout";

export { paneIds, type Direction, type LayoutNode, type PaneId, type SplitDir } from "./layout";

export type TabId = string;

export interface Pane {
  id: PaneId;
  profileId: string;
  profileName: string;
  /** Last title the shell set; empty until it sets one. */
  title: string;
  /** Last folder the shell reported (shell integration), or where it was started. */
  cwd?: string;
}

export interface Tab {
  id: TabId;
  root: LayoutNode;
  focusedPane: PaneId;
  /** Set by renaming the tab; wins over the shell's title. */
  title?: string;
}

export interface Workspace {
  tabs: Tab[];
  activeTab?: TabId;
  panes: Record<PaneId, Pane>;
}

export interface ProfileRef {
  id: string;
  name: string;
}

export function emptyWorkspace(): Workspace {
  return { tabs: [], panes: {} };
}

/** Ids come from the caller so this stays deterministic. */
export function openTab(
  ws: Workspace,
  ids: { tab: TabId; pane: PaneId },
  profile: ProfileRef,
  cwd?: string,
): Workspace {
  const tab: Tab = { id: ids.tab, root: { kind: "leaf", pane: ids.pane }, focusedPane: ids.pane };
  return { tabs: [...ws.tabs, tab], activeTab: tab.id, panes: withPane(ws.panes, ids.pane, profile, cwd) };
}

/** Splits `paneId` in `dir`, opening `profile` (in `cwd`) in the new pane and focusing it. */
export function splitPane(
  ws: Workspace,
  paneId: PaneId,
  dir: SplitDir,
  newPane: PaneId,
  profile: ProfileRef,
  cwd?: string,
): Workspace {
  const tab = tabOf(ws, paneId);
  if (!tab) return ws;
  return {
    ...replaceTab(ws, { ...tab, root: insertSplit(tab.root, paneId, dir, newPane), focusedPane: newPane }),
    panes: withPane(ws.panes, newPane, profile, cwd),
  };
}

/** Removes the pane; a tab whose last pane closes goes with it. */
export function closePane(ws: Workspace, paneId: PaneId): Workspace {
  const index = ws.tabs.findIndex((tab) => paneIds(tab.root).includes(paneId));
  if (index < 0) return ws;
  const tab = ws.tabs[index];
  const { [paneId]: _closed, ...panes } = ws.panes;

  const root = removePane(tab.root, paneId);
  if (root) {
    // Focus moves to the pane before the closed one in reading order, else the first.
    const order = paneIds(tab.root);
    const remaining = paneIds(root);
    const focusedPane =
      tab.focusedPane !== paneId
        ? tab.focusedPane
        : (order.slice(0, order.indexOf(paneId)).reverse().find((id) => remaining.includes(id)) ?? remaining[0]);
    return { ...replaceTab(ws, { ...tab, root, focusedPane }), panes };
  }

  const tabs = ws.tabs.filter((_, i) => i !== index);
  let activeTab = ws.activeTab;
  if (tab.id === ws.activeTab) {
    activeTab = (tabs[index] ?? tabs[index - 1])?.id;
  }
  return { tabs, activeTab, panes };
}

/** Focuses the pane, switching to its tab if needed. */
export function focusPane(ws: Workspace, paneId: PaneId): Workspace {
  const tab = tabOf(ws, paneId);
  if (!tab || (tab.focusedPane === paneId && ws.activeTab === tab.id)) return ws;
  return { ...replaceTab(ws, { ...tab, focusedPane: paneId }), activeTab: tab.id };
}

export function moveFocus(ws: Workspace, direction: Direction): Workspace {
  const tab = activeTab(ws);
  const target = tab && neighbor(tab.root, tab.focusedPane, direction);
  return target ? focusPane(ws, target) : ws;
}

export function resizeFocused(ws: Workspace, direction: Direction, step: number): Workspace {
  const tab = activeTab(ws);
  if (!tab) return ws;
  const root = resizeToward(tab.root, tab.focusedPane, direction, step);
  return root === tab.root ? ws : replaceTab(ws, { ...tab, root });
}

/** Drag of the divider after child `index` of the split at `path` in `tabId`. */
export function resizeDivider(ws: Workspace, tabId: TabId, path: number[], index: number, delta: number): Workspace {
  const tab = ws.tabs.find((t) => t.id === tabId);
  if (!tab) return ws;
  return replaceTab(ws, { ...tab, root: resizeAt(tab.root, path, index, delta) });
}

export function equalizeActive(ws: Workspace): Workspace {
  const tab = activeTab(ws);
  return tab ? replaceTab(ws, { ...tab, root: equalized(tab.root) }) : ws;
}

export function activateTab(ws: Workspace, tabId: TabId): Workspace {
  if (!ws.tabs.some((tab) => tab.id === tabId)) return ws;
  return { ...ws, activeTab: tabId };
}

export function cycleTab(ws: Workspace, delta: number): Workspace {
  if (ws.tabs.length === 0) return ws;
  const current = ws.tabs.findIndex((tab) => tab.id === ws.activeTab);
  const next = (current + delta + ws.tabs.length) % ws.tabs.length;
  return { ...ws, activeTab: ws.tabs[next].id };
}

/** An index past the end means the last tab, like Ctrl+9 in browsers. */
export function activateIndex(ws: Workspace, index: number): Workspace {
  if (ws.tabs.length === 0) return ws;
  return { ...ws, activeTab: ws.tabs[Math.min(index, ws.tabs.length - 1)].id };
}

export function setPaneTitle(ws: Workspace, paneId: PaneId, title: string): Workspace {
  const pane = ws.panes[paneId];
  if (!pane) return ws;
  return { ...ws, panes: { ...ws.panes, [paneId]: { ...pane, title } } };
}

/** A blank title removes the custom one, so the shell's shows again. */
export function renameTab(ws: Workspace, tabId: TabId, title: string): Workspace {
  const tab = ws.tabs.find((t) => t.id === tabId);
  if (!tab) return ws;
  const { title: _old, ...rest } = tab;
  const trimmed = title.trim();
  return replaceTab(ws, trimmed ? { ...rest, title: trimmed } : rest);
}

export function moveTab(ws: Workspace, tabId: TabId, toIndex: number): Workspace {
  const from = ws.tabs.findIndex((t) => t.id === tabId);
  if (from < 0) return ws;
  const tabs = ws.tabs.filter((t) => t.id !== tabId);
  tabs.splice(Math.max(0, Math.min(toIndex, tabs.length)), 0, ws.tabs[from]);
  return { ...ws, tabs };
}

export function setPaneCwd(ws: Workspace, paneId: PaneId, cwd: string): Workspace {
  const pane = ws.panes[paneId];
  if (!pane || pane.cwd === cwd) return ws;
  return { ...ws, panes: { ...ws.panes, [paneId]: { ...pane, cwd } } };
}

export function activeTab(ws: Workspace): Tab | undefined {
  return ws.tabs.find((tab) => tab.id === ws.activeTab);
}

// Shells without prompt integration title themselves with their own exe path.
const EXE_PATH = /^[a-z]:\\.*\.exe$/i;

/** The custom title, else the focused pane's shell title, else its profile name. */
export function tabTitle(ws: Workspace, tab: Tab): string {
  if (tab.title) return tab.title;
  const pane = ws.panes[tab.focusedPane];
  if (!pane) return "";
  const title = pane.title.trim();
  return title && !EXE_PATH.test(title) ? title : pane.profileName;
}

function tabOf(ws: Workspace, paneId: PaneId): Tab | undefined {
  return ws.tabs.find((tab) => paneIds(tab.root).includes(paneId));
}

function replaceTab(ws: Workspace, tab: Tab): Workspace {
  return { ...ws, tabs: ws.tabs.map((t) => (t.id === tab.id ? tab : t)) };
}

function withPane(panes: Record<PaneId, Pane>, id: PaneId, profile: ProfileRef, cwd?: string): Record<PaneId, Pane> {
  return { ...panes, [id]: { id, profileId: profile.id, profileName: profile.name, title: "", cwd } };
}

// --- Saving and restoring the layout across restarts --------------------------

interface SavedSession {
  version: 1;
  activeTab?: TabId;
  tabs: { id: TabId; title?: string; root: LayoutNode; focusedPane: PaneId }[];
  panes: Record<PaneId, { profileId: string; cwd?: string }>;
}

/** What is worth keeping: layout, profiles, folders, custom titles. Shell titles are not. */
export function saveWorkspace(ws: Workspace): string {
  const saved: SavedSession = {
    version: 1,
    activeTab: ws.activeTab,
    tabs: ws.tabs.map(({ id, title, root, focusedPane }) => ({ id, title, root, focusedPane })),
    panes: Object.fromEntries(Object.values(ws.panes).map((p) => [p.id, { profileId: p.profileId, cwd: p.cwd }])),
  };
  return JSON.stringify(saved);
}

/**
 * Rebuilds a saved workspace. Panes whose profile is gone get the default (first)
 * profile. Anything malformed means no restore at all rather than half a layout.
 */
export function restoreWorkspace(text: string, profiles: ProfileRef[]): Workspace | undefined {
  if (profiles.length === 0) return undefined;
  let saved: SavedSession;
  try {
    saved = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (saved?.version !== 1 || !Array.isArray(saved.tabs) || saved.tabs.length === 0) return undefined;
  if (typeof saved.panes !== "object" || saved.panes === null) return undefined;

  const panes: Record<PaneId, Pane> = {};
  const tabs: Tab[] = [];
  for (const raw of saved.tabs) {
    if (typeof raw?.id !== "string" || !isLayout(raw.root)) return undefined;
    const ids = paneIds(raw.root);
    for (const id of ids) {
      const savedPane = saved.panes[id];
      if (typeof savedPane?.profileId !== "string") return undefined;
      const profile = profiles.find((p) => p.id === savedPane.profileId) ?? profiles[0];
      const cwd = typeof savedPane.cwd === "string" ? savedPane.cwd : undefined;
      panes[id] = { id, profileId: profile.id, profileName: profile.name, title: "", cwd };
    }
    const focusedPane = ids.includes(raw.focusedPane) ? raw.focusedPane : ids[0];
    tabs.push({ id: raw.id, root: raw.root, focusedPane, ...(typeof raw.title === "string" && raw.title ? { title: raw.title } : {}) });
  }
  const activeTab = tabs.some((t) => t.id === saved.activeTab) ? saved.activeTab : tabs[0].id;
  return { tabs, activeTab, panes };
}

function isLayout(node: unknown): node is LayoutNode {
  if (typeof node !== "object" || node === null) return false;
  const n = node as Record<string, unknown>;
  if (n.kind === "leaf") return typeof n.pane === "string";
  return (
    n.kind === "split" &&
    (n.dir === "row" || n.dir === "column") &&
    Array.isArray(n.children) &&
    Array.isArray(n.sizes) &&
    n.children.length >= 2 &&
    n.sizes.length === n.children.length &&
    n.sizes.every((size) => typeof size === "number" && size > 0) &&
    n.children.every(isLayout)
  );
}
