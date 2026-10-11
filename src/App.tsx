import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { hideWindow, listProfiles, onQuakeVisibility, type Profile } from "./ipc";
import type { Command } from "./keybindings";
import { TabBar } from "./tabs/TabBar";
import { PaneView } from "./terminal/PaneView";
import { TerminalRegistry, type RegistryEvents } from "./terminal/registry";
import {
  activateIndex,
  activateTab,
  activeTab,
  closePane,
  cycleTab,
  emptyWorkspace,
  openTab,
  paneIds,
  setPaneTitle,
  type PaneId,
  type TabId,
} from "./workspace/workspace";

const DEFAULT_SLIDE_MS = 150;

let idCounter = 0;
const nextId = (prefix: string) => `${prefix}-${++idCounter}`;

export default function App() {
  const [shown, setShown] = useState(false);
  const [slideMs, setSlideMs] = useState(DEFAULT_SLIDE_MS);
  const [profiles, setProfiles] = useState<Profile[]>();
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

  const newTab = useCallback(
    (profileId?: string) => {
      const profile = profileId ? profiles?.find((p) => p.id === profileId) : profiles?.[0];
      if (!profile) return;
      setWorkspace((ws) => openTab(ws, { tab: nextId("tab"), pane: nextId("pane") }, profile));
    },
    [profiles],
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
      }
    },
    onTitle: (paneId, title) => setWorkspace((ws) => setPaneTitle(ws, paneId, title)),
    // Like Windows Terminal's "graceful" close: a clean exit closes the pane,
    // a failure stays on screen so the error can be read.
    onExit: (paneId, code) => code === 0 && closePaneById(paneId),
  };

  useEffect(() => {
    void listProfiles().then(setProfiles);
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
    if (!profiles) return;
    newTab();
    if (hadTabs.current) void hideWindow();
  }, [workspace.tabs.length, profiles, newTab]);

  const focusedPane = activeTab(workspace)?.focusedPane;
  useEffect(() => {
    if (shown && focusedPane) registry.focus(focusedPane);
  }, [registry, shown, focusedPane]);

  return (
    <div className={`console${shown ? " shown" : ""}`} style={{ "--slide-ms": `${slideMs}ms` } as CSSProperties}>
      <div className="tab-panels">
        {workspace.tabs.map((tab) => (
          <div key={tab.id} className="tab-panel" role="tabpanel" hidden={tab.id !== workspace.activeTab}>
            {paneIds(tab.root).map((paneId) => (
              <PaneView key={paneId} pane={workspace.panes[paneId]} registry={registry} />
            ))}
          </div>
        ))}
      </div>
      <TabBar
        workspace={workspace}
        profiles={profiles ?? []}
        onActivate={(tabId) => setWorkspace((ws) => activateTab(ws, tabId))}
        onClose={closeTab}
        onNewTab={newTab}
      />
    </div>
  );
}
