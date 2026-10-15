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
  swapLeaves,
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
  /** Runs as administrator (Windows' sudo). Not saved: a restart reopens it unelevated. */
  elevated?: boolean;
  /** Claude Code session that ran here before the restart (see saveWorkspace). */
  claudeSession?: string;
  /** Chosen for this pane ("#rrggbb"); wins over its shell's background. */
  background?: string;
  /** Title of the last Claude Code session here; names the tab, also after Claude exits. */
  claudeTitle?: string;
  /** What the project the pane is in sets for its tab (.qterm.toml). Not saved: read again from the folder. */
  project?: ProjectLook;
}

/** A project's own tab name, colour and icon. */
export interface ProjectLook {
  name?: string;
  color?: TabColor;
  icon?: string;
}

/** A pane background colour as stored: "#rrggbb". */
export function isPaneColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value);
}

/** Colours a tab can be marked with (right-click a tab). */
export const TAB_COLORS = ["red", "orange", "yellow", "green", "teal", "blue", "purple", "pink"] as const;
export type TabColor = (typeof TAB_COLORS)[number];

/** Longest Claude session title kept with the tabs (Rust shortens them to 80 characters). */
const MAX_CLAUDE_TITLE = 200;

/** Longest tab icon: an emoji or a few letters. */
const MAX_ICON = 4;

export interface Tab {
  id: TabId;
  root: LayoutNode;
  focusedPane: PaneId;
  /** Set by renaming the tab; wins over the shell's title. */
  title?: string;
  /** This pane fills the tab for now (not saved). */
  zoomed?: PaneId;
  /** Typing goes to every pane of the tab (not saved). */
  broadcast?: boolean;
  /** Chosen by right-clicking the tab; wins over its profile's colour and icon. */
  color?: TabColor;
  icon?: string;
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
  elevated?: boolean,
): Workspace {
  const tab: Tab = { id: ids.tab, root: { kind: "leaf", pane: ids.pane }, focusedPane: ids.pane };
  const panes = withPane(ws.panes, ids.pane, profile, cwd);
  if (elevated) panes[ids.pane] = { ...panes[ids.pane], elevated };
  return { tabs: [...ws.tabs, tab], activeTab: tab.id, panes };
}

/** A new tab with a prepared layout (see layouts.ts), focused on its first pane. */
export function openTabWith(ws: Workspace, tabId: TabId, root: LayoutNode, panes: Pane[], title?: string): Workspace {
  const tab: Tab = { id: tabId, root, focusedPane: paneIds(root)[0], ...(title ? { title } : {}) };
  return {
    tabs: [...ws.tabs, tab],
    activeTab: tabId,
    panes: { ...ws.panes, ...Object.fromEntries(panes.map((p) => [p.id, p])) },
  };
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
  const { zoomed: _zoom, ...unzoomed } = tab;
  return {
    ...replaceTab(ws, { ...unzoomed, root: insertSplit(tab.root, paneId, dir, newPane), focusedPane: newPane }),
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
    const { zoomed, ...rest } = tab;
    const kept = zoomed === paneId ? rest : tab;
    return { ...replaceTab(ws, { ...kept, root, focusedPane }), panes };
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
  if (!tab || !target) return ws;
  const { zoomed: _zoom, ...unzoomed } = tab;
  return focusPane(replaceTab(ws, unzoomed), target);
}

/** Lets the focused pane fill the tab, or back. Only with more than one pane. */
export function toggleZoom(ws: Workspace): Workspace {
  const tab = activeTab(ws);
  if (!tab || tab.root.kind === "leaf") return ws;
  const { zoomed, ...rest } = tab;
  return replaceTab(ws, zoomed ? rest : { ...rest, zoomed: tab.focusedPane });
}

/** Swaps the focused pane with its neighbour in `direction`; focus stays with it. */
export function swapPane(ws: Workspace, direction: Direction): Workspace {
  const tab = activeTab(ws);
  const other = tab && neighbor(tab.root, tab.focusedPane, direction);
  if (!tab || !other) return ws;
  return replaceTab(ws, { ...tab, root: swapLeaves(tab.root, tab.focusedPane, other) });
}

/** Typing into one pane of the active tab goes to all of them, or back. */
export function toggleBroadcast(ws: Workspace): Workspace {
  const tab = activeTab(ws);
  if (!tab) return ws;
  const { broadcast, ...rest } = tab;
  return replaceTab(ws, broadcast ? rest : { ...rest, broadcast: true });
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
/** Sets (or, with undefined, clears) a tab's colour and/or icon. */
export function setTabStyle(ws: Workspace, tabId: TabId, style: { color?: TabColor | null; icon?: string | null }): Workspace {
  const tab = ws.tabs.find((t) => t.id === tabId);
  if (!tab) return ws;
  const next: Tab = { ...tab };
  if (style.color !== undefined) {
    if (style.color) next.color = style.color;
    else delete next.color;
  }
  if (style.icon !== undefined) {
    const icon = style.icon ? [...style.icon.trim()].slice(0, MAX_ICON).join("") : "";
    if (icon) next.icon = icon;
    else delete next.icon;
  }
  return replaceTab(ws, next);
}

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

/** Sets (or, with null, clears) the background chosen for one pane. */
export function setPaneBackground(ws: Workspace, paneId: PaneId, color: string | null): Workspace {
  const pane = ws.panes[paneId];
  if (!pane || (color !== null && !isPaneColor(color))) return ws;
  const next: Pane = { ...pane };
  if (color) next.background = color.toLowerCase();
  else delete next.background;
  return { ...ws, panes: { ...ws.panes, [paneId]: next } };
}

/** Sets (or, with undefined, clears) what the pane's project sets for its tab; the same workspace if nothing changed. */
export function setPaneProject(ws: Workspace, paneId: PaneId, project: ProjectLook | undefined): Workspace {
  const pane = ws.panes[paneId];
  if (!pane || JSON.stringify(pane.project) === JSON.stringify(project)) return ws;
  const next: Pane = { ...pane };
  if (project) next.project = project;
  else delete next.project;
  return { ...ws, panes: { ...ws.panes, [paneId]: next } };
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

/**
 * The custom title, else the name the focused pane's project gives it, else the title
 * of the Claude session there, else its shell title, else its profile name.
 */
export function tabTitle(ws: Workspace, tab: Tab): string {
  if (tab.title) return tab.title;
  const pane = ws.panes[tab.focusedPane];
  if (!pane) return "";
  if (pane.project?.name) return pane.project.name;
  if (pane.claudeTitle) return pane.claudeTitle;
  const title = pane.title.trim();
  return title && !EXE_PATH.test(title) ? title : pane.profileName;
}

/** Records the titles of the Claude sessions running in panes; the same workspace if none changed. */
export function withClaudeTitles(ws: Workspace, titles: ReadonlyMap<PaneId, string>): Workspace {
  let panes = ws.panes;
  for (const [paneId, title] of titles) {
    const pane = panes[paneId];
    if (!pane || pane.claudeTitle === title) continue;
    panes = { ...panes, [paneId]: { ...pane, claudeTitle: title } };
  }
  return panes === ws.panes ? ws : { ...ws, panes };
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
  tabs: { id: TabId; title?: string; color?: TabColor; icon?: string; root: LayoutNode; focusedPane: PaneId }[];
  panes: Record<PaneId, { profileId: string; cwd?: string; claude?: string; background?: string; claudeTitle?: string }>;
}

/**
 * What is worth keeping: layout, profiles, folders, custom titles, tab colours and
 * icons, and which Claude Code session runs in each pane (`claude`, pane → session
 * id), for resuming them on start. Shell titles are not kept.
 */
export function saveWorkspace(ws: Workspace, claude: ReadonlyMap<PaneId, string> = new Map()): string {
  const saved: SavedSession = {
    version: 1,
    activeTab: ws.activeTab,
    tabs: ws.tabs.map(({ id, title, color, icon, root, focusedPane }) => ({ id, title, color, icon, root, focusedPane })),
    panes: Object.fromEntries(
      Object.values(ws.panes).map((p) => [
        p.id,
        { profileId: p.profileId, cwd: p.cwd, claude: claude.get(p.id), background: p.background, claudeTitle: p.claudeTitle },
      ]),
    ),
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
      // Typed into a shell later, so only something shaped like a session id.
      const claudeSession = typeof savedPane.claude === "string" && /^[\w-]{1,64}$/.test(savedPane.claude) ? savedPane.claude : undefined;
      panes[id] = {
        id,
        profileId: profile.id,
        profileName: profile.name,
        title: "",
        cwd,
        ...(claudeSession ? { claudeSession } : {}),
        ...(isPaneColor(savedPane.background) ? { background: savedPane.background } : {}),
        ...(typeof savedPane.claudeTitle === "string" && savedPane.claudeTitle.trim() && savedPane.claudeTitle.length <= MAX_CLAUDE_TITLE
          ? { claudeTitle: savedPane.claudeTitle }
          : {}),
      };
    }
    const focusedPane = ids.includes(raw.focusedPane) ? raw.focusedPane : ids[0];
    tabs.push({
      id: raw.id,
      root: raw.root,
      focusedPane,
      ...(typeof raw.title === "string" && raw.title ? { title: raw.title } : {}),
      ...(TAB_COLORS.includes(raw.color as TabColor) ? { color: raw.color } : {}),
      ...(typeof raw.icon === "string" && raw.icon && [...raw.icon].length <= MAX_ICON ? { icon: raw.icon } : {}),
    });
  }
  const activeTab = tabs.some((t) => t.id === saved.activeTab) ? saved.activeTab : tabs[0].id;
  return { tabs, activeTab, panes };
}

/**
 * Adds another workspace's tabs (a saved named workspace) after the open ones, with
 * fresh tab and pane ids so the same one can be opened twice. Its first tab becomes
 * active. Claude sessions aren't carried over: resuming is for restarts only.
 */
export function appendWorkspace(ws: Workspace, add: Workspace, nextId: (kind: "tab" | "pane") => string): Workspace {
  const paneIdMap = new Map(Object.keys(add.panes).map((id) => [id, nextId("pane")]));
  const remap = (node: LayoutNode): LayoutNode =>
    node.kind === "leaf" ? { kind: "leaf", pane: paneIdMap.get(node.pane)! } : { ...node, children: node.children.map(remap) };
  const panes = { ...ws.panes };
  for (const pane of Object.values(add.panes)) {
    const id = paneIdMap.get(pane.id)!;
    const { claudeSession: _resume, ...rest } = pane;
    panes[id] = { ...rest, id, title: "" };
  }
  const tabs = add.tabs.map((tab) => {
    const { zoomed: _zoomed, broadcast: _broadcast, ...rest } = tab;
    return { ...rest, id: nextId("tab"), root: remap(tab.root), focusedPane: paneIdMap.get(tab.focusedPane)! };
  });
  if (tabs.length === 0) return ws;
  return { tabs: [...ws.tabs, ...tabs], activeTab: tabs[0].id, panes };
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
