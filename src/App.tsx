import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

import {
  claudeSessionSeen,
  forgetClaudeSessions,
  getConfig,
  hideWindow,
  listClaudeSessions,
  listProfiles,
  loadSession,
  onClaudeSessionsChanged,
  onConfigChanged,
  onOpenSettings,
  onQuakeVisibility,
  saveSession,
  uiReady,
  type ClaudeSession,
  type ConfigSnapshot,
  type Profile,
} from "./ipc";
import { buildKeymap, type Command } from "./keybindings";
import { HeightHandle } from "./HeightHandle";
import { SettingsPanel } from "./settings/SettingsPanel";
import { TabBar } from "./tabs/TabBar";
import { LayoutView } from "./terminal/LayoutView";
import { TerminalRegistry, type PaneSpec, type RegistryEvents } from "./terminal/registry";
import { SearchBar } from "./terminal/SearchBar";
import { THEMES, themeOrDefault, withAlpha } from "./terminal/themes";
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
  moveTab,
  openTab,
  paneIds,
  renameTab,
  resizeDivider,
  resizeFocused,
  restoreWorkspace,
  saveWorkspace,
  setPaneCwd,
  setPaneTitle,
  splitPane,
  type Pane,
  type PaneId,
  type SplitDir,
  type TabId,
} from "./workspace/workspace";

const DEFAULT_SLIDE_MS = 150;
const DEFAULT_OPACITY = 0.82;
/** Share of the split one Alt+Shift+Arrow press moves a divider. */
const RESIZE_STEP = 0.05;
/** The layout is saved this long after the last change. */
const SAVE_DELAY_MS = 400;

// Random, so ids from a restored session never collide with new ones.
const nextId = (prefix: string) => `${prefix}-${crypto.randomUUID().slice(0, 8)}`;

export default function App() {
  const [shown, setShown] = useState(false);
  const [slideMs, setSlideMs] = useState(DEFAULT_SLIDE_MS);
  const [profiles, setProfiles] = useState<Profile[]>();
  const [settings, setSettings] = useState<ConfigSnapshot>();
  const [workspace, setWorkspace] = useState(emptyWorkspace);
  const [claudeSessions, setClaudeSessions] = useState<ClaudeSession[]>([]);
  const [search, setSearch] = useState<{ pane: PaneId; results?: { index: number; count: number } }>();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const config = settings?.config;
  const workspaceRef = useRef(workspace);
  workspaceRef.current = workspace;
  // Dev builds only: lets tests and debugging read the live workspace.
  if (import.meta.env.DEV) (window as unknown as { __qterm: unknown }).__qterm = { workspace: () => workspaceRef.current };
  /** Typed into a pane's shell once it starts (resuming a Claude session). */
  const startupInput = useRef(new Map<PaneId, string>());

  // The registry outlives renders; its events reach the latest handlers through this ref.
  const handlers = useRef<RegistryEvents>(null!);
  const [registry] = useState(
    () =>
      new TerminalRegistry({
        onCommand: (...args) => handlers.current.onCommand(...args),
        onTitle: (...args) => handlers.current.onTitle(...args),
        onExit: (...args) => handlers.current.onExit(...args),
        onCwd: (...args) => handlers.current.onCwd(...args),
        onClaudeSession: (...args) => handlers.current.onClaudeSession(...args),
        onSearchResults: (...args) => handlers.current.onSearchResults(...args),
      }),
  );

  // --- settings applied to the terminals ---------------------------------------
  const keymap = useMemo(() => buildKeymap(config?.keybindings), [config?.keybindings]);
  const theme = themeOrDefault(config?.theme);
  useEffect(() => registry.setKeymap(keymap), [registry, keymap]);
  useEffect(() => registry.setTheme(theme), [registry, theme]);
  useEffect(() => {
    if (!config) return;
    registry.setFont(config.font);
    registry.setBehavior({
      copyOnSelect: config.copyOnSelect,
      rightClickPaste: config.rightClickPaste,
      claudeSessions: config.claudeSessions,
    });
  }, [registry, config]);

  const defaultProfile = profiles?.find((p) => p.id === config?.defaultProfile) ?? profiles?.[0];
  const errors = [
    settings?.error,
    ...keymap.errors,
    config?.defaultProfile && profiles && !profiles.some((p) => p.id === config.defaultProfile)
      ? `default_profile = "${config.defaultProfile}" is not one of: ${profiles.map((p) => p.id).join(", ")}`
      : undefined,
    config && !THEMES[config.theme] ? `theme = "${config.theme}" is not one of: ${Object.keys(THEMES).join(", ")}` : undefined,
  ].filter((e): e is string => Boolean(e));

  // --- workspace actions -------------------------------------------------------
  const newTab = useCallback(
    (profileId?: string, cwd?: string) => {
      const profile = profileId ? profiles?.find((p) => p.id === profileId) : defaultProfile;
      if (!profile) return undefined;
      const ids = { tab: nextId("tab"), pane: nextId("pane") };
      setWorkspace((ws) => openTab(ws, ids, profile, cwd));
      return ids.pane;
    },
    [profiles, defaultProfile],
  );

  // A split runs the same profile in the same folder as the pane being split.
  const split = useCallback(
    (paneId: PaneId, dir: SplitDir) => {
      const source = workspaceRef.current.panes[paneId];
      const profile = profiles?.find((p) => p.id === source?.profileId) ?? defaultProfile;
      if (!profile) return;
      setWorkspace((ws) => splitPane(ws, paneId, dir, nextId("pane"), profile, source?.cwd));
    },
    [profiles, defaultProfile],
  );

  const closePaneById = useCallback(
    (paneId: PaneId) => {
      registry.dispose(paneId);
      startupInput.current.delete(paneId);
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

  /** Opens a tab in the session's folder and types `claude --resume <id>` there. */
  const resumeClaude = useCallback(
    (session: ClaudeSession) => {
      const recorded = profiles?.find((p) => p.id === session.profileId);
      // A Windows folder can't be entered from WSL (and vice versa): use the default shell then.
      const windowsPath = session.cwd ? /^[A-Za-z]:\\/.test(session.cwd) : true;
      const profile = recorded && recorded.id.startsWith("wsl:") === !windowsPath ? recorded : defaultProfile;
      const paneId = newTab(profile?.id, session.cwd ?? undefined);
      if (paneId) startupInput.current.set(paneId, `claude --resume ${session.id}\r`);
    },
    [profiles, defaultProfile, newTab],
  );

  const paneSpec = useCallback(
    (pane: Pane): PaneSpec => ({ profileId: pane.profileId, cwd: pane.cwd, startupInput: startupInput.current.get(pane.id) }),
    [],
  );

  const focusedPane = activeTab(workspace)?.focusedPane;

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
        case "copy":
          registry.copy(paneId);
          break;
        case "paste":
          void registry.paste(paneId);
          break;
        case "find":
          setSearch({ pane: paneId });
          break;
        case "settings":
          setSettingsOpen((open) => !open);
          break;
      }
    },
    onTitle: (paneId, title) => setWorkspace((ws) => setPaneTitle(ws, paneId, title)),
    // Like Windows Terminal's "graceful" close: a clean exit closes the pane,
    // a failure stays on screen so the error can be read.
    onExit: (paneId, code) => code === 0 && closePaneById(paneId),
    onCwd: (paneId, cwd) => setWorkspace((ws) => setPaneCwd(ws, paneId, cwd)),
    onClaudeSession: (paneId, id) => {
      const pane = workspaceRef.current.panes[paneId];
      if (pane) void claudeSessionSeen(id, pane.profileId, pane.cwd);
    },
    onSearchResults: (paneId, results) => setSearch((s) => (s?.pane === paneId ? { ...s, results } : s)),
  };

  // --- startup, events ---------------------------------------------------------
  useEffect(() => {
    void listProfiles().then(setProfiles);
    void getConfig().then(setSettings);
    void listClaudeSessions().then(setClaudeSessions);
    const listeners = [
      onConfigChanged(setSettings),
      onClaudeSessionsChanged(setClaudeSessions),
      onOpenSettings(() => setSettingsOpen(true)),
      onQuakeVisibility(({ visible, slideMs }) => {
        setSlideMs(slideMs);
        setShown(visible);
      }),
    ];
    // Rust shows the console on launch only after this, so the event isn't missed.
    void Promise.all(listeners).then(() => uiReady());
    // After a page reload the window can already be on screen.
    void getCurrentWindow()
      .isVisible()
      .then((visible) => visible && setShown(true));
    // A reload (dev) or close would otherwise leave the shells running in Rust.
    const disposeAll = () => registry.disposeAll();
    window.addEventListener("beforeunload", disposeAll);
    return () => {
      listeners.forEach((l) => void l.then((unlisten) => unlisten()));
      window.removeEventListener("beforeunload", disposeAll);
    };
  }, [registry]);

  // The console always has a shell. At start: the saved layout (if enabled) or one
  // fresh tab. After the last tab closes: a fresh tab, and the console gets out of the way.
  const started = useRef(false);
  useEffect(() => {
    if (workspace.tabs.length > 0 || !profiles || !config) return;
    if (started.current) {
      newTab();
      void hideWindow();
      return;
    }
    started.current = true;
    void (config.restoreSession ? loadSession() : Promise.resolve(null)).then((saved) => {
      const restored = saved ? restoreWorkspace(saved, profiles) : undefined;
      if (restored) setWorkspace(restored);
      else newTab();
    });
  }, [workspace.tabs.length, profiles, config, newTab]);

  // Save the layout shortly after it changes (shell titles alone don't count).
  const lastSaved = useRef<string>(undefined);
  useEffect(() => {
    if (!started.current || workspace.tabs.length === 0) return;
    const text = saveWorkspace(workspace);
    if (text === lastSaved.current) return;
    const timer = window.setTimeout(() => {
      lastSaved.current = text;
      void saveSession(text);
    }, SAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [workspace]);

  useEffect(() => {
    if (shown && focusedPane && !search && !settingsOpen) registry.focus(focusedPane);
  }, [registry, shown, focusedPane, search, settingsOpen]);

  const closeSearch = () => {
    if (search) registry.clearSearch(search.pane);
    setSearch(undefined);
  };

  return (
    <div
      className={`console${shown ? " shown" : ""}${theme.light ? " light" : ""}`}
      style={
        {
          "--slide-ms": `${slideMs}ms`,
          "--console-bg": withAlpha(theme.background, config?.opacity ?? DEFAULT_OPACITY),
          "--console-edge": theme.accent,
          "--theme-fg": theme.foreground,
          "--theme-bg": theme.background,
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
              spec={paneSpec}
              onFocusPane={(paneId) => setWorkspace((ws) => focusPane(ws, paneId))}
              onResize={(path, index, delta) => setWorkspace((ws) => resizeDivider(ws, tab.id, path, index, delta))}
            />
          </div>
        ))}
        {search && (
          <SearchBar
            results={search.results}
            onSearch={(query, options, backwards) => registry.find(search.pane, query, options, backwards)}
            onClose={closeSearch}
          />
        )}
        {settingsOpen && settings && profiles && (
          <SettingsPanel snapshot={settings} profiles={profiles} onClose={() => setSettingsOpen(false)} />
        )}
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
        claude={
          config?.claudeSessions
            ? { sessions: claudeSessions, onResume: resumeClaude, onForget: (ids) => void forgetClaudeSessions(ids) }
            : undefined
        }
        onActivate={(tabId) => setWorkspace((ws) => activateTab(ws, tabId))}
        onClose={closeTab}
        onNewTab={(profileId) => newTab(profileId)}
        onSplit={(dir) => focusedPane && split(focusedPane, dir)}
        onRename={(tabId, title) => setWorkspace((ws) => renameTab(ws, tabId, title))}
        onMove={(tabId, toIndex) => setWorkspace((ws) => moveTab(ws, tabId, toIndex))}
        onOpenSettings={() => setSettingsOpen((open) => !open)}
      />
      <HeightHandle />
    </div>
  );
}
