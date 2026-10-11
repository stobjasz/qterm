import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

import {
  getConfig,
  hideWindow,
  listProfiles,
  onConfigChanged,
  onQuakeVisibility,
  type ConfigSnapshot,
  type Profile,
} from "./ipc";
import { buildKeymap, type Command } from "./keybindings";
import { TabBar } from "./tabs/TabBar";
import { LayoutView } from "./terminal/LayoutView";
import { TerminalRegistry, type RegistryEvents } from "./terminal/registry";
import {
  activateIndex,
  activateTab,
  activeTab,
  closePane,
  cycleTab,
  emptyWorkspace,
  equalizeActive,
  focusPane,
  moveFocus,
  openTab,
  paneIds,
  resizeDivider,
  resizeFocused,
  setPaneTitle,
  splitPane,
  type PaneId,
  type SplitDir,
  type TabId,
} from "./workspace/workspace";

const DEFAULT_SLIDE_MS = 150;
const DEFAULT_OPACITY = 0.82;
/** Share of the split one Alt+Shift+Arrow press moves a divider. */
const RESIZE_STEP = 0.05;

let idCounter = 0;
const nextId = (prefix: string) => `${prefix}-${++idCounter}`;

export default function App() {
  const [shown, setShown] = useState(false);
  const [slideMs, setSlideMs] = useState(DEFAULT_SLIDE_MS);
  const [profiles, setProfiles] = useState<Profile[]>();
  const [settings, setSettings] = useState<ConfigSnapshot>();
  const config = settings?.config;
  const [workspace, setWorkspace] = useState(emptyWorkspace);
  const workspaceRef = useRef(workspace);
  workspaceRef.current = workspace;

  // The registry outlives renders; its events reach the latest handlers through this ref.
  const handlers = useRef<RegistryEvents>(null!);
  const [registry] = useState(
    () =>
      new TerminalRegistry({
        onCommand: (paneId, command) => handlers.current.onCommand(paneId, command),
        onTitle: (paneId, title) => handlers.current.onTitle(paneId, title),
        onExit: (paneId, code) => handlers.current.onExit(paneId, code),
      }),
  );

  const keymap = useMemo(() => buildKeymap(config?.keybindings), [config?.keybindings]);
  useEffect(() => registry.setKeymap(keymap), [registry, keymap]);
  useEffect(() => {
    if (config) registry.setFont(config.font);
  }, [registry, config]);

  const defaultProfile = profiles?.find((p) => p.id === config?.defaultProfile) ?? profiles?.[0];
  const errors = [
    settings?.error,
    ...keymap.errors,
    config?.defaultProfile && profiles && !profiles.some((p) => p.id === config.defaultProfile)
      ? `default_profile = "${config.defaultProfile}" is not one of: ${profiles.map((p) => p.id).join(", ")}`
      : undefined,
  ].filter((e): e is string => Boolean(e));

  const newTab = useCallback(
    (profileId?: string) => {
      const profile = profileId ? profiles?.find((p) => p.id === profileId) : defaultProfile;
      if (!profile) return;
      setWorkspace((ws) => openTab(ws, { tab: nextId("tab"), pane: nextId("pane") }, profile));
    },
    [profiles, defaultProfile],
  );

  // The new pane runs the same profile as the one being split (a WSL pane splits into WSL).
  const split = useCallback(
    (paneId: PaneId, dir: SplitDir) => {
      const source = workspaceRef.current.panes[paneId];
      const profile = profiles?.find((p) => p.id === source?.profileId) ?? defaultProfile;
      if (!profile) return;
      setWorkspace((ws) => splitPane(ws, paneId, dir, nextId("pane"), profile));
    },
    [profiles, defaultProfile],
  );

  const closePaneById = useCallback(
    (paneId: PaneId) => {
      registry.dispose(paneId);
      setWorkspace((ws) => closePane(ws, paneId));
    },
    [registry],
  );

  const closeTab = useCallback(
    (tabId: TabId) => {
      const tab = workspaceRef.current.tabs.find((t) => t.id === tabId);
      if (tab) paneIds(tab.root).forEach(closePaneById);
    },
    [closePaneById],
  );

  handlers.current = {
    onCommand(paneId: PaneId, command: Command) {
      switch (command.type) {
        case "newTab":
          if (command.profileIndex === undefined) newTab();
          else if (profiles?.[command.profileIndex]) newTab(profiles[command.profileIndex].id);
          break;
        case "closePane":
          closePaneById(paneId);
          break;
        case "cycleTab":
          setWorkspace((ws) => cycleTab(ws, command.delta));
          break;
        case "goToTab":
          setWorkspace((ws) => activateIndex(ws, command.index));
          break;
        case "split":
          split(paneId, command.dir);
          break;
        case "moveFocus":
          setWorkspace((ws) => moveFocus(ws, command.direction));
          break;
        case "resizePane":
          setWorkspace((ws) => resizeFocused(ws, command.direction, RESIZE_STEP));
          break;
        case "equalize":
          setWorkspace(equalizeActive);
          break;
      }
    },
    onTitle: (paneId, title) => setWorkspace((ws) => setPaneTitle(ws, paneId, title)),
    // Like Windows Terminal's "graceful" close: a clean exit closes the pane,
    // a failure stays on screen so the error can be read.
    onExit: (paneId, code) => code === 0 && closePaneById(paneId),
  };

  useEffect(() => {
    void listProfiles().then(setProfiles);
    void getConfig().then(setSettings);
    const unlistenConfig = onConfigChanged(setSettings);
    const unlisten = onQuakeVisibility(({ visible, slideMs }) => {
      setSlideMs(slideMs);
      setShown(visible);
    });
    // The window may already be on screen before this listener exists (first launch).
    void getCurrentWindow()
      .isVisible()
      .then((visible) => visible && setShown(true));
    // A reload (dev) or close would otherwise leave the shells running in Rust.
    const disposeAll = () => registry.disposeAll();
    window.addEventListener("beforeunload", disposeAll);
    return () => {
      void unlisten.then((fn) => fn());
      void unlistenConfig.then((fn) => fn());
      window.removeEventListener("beforeunload", disposeAll);
    };
  }, [registry]);

  // The console always has a shell: open one at start, and after the last tab
  // closes open a fresh one and get out of the way.
  const hadTabs = useRef(false);
  useEffect(() => {
    if (workspace.tabs.length > 0) {
      hadTabs.current = true;
      return;
    }
    if (!profiles || !settings) return;
    newTab();
    if (hadTabs.current) void hideWindow();
  }, [workspace.tabs.length, profiles, settings, newTab]);

  const focusedPane = activeTab(workspace)?.focusedPane;
  useEffect(() => {
    if (shown && focusedPane) registry.focus(focusedPane);
  }, [registry, shown, focusedPane]);

  return (
    <div
      className={`console${shown ? " shown" : ""}`}
      style={
        {
          "--slide-ms": `${slideMs}ms`,
          "--console-bg": `rgba(14, 16, 22, ${config?.opacity ?? DEFAULT_OPACITY})`,
        } as CSSProperties
      }
    >
      <div className="tab-panels">
        {workspace.tabs.map((tab) => (
          <div key={tab.id} className="tab-panel" role="tabpanel" hidden={tab.id !== workspace.activeTab}>
            <LayoutView
              node={tab.root}
              path={[]}
              panes={workspace.panes}
              focusedPane={tab.focusedPane}
              showFocus={tab.root.kind === "split"}
              registry={registry}
              onFocusPane={(paneId) => setWorkspace((ws) => focusPane(ws, paneId))}
              onResize={(path, index, delta) => setWorkspace((ws) => resizeDivider(ws, tab.id, path, index, delta))}
            />
          </div>
        ))}
      </div>
      {errors.length > 0 && (
        <div className="settings-errors" role="alert">
          <strong>Settings problem</strong> (previous values stay in effect until it is fixed):
          <ul>
            {errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        </div>
      )}
      <TabBar
        workspace={workspace}
        profiles={profiles ?? []}
        onActivate={(tabId) => setWorkspace((ws) => activateTab(ws, tabId))}
        onClose={closeTab}
        onNewTab={newTab}
        onSplit={(dir) => focusedPane && split(focusedPane, dir)}
      />
    </div>
  );
}
