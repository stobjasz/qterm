// Tabs, panes and their layout as plain immutable data. No DOM, no IPC:
// every operation is a pure function so it can be unit-tested.

export type PaneId = string;
export type TabId = string;

export type LayoutNode =
  | { kind: "leaf"; pane: PaneId }
  // Splits arrive in M3. N-ary so that three splits make three equal columns.
  | { kind: "split"; dir: "row" | "column"; children: LayoutNode[]; sizes: number[] };

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
  return {
    tabs: [...ws.tabs, tab],
    activeTab: tab.id,
    panes: { ...ws.panes, [ids.pane]: { id: ids.pane, profileId: profile.id, profileName: profile.name, title: "" } },
  };
}

export function closePane(ws: Workspace, paneId: PaneId): Workspace {
  const index = ws.tabs.findIndex((tab) => paneIds(tab.root).includes(paneId));
  if (index < 0) return ws;

  // M2: a tab holds exactly one pane, so closing the pane closes the tab.
  const tabs = ws.tabs.filter((_, i) => i !== index);
  const { [paneId]: _closed, ...panes } = ws.panes;
  let activeTab = ws.activeTab;
  if (ws.tabs[index].id === ws.activeTab) {
    activeTab = (tabs[index] ?? tabs[index - 1])?.id;
  }
  return { tabs, activeTab, panes };
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

export function paneIds(node: LayoutNode): PaneId[] {
  return node.kind === "leaf" ? [node.pane] : node.children.flatMap(paneIds);
}
