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
}

export interface Tab {
  id: TabId;
  root: LayoutNode;
  focusedPane: PaneId;
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
export function openTab(ws: Workspace, ids: { tab: TabId; pane: PaneId }, profile: ProfileRef): Workspace {
  const tab: Tab = { id: ids.tab, root: { kind: "leaf", pane: ids.pane }, focusedPane: ids.pane };
  return { tabs: [...ws.tabs, tab], activeTab: tab.id, panes: withPane(ws.panes, ids.pane, profile) };
}

/** Splits `paneId` in `dir`, opening `profile` in the new pane and focusing it. */
export function splitPane(
  ws: Workspace,
  paneId: PaneId,
  dir: SplitDir,
  newPane: PaneId,
  profile: ProfileRef,
): Workspace {
  const tab = tabOf(ws, paneId);
  if (!tab) return ws;
  return {
    ...replaceTab(ws, { ...tab, root: insertSplit(tab.root, paneId, dir, newPane), focusedPane: newPane }),
    panes: withPane(ws.panes, newPane, profile),
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

export function activeTab(ws: Workspace): Tab | undefined {
  return ws.tabs.find((tab) => tab.id === ws.activeTab);
}

// Shells without prompt integration title themselves with their own exe path.
const EXE_PATH = /^[a-z]:\\.*\.exe$/i;

/** The focused pane's shell title, or its profile name when that says nothing useful. */
export function tabTitle(ws: Workspace, tab: Tab): string {
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

function withPane(panes: Record<PaneId, Pane>, id: PaneId, profile: ProfileRef): Record<PaneId, Pane> {
  return { ...panes, [id]: { id, profileId: profile.id, profileName: profile.name, title: "" } };
}
