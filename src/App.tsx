import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

import {
  claudeSessionSeen,
  claudeRunning,
  onClaudeAttention,
  onClaudeSessionStart,
  claudeUsage,
  type ClaudeUsage,
  type PaneClaudeSession,
  openElevatedWindow,
  sudoStatus,
  onFocusPane,
  onFileDrag,
  setAttentionCount,
  showClaudeAlert,
  type ClaudeAlert,
  forgetClaudeSessions,
  getConfig,
  hideWindow,
  listClaudeSessions,
  listProfiles,
  loadSession,
  onClaudeSessionsChanged,
  onConfigChanged,
  onOpenSettings,
  onCheckUpdates,
  onOpenHere,
  takeOpenHere,
  loadHistory,
  saveHistory,
  chooseOutputFile,
  setPinned as setPinnedInRust,
  onClaudeStatusline,
  showPlanWarning,
  setPlanSummary,
  type StatuslineUsage,
  takeVersionChange,
  loadWorkspaces,
  saveWorkspaces,
  openInEditor,
  resolveFiles,
  saveOutput,
  onUpdateAvailable,
  installUpdate,
  type UpdateInfo,
  onQuakeVisibility,
  onQuitRequested,
  quitNow,
  loadScrollback,
  pruneScrollback,
  deleteScrollback,
  saveScrollback,
  deleteLayout,
  saveLayout,
  openConfigFile,
  saveConfig,
  saveSession,
  uiReady,
  type ClaudeSession,
  type ConfigSnapshot,
  type Profile,
} from "./ipc";
import { ACTION_LIST, buildKeymap, keyInput, resolveKey, type Command } from "./keybindings";
import { CommandPalette, type PaletteItem } from "./palette/CommandPalette";
import { HeightHandle } from "./HeightHandle";
import { SettingsPanel } from "./settings/SettingsPanel";
import { TabBar } from "./tabs/TabBar";
import { LayoutView } from "./terminal/LayoutView";
import { hasContent, plainLines } from "./terminal/content";
import { dropText } from "./terminal/drop";
import { resumeHereCommand } from "./claude/resume";
import { nextWaiting } from "./claude/waiting";
import { crossedWarning, formatReset, mergeUsage, planSummary, type PlanUsage } from "./claude/plan";
import { parseNamed, removeNamed, serializeNamed, upsertNamed, type NamedWorkspace } from "./workspace/named";
import { SaveWorkspaceDialog } from "./workspace/SaveWorkspaceDialog";
import { findTargets, labelsFor, type Target } from "./terminal/quickSelect";
import { compileTriggers } from "./terminal/triggers";
import { QuickSelectOverlay, type QuickSelectItem } from "./terminal/QuickSelectOverlay";
import { WhatsNew } from "./updates/WhatsNew";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { openUrl } from "@tauri-apps/plugin-opener";
import { emptyHistory, parseHistory, rememberCommand, rememberFolder, type History } from "./terminal/history";
import { formatDuration } from "./terminal/marks";
import { TerminalRegistry, type CommandBlock, type PaneSpec, type RegistryEvents } from "./terminal/registry";
import { PaneBackgroundMenu } from "./terminal/PaneBackgroundMenu";
import { CommandBlockMenu } from "./terminal/CommandBlockMenu";
import { SearchAllPanel } from "./terminal/SearchAllPanel";
import { SearchBar } from "./terminal/SearchBar";
import type { SearchHit, SearchOptions } from "./terminal/searchAll";
import { THEMES, themeOrDefault, withAlpha } from "./terminal/themes";
import { buildLayout, findProfile, layoutFromTab, type LayoutDef, type LayoutPane } from "./workspace/layouts";
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
  openTabWith,
  paneIds,
  renameTab,
  setTabStyle,
  setPaneBackground,
  TAB_COLORS,
  resizeDivider,
  resizeFocused,
  restoreWorkspace,
  saveWorkspace,
  setPaneCwd,
  setPaneTitle,
  splitPane,
  tabTitle,
  withClaudeTitles,
  appendWorkspace,
  swapPane,
  toggleBroadcast,
  toggleZoom,
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
/** Pane output is saved this often (only panes that printed since the last save). */
const SCROLLBACK_SAVE_MS = 30_000;
/** How often to look for Claude Code in the panes, and how recent output means "working". */
const CLAUDE_POLL_MS = 2000;
/** How long a notice stays over the tab bar. */
const NOTICE_MS = 10_000;
/** Transcripts are read incrementally, so this is cheap. */
const CLAUDE_USAGE_POLL_MS = 5000;
const CLAUDE_BUSY_MS = 2500;

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
  /** Tray → Check for updates…: Settings opens and checks. */
  const [checkRequest, setCheckRequest] = useState(0);
  const [update, setUpdate] = useState<UpdateInfo>();
  /** The banner offering the update; dismissing it leaves the offer in Settings. */
  const [updateBanner, setUpdateBanner] = useState(false);
  /** Panes where Claude Code is waiting for the user, with its latest message. */
  /** Claude Code's own figures per pane, and the plan usage (its status line, relayed). */
  const statuslines = useRef(new Map<PaneId, StatuslineUsage>());
  const [plan, setPlan] = useState<PlanUsage>();
  const planRef = useRef(plan);
  planRef.current = plan;
  /** "fiveHour:<resets>:80": warnings already given for this window. */
  const planWarned = useRef(new Set<string>());
  const planText = planSummary(plan, new Date());
  useEffect(() => void setPlanSummary(planText ?? null).catch(() => {}), [planText]);
  /** "What's new": once after an update, or from Settings → Updates. */
  const [whatsNew, setWhatsNew] = useState<{ version: string; from?: string }>();
  useEffect(() => void takeVersionChange().then((change) => change && setWhatsNew({ version: change.to, from: change.from }), () => {}), []);
  /** Pinned open (📌): Rust ignores hide-on-blur and the hotkey's hide meanwhile. Not kept across restarts. */
  const [pinned, setPinned] = useState(false);
  const pinnedRef = useRef(pinned);
  pinnedRef.current = pinned;
  const togglePin = useCallback(() => {
    const next = !pinnedRef.current;
    setPinned(next);
    void setPinnedInRust(next);
  }, []);
  /** Quick select (Alt+Shift+S): labels over the focused pane, and what was typed. */
  const [quickSelect, setQuickSelect] = useState<{ paneId: PaneId; items: QuickSelectItem[] }>();
  const [quickTyped, setQuickTyped] = useState("");
  /** Named workspaces (workspaces.json); the name dialog when saving one. */
  const [namedWorkspaces, setNamedWorkspaces] = useState<NamedWorkspace[]>([]);
  const [savingWorkspace, setSavingWorkspace] = useState(false);
  /** Recent commands and folders across panes, for the palette (history.json). */
  const [history, setHistory] = useState<History>(emptyHistory);
  const historyLoaded = useRef(false);
  const [attention, setAttention] = useState<ReadonlyMap<PaneId, ClaudeAlert>>(new Map());
  const attentionRef = useRef(attention);
  attentionRef.current = attention;
  /** Background panes that printed something, or rang the bell, since last seen. */
  const [activity, setActivity] = useState<ReadonlySet<PaneId>>(new Set());
  const [bells, setBells] = useState<ReadonlySet<PaneId>>(new Set());
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [searchAllOpen, setSearchAllOpen] = useState(false);
  const [paneMenu, setPaneMenu] = useState<{ paneId: PaneId; x: number; y: number }>();
  /** A click on a command's ✓/✗ bar: its menu. */
  const [blockMenu, setBlockMenu] = useState<{ paneId: PaneId; block: CommandBlock; x: number; y: number }>();
  /** Panes with Claude Code running: working (recent output) or idle. */
  const [claudeStatus, setClaudeStatus] = useState<ReadonlyMap<PaneId, "busy" | "idle">>(new Map());
  const [claudeUsages, setClaudeUsages] = useState<ReadonlyMap<PaneId, ClaudeUsage>>(new Map());
  /** Which Claude session each pane runs, from the SessionStart hook. */
  const paneSessions = useRef(new Map<PaneId, PaneClaudeSession>());
  const config = settings?.config;
  const workspaceRef = useRef(workspace);
  workspaceRef.current = workspace;
  /** Typed into a pane's shell once it starts (resuming a Claude session). */
  const startupInput = useRef(new Map<PaneId, string>());
  /** Output saved before the restart, shown above each restored pane's new shell. */
  const restoredOutput = useRef(new Map<PaneId, string>());

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
        onActivity: (...args) => handlers.current.onActivity(...args),
        onBell: (...args) => handlers.current.onBell(...args),
        onCommandFinished: (...args) => handlers.current.onCommandFinished(...args),
        onPaneMenu: (...args) => handlers.current.onPaneMenu(...args),
        onCommandBlock: (...args) => handlers.current.onCommandBlock(...args),
        onTrigger: (...args) => handlers.current.onTrigger(...args),
      }),
  );
  // Dev builds only: lets tests and debugging read the live workspace and terminals.
  if (import.meta.env.DEV) (window as unknown as { __qterm: unknown }).__qterm = { workspace: () => workspaceRef.current, registry };

  // --- settings applied to the terminals ---------------------------------------
  const keymap = useMemo(() => buildKeymap(config?.keybindings), [config?.keybindings]);
  const triggers = useMemo(() => compileTriggers(config?.triggers ?? []), [config?.triggers]);
  useEffect(() => registry.setTriggers(triggers.triggers), [registry, triggers]);
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
      inlineImages: config.inlineImages,
      ligatures: config.font.ligatures,
    });
  }, [registry, config]);

  const defaultProfile = profiles?.find((p) => p.id === config?.defaultProfile) ?? profiles?.[0];
  const errors = [
    settings?.error,
    ...keymap.errors,
    ...triggers.errors,
    config?.defaultProfile && profiles && !profiles.some((p) => p.id === config.defaultProfile)
      ? `default_profile = "${config.defaultProfile}" is not one of: ${profiles.map((p) => p.id).join(", ")}`
      : undefined,
    config && !THEMES[config.theme] ? `theme = "${config.theme}" is not one of: ${Object.keys(THEMES).join(", ")}` : undefined,
    ...(config?.profiles ?? [])
      .filter((p) => p.theme && !THEMES[p.theme])
      .map((p) => `profile "${p.name}": theme = "${p.theme}" is not one of: ${Object.keys(THEMES).join(", ")}`),
    ...(config && profiles ? layoutProblems(config.layouts, profiles) : []),
  ].filter((e): e is string => Boolean(e));

  // --- workspace actions -------------------------------------------------------
  const newTab = useCallback(
    (profileId?: string, cwd?: string, elevated?: boolean) => {
      const profile = profileId ? profiles?.find((p) => p.id === profileId) : defaultProfile;
      if (!profile) return undefined;
      const ids = { tab: nextId("tab"), pane: nextId("pane") };
      setWorkspace((ws) => openTab(ws, ids, profile, cwd, elevated));
      return ids.pane;
    },
    [profiles, defaultProfile],
  );
  const newTabRef = useRef(newTab);
  newTabRef.current = newTab;

  /** A short message over the tab bar, e.g. why an admin tab opened as a window. */
  const [notice, setNotice] = useState<string>();
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(undefined), NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [notice]);

  /**
   * An administrator tab when Windows' sudo runs inline; otherwise the shell opens
   * as administrator in its own window, and the notice says how to get tabs.
   */
  const openAdminTab = useCallback(
    async (profileId: string) => {
      const mode = await sudoStatus().catch(() => "missing" as const);
      if (mode === "inline") {
        newTab(profileId, undefined, true);
        return;
      }
      const ws = workspaceRef.current;
      const cwd = ws.panes[activeTab(ws)?.focusedPane ?? ""]?.cwd;
      const why =
        mode === "missing"
          ? "Windows' sudo isn't available (Windows 11 24H2 or later)"
          : "Windows' sudo isn't set to Inline (Settings → System → Advanced → Enable sudo → Inline)";
      try {
        await openElevatedWindow(profileId, cwd);
        setNotice(`Opened as administrator in its own window. For administrator tabs here: ${why}.`);
      } catch (e) {
        setNotice(`${String(e)}. For administrator tabs here: ${why}.`);
      }
    },
    [newTab],
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
      setAttention((current) => without(current, paneId));
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

  const profilesRef = useRef(profiles);
  profilesRef.current = profiles;
  const claudeStatusRef = useRef<ReadonlyMap<PaneId, "busy" | "idle">>(new Map());
  /**
   * Resumes a session in the focused pane: its folder, then `claude --resume`. A new
   * tab instead when that pane is busy (Claude or another command running) or its
   * shell can't reach the folder.
   */
  const resumeClaudeHere = useCallback(
    (session: ClaudeSession) => {
      const ws = workspaceRef.current;
      const paneId = activeTab(ws)?.focusedPane;
      const pane = paneId ? ws.panes[paneId] : undefined;
      const kind = profilesRef.current?.find((p) => p.id === pane?.profileId)?.kind ?? "other";
      const command = resumeHereCommand(session.id, session.cwd, kind);
      const busy = paneId && (claudeStatusRef.current.has(paneId) || registry.commandRunning(paneId));
      if (!paneId || !command || busy) {
        setNotice(
          busy
            ? "That tab is busy (Claude Code or another command is running there), so the session opened in a new tab."
            : "That tab's shell can't open this session's folder, so it opened in a new tab.",
        );
        resumeClaude(session);
        return;
      }
      registry.focus(paneId);
      registry.typeSnippet(paneId, command, true);
    },
    [registry, resumeClaude],
  );
  /** A fresh Claude Code session in `cwd`, in a new tab with the default shell. */
  const newClaudeSession = useCallback(
    (cwd: string) => {
      const paneId = newTab(defaultProfile?.id, cwd);
      if (paneId) startupInput.current.set(paneId, "claude\r");
    },
    [newTab, defaultProfile],
  );

  const paneSpec = useCallback((pane: Pane): PaneSpec => {
    const profile = profilesRef.current?.find((p) => p.id === pane.profileId);
    return {
      profileId: pane.profileId,
      cwd: pane.cwd,
      startupInput: startupInput.current.get(pane.id),
      restored: restoredOutput.current.get(pane.id),
      elevated: pane.elevated,
      theme: profile?.theme ? THEMES[profile.theme] : undefined,
      fontSize: profile?.fontSize,
    };
  }, []);

  /** Opens a [[layouts]] entry as a new tab named after it; commands run once shells start. */
  const openLayout = useCallback(
    (def: LayoutDef) => {
      if (!profiles || !defaultProfile) return;
      const built = buildLayout(def, profiles, defaultProfile, () => nextId("pane"));
      for (const [paneId, command] of built.commands) startupInput.current.set(paneId, `${command}\r`);
      setWorkspace((ws) => openTabWith(ws, nextId("tab"), built.root, built.panes, def.name));
    },
    [profiles, defaultProfile],
  );

  /** Saves the active tab as a layout named after it (made unique). */
  const saveTabAsLayout = useCallback(() => {
    const ws = workspaceRef.current;
    const tab = activeTab(ws);
    if (!tab) return;
    const taken = new Set(config?.layouts.map((l) => l.name));
    const base = tabTitle(ws, tab);
    let name = base;
    for (let i = 2; taken.has(name); i++) name = `${base} ${i}`;
    void saveLayout(layoutFromTab(ws, tab, name));
  }, [config]);

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
        case "zoomPane":
          setWorkspace(toggleZoom);
          break;
        case "toggleBroadcast":
          setWorkspace(toggleBroadcast);
          break;
        case "swapPane":
          setWorkspace((ws) => swapPane(ws, command.direction));
          break;
        case "commandPalette":
          setPaletteOpen((open) => !open);
          break;
        case "clearHistory":
          registry.clearHistory(paneId);
          void deleteScrollback([paneId]);
          break;
        case "scrollToCommand":
          registry.scrollToCommand(paneId, command.direction);
          break;
        case "copyLastOutput":
          registry.copyLastOutput(paneId);
          break;
        case "saveOutput": {
          const name = `${paneLabel(paneId).replace(/^\d+ · /, "").replace(/[\\/:*?"<>|]+/g, "-").slice(0, 60) || "output"}.txt`;
          void chooseOutputFile(name)
            .then((path) => {
              if (!path) return;
              const html = /\.html?$/i.test(path);
              const contents = html ? registry.html(paneId) : registry.plainText(paneId);
              return saveOutput(path, contents ?? "").then((saved) => setNotice(`Saved to ${saved}.`));
            })
            .catch((e) => setNotice(`Could not save the output: ${e}`));
          break;
        }
        case "openOutput": {
          // Opened at its last line: the latest output is what you came for.
          const text = registry.plainText(paneId) ?? "";
          const lastLine = Math.max(1, text.split("\n").length - 1);
          void saveOutput(null, text)
            .then((file) => openInEditor(file, lastLine))
            .catch((e) => setNotice(`Could not open the output: ${e}`));
          break;
        }
        case "searchAll":
          setSearchAllOpen((open) => !open);
          break;
        case "togglePin":
          togglePin();
          break;
        case "quickSelect": {
          const screen = registry.screen(paneId);
          const found = (screen?.lines ?? []).flatMap((line) =>
            findTargets(line.text).map((target) => ({ target, at: line.cells[target.start] })),
          );
          if (!screen || found.length === 0) {
            setNotice("Nothing on screen to select: no links, files, folders, hashes or IP addresses.");
            break;
          }
          // The shortest labels go to what's nearest the prompt: the bottom of the screen.
          found.sort((a, b) => b.at.row - a.at.row || a.at.col - b.at.col);
          const labels = labelsFor(found.length);
          setQuickTyped("");
          setQuickSelect({
            paneId,
            items: found.map(({ target, at }, i) => ({
              label: labels[i],
              target,
              left: screen.left + at.col * screen.cellWidth,
              top: screen.top + at.row * screen.cellHeight,
            })),
          });
          break;
        }
        case "nextWaiting": {
          const ws = workspaceRef.current;
          const order = ws.tabs.flatMap((tab) => paneIds(tab.root));
          const next = nextWaiting(order, new Set(attentionRef.current.keys()), paneId);
          if (next) setWorkspace((w) => focusPane(w, next));
          else setNotice("Claude isn't waiting for you in any pane.");
          break;
        }
        case "paneBackground": {
          // From the keyboard or the palette: open it over the middle of the pane.
          const box = document.querySelector(`[data-pane-id="${paneId}"]`)?.getBoundingClientRect();
          if (box) setPaneMenu({ paneId, x: box.left + box.width / 2, y: box.top + box.height / 3 });
          break;
        }
      }
    },
    onTitle: (paneId, title) => setWorkspace((ws) => setPaneTitle(ws, paneId, title)),
    // Like Windows Terminal's "graceful" close: a clean exit closes the pane,
    // a failure stays on screen so the error can be read.
    onExit: (paneId, code) => code === 0 && closePaneById(paneId),
    onCwd: (paneId, cwd) => {
      setWorkspace((ws) => setPaneCwd(ws, paneId, cwd));
      setHistory((h) => rememberFolder(h, cwd));
    },
    onClaudeSession: (paneId, id) => {
      const pane = workspaceRef.current.panes[paneId];
      if (pane) void claudeSessionSeen(id, pane.profileId, pane.cwd);
    },
    onSearchResults: (paneId, results) => setSearch((s) => (s?.pane === paneId ? { ...s, results } : s)),
    onActivity: (paneId) => setActivity((current) => new Set(current).add(paneId)),
    onBell: (paneId) => {
      // A bell in the pane you are looking at needs no marker.
      if (shownRef.current && activeTab(workspaceRef.current)?.focusedPane === paneId) return;
      setBells((current) => new Set(current).add(paneId));
    },
    onPaneMenu: (paneId, x, y) => setPaneMenu({ paneId, x, y }),
    onCommandBlock: (paneId, block, x, y) => setBlockMenu({ paneId, block, x, y }),
    onTrigger: (paneId, trigger, line) =>
      raiseAlert(
        { paneId, title: trigger.label, message: line.length > 200 ? `${line.slice(0, 199)}…` : line, kind: "trigger", sessionId: null },
        trigger.action === "notify",
      ),
    onCommandFinished: (paneId, finished) => {
      const cwd = workspaceRef.current.panes[paneId]?.cwd;
      setHistory((h) => rememberCommand(h, { command: finished.command, cwd, exitCode: finished.exitCode, at: Date.now() }));
      const seconds = configRef.current?.longCommandAlert ?? 0;
      if (!seconds || finished.durationMs < seconds * 1000) return;
      const failed = finished.exitCode !== undefined && finished.exitCode !== 0;
      raiseAlert({
        paneId,
        title: failed ? `Command failed (exit ${finished.exitCode})` : "Command finished",
        message: `${finished.command} · ${formatDuration(finished.durationMs)}`,
        kind: failed ? "command_failed" : "command_done",
        sessionId: null,
      });
    },
  };

  // --- background activity, broadcast ----------------------------------------------
  const activeTabPanes = useMemo(() => {
    const tab = activeTab(workspace);
    return new Set(tab ? paneIds(tab.root) : []);
  }, [workspace]);
  useEffect(() => {
    registry.setBackground(new Set(Object.keys(workspace.panes).filter((id) => !activeTabPanes.has(id))));
    // Looking at a tab clears its markers.
    const unseen = (set: ReadonlySet<PaneId>) => new Set([...set].filter((id) => !activeTabPanes.has(id) && workspace.panes[id]));
    setActivity((current) => ([...current].some((id) => activeTabPanes.has(id) || !workspace.panes[id]) ? unseen(current) : current));
    setBells((current) => (shown && [...current].some((id) => activeTabPanes.has(id) || !workspace.panes[id]) ? unseen(current) : current));
  }, [registry, workspace.panes, activeTabPanes, shown]);
  useEffect(() => {
    const groups = new Map<PaneId, PaneId[]>();
    for (const tab of workspace.tabs) {
      if (!tab.broadcast) continue;
      const ids = paneIds(tab.root);
      for (const id of ids) groups.set(id, ids);
    }
    registry.setBroadcast(groups);
  }, [registry, workspace.tabs]);

  // --- Claude attention alerts ------------------------------------------------------
  const shownRef = useRef(shown);
  shownRef.current = shown;
  const alertsOn = useRef(true);
  alertsOn.current = config?.claudeAlerts ?? true;
  const onAlert = useRef<(alert: ClaudeAlert) => void>(null!);
  onAlert.current = (alert) => {
    if (alertsOn.current) raiseAlert(alert);
  };
  /** Marks the pane's tab and, unless you are in the console, shows a Windows notification. */
  function raiseAlert(alert: ClaudeAlert, notify = true) {
    const ws = workspaceRef.current;
    if (!ws.panes[alert.paneId]) return;
    const consoleInFocus = shownRef.current && document.hasFocus();
    // Already looking at that very pane: nothing to tell.
    if (consoleInFocus && activeTab(ws)?.focusedPane === alert.paneId) return;
    setAttention((current) => new Map(current).set(alert.paneId, alert));
    // Console up and focused, but on another tab or pane: the tab marker is enough.
    if (!consoleInFocus && notify) void showClaudeAlert(alert);
  }
  useEffect(() => void setAttentionCount(attention.size), [attention.size]);
  // Looking at the pane again clears its marker.
  useEffect(() => {
    if (shown && focusedPane && attention.has(focusedPane)) setAttention((current) => without(current, focusedPane));
  }, [shown, focusedPane, attention]);
  // --- search across all panes -------------------------------------------------------
  const searchAllPanes = useCallback((query: string, options: SearchOptions) => registry.searchAll(query, options), [registry]);
  /** "2 · PowerShell": the tab's position and title. */
  const paneLabel = useCallback((paneId: PaneId) => {
    const ws = workspaceRef.current;
    const index = ws.tabs.findIndex((tab) => paneIds(tab.root).includes(paneId));
    return index < 0 ? "?" : `${index + 1} · ${tabTitle(ws, ws.tabs[index])}`;
  }, []);
  const revealHit = useCallback(
    (hit: SearchHit, query: string, options: SearchOptions) => {
      setWorkspace((ws) => focusPane(ws, hit.paneId));
      void registry.revealMatch(hit.paneId, hit.index, query, options);
    },
    [registry],
  );

  // --- Claude Code's status line: exact figures and plan usage ------------------------
  const onStatusline = useRef<(line: StatuslineUsage) => void>(null!);
  onStatusline.current = (line) => {
    statuslines.current.set(line.paneId, line);
    setClaudeUsages((current) => {
      const merged = mergeUsage(current.get(line.paneId), line);
      return merged ? new Map(current).set(line.paneId, merged) : current;
    });
    if (!line.fiveHour && !line.sevenDay) return;
    const before = planRef.current;
    setPlan({ fiveHour: line.fiveHour ?? before?.fiveHour, sevenDay: line.sevenDay ?? before?.sevenDay });
    for (const [key, name, limit, previous] of [
      ["fiveHour", "5-hour", line.fiveHour, before?.fiveHour],
      ["sevenDay", "7-day", line.sevenDay, before?.sevenDay],
    ] as const) {
      if (!limit) continue;
      // A new window starts over: compare within the same reset time only.
      const prior = previous && previous.resetsAt === limit.resetsAt ? previous.usedPercent : undefined;
      const level = crossedWarning(prior, limit.usedPercent);
      const id = `${key}:${limit.resetsAt}:${level}`;
      if (level === undefined || planWarned.current.has(id)) continue;
      planWarned.current.add(id);
      const reset = limit.resetsAt ? `; it resets ${formatReset(limit.resetsAt, new Date())}` : "";
      const message = `${Math.round(limit.usedPercent)}% of your Claude plan's ${name} limit is used${reset}.`;
      setNotice(message);
      void showPlanWarning(`Claude plan: ${name} limit at ${level}%`, message).catch(() => {});
    }
  };

  // --- quick select: keys pick a label while the labels show ------------------------
  /** Copies the target, or with Shift opens it: a link in the browser, a file in the editor, a folder in a new tab. */
  const pickTarget = useCallback(
    (paneId: PaneId, target: Target, open: boolean) => {
      const copy = () => void writeText(target.text).then(() => setNotice(`Copied ${target.text}`));
      if (!open || target.kind === "hash" || target.kind === "ip") return copy();
      if (target.kind === "url") return void openUrl(target.text).catch((e) => setNotice(`Could not open it: ${e}`));
      if (target.kind === "folder") return void newTab(undefined, target.text);
      void resolveFiles([target.text], workspaceRef.current.panes[paneId]?.cwd)
        .then(([file]) => (file ? openInEditor(file, target.line, target.col) : setNotice(`No such file: ${target.text}`)))
        .catch((e) => setNotice(`Could not open it: ${e}`));
    },
    [newTab],
  );
  useEffect(() => {
    if (!quickSelect) return;
    const close = () => setQuickSelect(undefined);
    const onKey = (e: KeyboardEvent) => {
      if (["Shift", "Control", "Alt", "Meta"].includes(e.key)) return;
      // Nothing reaches the terminal while the labels show.
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") return close();
      if (e.key === "Backspace") return setQuickTyped((t) => t.slice(0, -1));
      const letter = e.code.startsWith("Key") ? e.code.slice(3).toLowerCase() : "";
      if (!letter) return;
      const typed = quickTyped + letter;
      const candidates = quickSelect.items.filter((item) => item.label.startsWith(typed));
      if (candidates.length === 0) return;
      const exact = candidates.find((item) => item.label === typed);
      if (exact) {
        close();
        pickTarget(quickSelect.paneId, exact.target, e.shiftKey);
      } else setQuickTyped(typed);
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("mousedown", close, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("mousedown", close, true);
    };
  }, [quickSelect, quickTyped, pickTarget]);

  // --- named workspaces: every tab under a name, opened again next to the open ones ---
  useEffect(() => void loadWorkspaces().then((text) => setNamedWorkspaces(parseNamed(text)), () => {}), []);
  const changeNamedWorkspaces = useCallback((change: (list: NamedWorkspace[]) => NamedWorkspace[]) => {
    setNamedWorkspaces((list) => {
      const next = change(list);
      void saveWorkspaces(serializeNamed(next)).catch((e) => setNotice(`Could not save workspaces: ${e}`));
      return next;
    });
  }, []);
  const saveNamedWorkspace = useCallback(
    (name: string) => changeNamedWorkspaces((list) => upsertNamed(list, name, saveWorkspace(workspaceRef.current), Date.now())),
    [changeNamedWorkspaces],
  );
  const openNamedWorkspace = useCallback(
    (named: NamedWorkspace) => {
      const add = profiles ? restoreWorkspace(named.session, profiles) : undefined;
      if (!add) return setNotice(`The workspace “${named.name}” couldn't be read.`);
      setWorkspace((ws) => appendWorkspace(ws, add, (kind) => nextId(kind)));
    },
    [profiles],
  );

  // --- command palette: everything you can do, by name ------------------------------
  const paletteItems = useMemo((): PaletteItem[] => {
    const chordFor = (name: string) => {
      const chord = config?.keybindings[name] ?? ACTION_LIST.find((a) => a.name === name)?.defaultChord;
      return chord || undefined;
    };
    const target = () => activeTab(workspaceRef.current)?.focusedPane;
    return [
      ...ACTION_LIST.filter((a) => a.name !== "command_palette").map((action) => ({
        id: `action:${action.name}`,
        group: "Action",
        label: action.label,
        hint: chordFor(action.name),
        run: () => {
          const pane = target();
          if (pane) handlers.current.onCommand(pane, action.command);
        },
      })),
      ...workspace.tabs.map((tab, i) => ({
        id: `tab:${tab.id}`,
        group: "Tab",
        label: tabTitle(workspace, tab),
        hint: i < 9 ? `Ctrl+Alt+${i + 1}` : undefined,
        run: () => setWorkspace((ws) => activateTab(ws, tab.id)),
      })),
      ...(profiles ?? []).map((profile) => ({
        id: `profile:${profile.id}`,
        group: "New tab",
        label: profile.name,
        run: () => void newTab(profile.id),
      })),
      ...(profiles ?? []).map((profile) => ({
        id: `admin:${profile.id}`,
        group: "New admin tab",
        label: profile.name,
        run: () => void openAdminTab(profile.id),
      })),
      ...Object.entries(THEMES).map(([name, theme]) => ({
        id: `theme:${name}`,
        group: "Theme",
        label: theme.label,
        hint: name === config?.theme ? "current" : undefined,
        run: () => void saveConfig({ theme: name }),
      })),
      ...(config?.layouts ?? []).map((layout) => ({
        id: `layout:${layout.name}`,
        group: "Layout",
        label: layout.name,
        run: () => openLayout(layout),
      })),
      { id: "layout:save", group: "Layout", label: "Save this tab as a layout", run: saveTabAsLayout },
      ...[...TAB_COLORS, null].map((color) => ({
        id: `tab-color:${color ?? "none"}`,
        group: "Tab colour",
        label: color ?? "none",
        run: () => setWorkspace((ws) => (ws.activeTab ? setTabStyle(ws, ws.activeTab, { color }) : ws)),
      })),
      ...(config?.snippets ?? []).map((snippet, i) => ({
        id: `snippet:${i}`,
        group: "Snippet",
        label: snippet.name,
        hint: snippet.command.length > 40 ? `${snippet.command.slice(0, 39)}…` : snippet.command,
        run: () => {
          const pane = target();
          if (pane) registry.typeSnippet(pane, snippet.command, snippet.run);
        },
      })),
      ...(config?.claudeSessions ? claudeSessions : []).flatMap((session) => {
        const label = `${session.title ?? session.id.slice(0, 8)}${session.cwd ? ` (${session.cwd})` : ""}`;
        return [
          { id: `claude:${session.id}`, group: "Resume Claude", label, run: () => resumeClaude(session) },
          { id: `claude-here:${session.id}`, group: "Resume Claude here", label, run: () => resumeClaudeHere(session) },
        ];
      }),
      ...[...attention].map(([paneId, alert]) => ({
        id: `waiting:${paneId}`,
        group: "Claude waits",
        label: paneLabel(paneId),
        hint: alert.message.length > 40 ? `${alert.message.slice(0, 39)}…` : alert.message,
        run: () => setWorkspace((ws) => focusPane(ws, paneId)),
      })),
      ...history.commands.slice(0, 50).map((recent, i) => ({
        id: `recent-command:${i}`,
        group: "Recent command",
        label: recent.command,
        hint: [recent.exitCode !== undefined && recent.exitCode !== 0 ? `✗ ${recent.exitCode}` : "", recent.cwd ?? ""].filter(Boolean).join(" · ") || undefined,
        // Typed at the prompt, not run: Enter is yours to press.
        run: () => {
          const pane = target();
          if (pane) registry.typeSnippet(pane, recent.command, false);
        },
      })),
      ...history.folders.map((folder, i) => ({
        id: `recent-folder:${i}`,
        group: "Recent folder",
        label: folder,
        run: () => void newTab(undefined, folder),
      })),
      ...(history.commands.length || history.folders.length
        ? [{ id: "recent:forget", group: "Recent", label: "Forget recent commands and folders", run: () => setHistory(emptyHistory()) }]
        : []),
      ...namedWorkspaces.map((named) => ({
        id: `workspace:${named.name}`,
        group: "Workspace",
        label: named.name,
        hint: `${tabCount(named.session)} tabs`,
        run: () => openNamedWorkspace(named),
      })),
      { id: "workspace:save", group: "Workspace", label: "Save all tabs as a workspace…", run: () => setSavingWorkspace(true) },
      ...namedWorkspaces.map((named) => ({
        id: `workspace-delete:${named.name}`,
        group: "Delete workspace",
        label: named.name,
        run: () => changeNamedWorkspaces((list) => removeNamed(list, named.name)),
      })),
      { id: "settings:file", group: "Settings", label: "Open settings file", run: () => void openConfigFile() },
    ];
  }, [config, workspace, profiles, claudeSessions, newTab, resumeClaude, openLayout, saveTabAsLayout, openAdminTab, resumeClaudeHere, attention, paneLabel, history, namedWorkspaces, openNamedWorkspace, changeNamedWorkspaces]);

  claudeStatusRef.current = claudeStatus;
  // Claude status per pane: a claude.exe below the pane's shell; busy when it printed
  // in the last moments (its spinner animates while it works).
  const claudeFeatures = Boolean(config?.claudeSessions || config?.claudeAlerts);
  useEffect(() => {
    if (!claudeFeatures) {
      setClaudeStatus(new Map());
      return;
    }
    const poll = async () => {
      const running = new Set(await claudeRunning().catch(() => []));
      const now = Date.now();
      const next = new Map<PaneId, "busy" | "idle">();
      for (const paneId of Object.keys(workspaceRef.current.panes)) {
        const session = registry.sessionOf(paneId);
        if (session === undefined || !running.has(session)) continue;
        next.set(paneId, now - registry.lastOutput(paneId) < CLAUDE_BUSY_MS ? "busy" : "idle");
      }
      setClaudeStatus((current) => (sameStatus(current, next) ? current : next));
    };
    void poll();
    const timer = window.setInterval(() => void poll(), CLAUDE_POLL_MS);
    return () => window.clearInterval(timer);
  }, [claudeFeatures, registry]);

  // Token use of the Claude sessions running in panes, re-read every few seconds.
  useEffect(() => {
    if (claudeStatus.size === 0) {
      setClaudeUsages((current) => (current.size ? new Map() : current));
      return;
    }
    const poll = async () => {
      const next = new Map<PaneId, ClaudeUsage>();
      for (const paneId of claudeStatus.keys()) {
        const known = paneSessions.current.get(paneId)?.transcriptPath ?? undefined;
        const cwd = known ? undefined : workspaceRef.current.panes[paneId]?.cwd;
        const usage = mergeUsage((await claudeUsage(known, cwd).catch(() => null)) ?? undefined, statuslines.current.get(paneId));
        if (usage) next.set(paneId, usage);
      }
      setClaudeUsages(next);
      // Tabs are named after their Claude session, and stay so after it ends.
      const titles = new Map([...next].flatMap(([paneId, usage]) => (usage.title ? [[paneId, usage.title] as const] : [])));
      if (titles.size) setWorkspace((ws) => withClaudeTitles(ws, titles));
    };
    void poll();
    const timer = window.setInterval(() => void poll(), CLAUDE_USAGE_POLL_MS);
    return () => window.clearInterval(timer);
  }, [claudeStatus]);

  const tabMarkers = useMemo(
    () =>
      new Map(
        workspace.tabs.map((tab) => {
          const ids = paneIds(tab.root);
          const statuses = ids.map((id) => claudeStatus.get(id));
          // The focused pane's session if it runs one, else the tab's first.
          const usage = claudeUsages.get(tab.focusedPane) ?? ids.map((id) => claudeUsages.get(id)).find(Boolean);
          return [
            tab.id,
            {
              activity: ids.some((id) => activity.has(id)),
              bell: ids.some((id) => bells.has(id)),
              zoomed: Boolean(tab.zoomed),
              broadcast: Boolean(tab.broadcast),
              claude: statuses.includes("busy") ? ("busy" as const) : statuses.includes("idle") ? ("idle" as const) : undefined,
              claudeUsage: usage,
            },
          ] as const;
        }),
      ),
    [workspace.tabs, workspace.panes, activity, bells, claudeStatus, claudeUsages],
  );
  /** Pane → Claude session running in it, saved with the tabs (see claude_restore). */
  const claudeByPane = useMemo(
    () => new Map([...claudeUsages].filter(([paneId]) => claudeStatus.has(paneId)).map(([paneId, usage]) => [paneId, usage.sessionId])),
    [claudeUsages, claudeStatus],
  );
  /** Panes where Claude waits for you, in tab order, for the ✳ menu and the palette. */
  const waitingClaude = useMemo(
    () =>
      workspace.tabs
        .flatMap((tab) => paneIds(tab.root))
        .flatMap((paneId) => {
          const alert = attention.get(paneId);
          return alert ? [{ paneId, label: paneLabel(paneId), message: alert.message }] : [];
        }),
    [workspace.tabs, attention, paneLabel],
  );
  /** Claude sessions running now, for the ✳ menu. */
  const runningClaude = useMemo(
    () =>
      [...claudeUsages].map(([paneId, usage]) => ({ paneId, label: paneLabel(paneId), usage })),
    [claudeUsages, paneLabel, workspace.tabs],
  );
  const attentionTabs = useMemo(
    () =>
      new Map(
        workspace.tabs.flatMap((tab) => {
          const alert = paneIds(tab.root).map((id) => attention.get(id)).find(Boolean);
          return alert ? [[tab.id, alert] as const] : [];
        }),
      ),
    [workspace.tabs, attention],
  );

  // --- startup, events ---------------------------------------------------------
  useEffect(() => {
    void listProfiles().then(setProfiles);
    void getConfig().then(setSettings);
    void listClaudeSessions().then(setClaudeSessions);
    const listeners = [
      // Custom profiles live in the settings too.
      onConfigChanged((snapshot) => {
        setSettings(snapshot);
        void listProfiles().then(setProfiles);
      }),
      onClaudeSessionsChanged(setClaudeSessions),
      onOpenSettings(() => setSettingsOpen(true)),
      onCheckUpdates(() => {
        setSettingsOpen(true);
        setCheckRequest((n) => n + 1);
      }),
      onUpdateAvailable((found) => {
        setUpdate(found);
        setUpdateBanner(true);
      }),
      onClaudeAttention((alert) => onAlert.current(alert)),
      onClaudeSessionStart((session) => paneSessions.current.set(session.paneId, session)),
      onClaudeStatusline((line) => onStatusline.current(line)),
      onFocusPane((paneId) => setWorkspace((ws) => focusPane(ws, paneId))),
      onOpenHere((dir) => newTabRef.current(undefined, dir)),
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

  // Files dragged from Explorer: the pane under the cursor is outlined, and a drop
  // types the paths at its prompt, quoted for its shell.
  useEffect(() => {
    let target: HTMLElement | undefined;
    const mark = (pane: HTMLElement | undefined) => {
      if (pane === target) return;
      delete target?.dataset.dropTarget;
      target = pane;
      if (pane) pane.dataset.dropTarget = "";
    };
    // Overlays (settings, palette) hide the panes from elementFromPoint, so they take no drops.
    const paneAt = (x: number, y: number) => document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-pane-id]") ?? undefined;
    const unlisten = onFileDrag((drag) => {
      if (drag.type === "leave") return mark(undefined);
      const pane = paneAt(drag.x, drag.y);
      mark(drag.type === "over" ? pane : undefined);
      const paneId = pane?.dataset.paneId;
      if (drag.type !== "drop" || !paneId) return;
      const profileId = workspaceRef.current.panes[paneId]?.profileId;
      const kind = profilesRef.current?.find((p) => p.id === profileId)?.kind ?? "other";
      setWorkspace((ws) => focusPane(ws, paneId));
      registry.focus(paneId);
      registry.pasteText(paneId, dropText(drag.paths, kind));
      // Explorer had the focus; take it so typing goes on at the prompt.
      void getCurrentWindow().setFocus();
    });
    return () => {
      mark(undefined);
      void unlisten.then((u) => u());
    };
  }, [registry]);

  // The console always has a shell. At start: the saved layout (if enabled) or one
  // fresh tab. After the last tab closes: a fresh tab, and the console gets out of the way.
  // While the start is still loading, an empty console just means "not yet": this
  // effect runs again then (React runs it twice on mount in development, and any
  // dependency may change meanwhile), and must not open a second tab or hide it.
  const startup = useRef<"idle" | "loading" | "done">("idle");
  useEffect(() => {
    if (workspace.tabs.length > 0 || !profiles || !config || startup.current === "loading") return;
    if (startup.current === "done") {
      newTab();
      void hideWindow();
      return;
    }
    startup.current = "loading";
    void (config.restoreSession ? loadSession() : Promise.resolve(null)).then(async (saved) => {
      // Started from Explorer's "Open in qterm": a tab in that folder too.
      const openHere = await takeOpenHere().catch(() => null);
      const restored = saved ? restoreWorkspace(saved, profiles) : undefined;
      if (!restored) {
        newTab(undefined, openHere ?? undefined);
        startup.current = "done";
        return;
      }
      // Earlier output first, so it is there before the panes' shells start.
      await Promise.all(
        Object.values(restored.panes)
          .filter((pane) => keepsOutput(config, pane.profileId))
          .map(async (pane) => {
            const text = await loadScrollback(pane.id).catch(() => null);
            // A file saved before empty panes were skipped may hold just a prompt.
            if (text && hasContent(plainLines(text))) restoredOutput.current.set(pane.id, text);
          }),
      );
      // Claude Code sessions that ran in panes come back too, if asked for.
      if (config.claudeRestore) {
        for (const pane of Object.values(restored.panes)) {
          if (pane.claudeSession) startupInput.current.set(pane.id, `claude --resume ${pane.claudeSession}\r`);
        }
      }
      setWorkspace(restored);
      if (openHere) newTab(undefined, openHere);
      startup.current = "done";
    });
  }, [workspace.tabs.length, profiles, config, newTab]);

  // --- scrollback: each pane's output, kept across restarts (per shell) -------------
  /** Settings → "Clear all saved output": the files, and the open panes' history (else the next save brings it back). */
  const clearAllHistory = useCallback(async () => {
    for (const paneId of Object.keys(workspaceRef.current.panes)) registry.clearHistory(paneId);
    await deleteScrollback();
  }, [registry]);
  const configRef = useRef(config);
  configRef.current = config;
  const lastScrollbackSave = useRef(new Map<PaneId, number>());
  const saveScrollbacks = useCallback(async () => {
    const cfg = configRef.current;
    if (!cfg || startup.current !== "done") return;
    const keep: PaneId[] = [];
    const saves: Promise<void>[] = [];
    for (const pane of Object.values(workspaceRef.current.panes)) {
      if (!cfg.restoreSession || !keepsOutput(cfg, pane.profileId)) continue;
      const worth = registry.worthSaving(pane.id);
      // Nothing but prompts: no file, and an older one is pruned below.
      if (worth === false) continue;
      keep.push(pane.id);
      // Not started yet (a restored tab not shown so far): its file stays as it is.
      if (worth === undefined) continue;
      const changed = registry.lastOutput(pane.id) > (lastScrollbackSave.current.get(pane.id) ?? 0);
      const text = changed ? registry.serialize(pane.id, cfg.scrollback.lines) : undefined;
      if (text === undefined) continue;
      lastScrollbackSave.current.set(pane.id, Date.now());
      saves.push(saveScrollback(pane.id, text).catch(() => {}));
    }
    await Promise.all(saves);
    await pruneScrollback(keep).catch(() => {});
  }, [registry]);
  useEffect(() => {
    const timer = window.setInterval(() => void saveScrollbacks(), SCROLLBACK_SAVE_MS);
    return () => window.clearInterval(timer);
  }, [saveScrollbacks]);
  // Hiding the console is a natural moment to save; quitting is the last one.
  useEffect(() => {
    if (!shown) void saveScrollbacks();
  }, [shown, saveScrollbacks]);
  // Save the layout shortly after it changes (shell titles alone don't count).
  const lastSaved = useRef<string>(undefined);
  const claudeByPaneRef = useRef(claudeByPane);
  claudeByPaneRef.current = claudeByPane;
  /** Writes the tabs now if they changed since the last save. */
  const flushSession = useCallback(async () => {
    const ws = workspaceRef.current;
    if (startup.current !== "done" || ws.tabs.length === 0) return;
    const text = saveWorkspace(ws, claudeByPaneRef.current);
    if (text === lastSaved.current) return;
    lastSaved.current = text;
    await saveSession(text).catch(() => {});
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => void flushSession(), SAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [workspace, claudeByPane, flushSession]);


  // Recent commands and folders: loaded once, saved shortly after they change.
  useEffect(() => {
    void loadHistory()
      .then((text) => setHistory((current) => mergeLoaded(parseHistory(text), current)))
      .catch(() => {})
      .finally(() => (historyLoaded.current = true));
  }, []);
  const historyRef = useRef(history);
  historyRef.current = history;
  const flushHistory = useCallback(async () => {
    if (historyLoaded.current) await saveHistory(JSON.stringify(historyRef.current)).catch(() => {});
  }, []);
  useEffect(() => {
    if (!historyLoaded.current) return;
    const timer = window.setTimeout(() => void flushHistory(), SAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [history, flushHistory]);

  /** Saves tabs and output like quitting does, then installs; qterm exits and restarts. */
  const updateNow = useCallback(async () => {
    await Promise.all([flushSession(), saveScrollbacks(), flushHistory()]);
    await installUpdate();
  }, [flushSession, saveScrollbacks, flushHistory]);
  const [updateError, setUpdateError] = useState<string>();

  // Quitting right after a change (a cd, a new tab) must not lose it to the save delay.
  useEffect(() => {
    const unlisten = onQuitRequested(() => void Promise.all([flushSession(), saveScrollbacks(), flushHistory()]).finally(() => void quitNow()));
    return () => void unlisten.then((fn) => fn());
  }, [saveScrollbacks, flushSession, flushHistory]);

  // Re-parenting a terminal (zoom, split, swap) drops its keyboard focus, so focus
  // again whenever the active tab's layout changes, not only the focused pane.
  const activeLayout = useMemo(() => {
    const tab = activeTab(workspace);
    return tab ? `${tab.id}|${tab.zoomed ?? ""}|${JSON.stringify(tab.root)}` : "";
  }, [workspace]);
  useEffect(() => {
    if (shown && focusedPane && !search && !settingsOpen && !paletteOpen) registry.focus(focusedPane);
  }, [registry, shown, focusedPane, activeLayout, search, settingsOpen, paletteOpen]);

  // Safety net: app shortcuts also work while focus is outside any terminal or field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest(".xterm") || target?.closest("input, textarea, select, [role=dialog]")) return;
      const command = resolveKey(keyInput(e), keymap);
      const pane = activeTab(workspaceRef.current)?.focusedPane;
      if (!command || !pane) return;
      e.preventDefault();
      handlers.current.onCommand(pane, command);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [keymap]);

  // The console paints its background around the terminal area, not under it: each
  // pane paints its own there (its shell's colour, or the theme's), and two
  // translucent layers would stack. The terminal area is cut out of the console's
  // background (App.css .console::before), so it is measured as the layout changes.
  const consoleRef = useRef<HTMLDivElement>(null);
  const panelsRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const consoleEl = consoleRef.current;
    const panels = panelsRef.current;
    if (!consoleEl || !panels) return;
    const measure = () => {
      const outer = consoleEl.getBoundingClientRect();
      const inner = panels.getBoundingClientRect();
      consoleEl.style.setProperty("--hole-x", `${inner.left - outer.left}px`);
      consoleEl.style.setProperty("--hole-y", `${inner.top - outer.top}px`);
      consoleEl.style.setProperty("--hole-w", `${inner.width}px`);
      consoleEl.style.setProperty("--hole-h", `${inner.height}px`);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(consoleEl);
    observer.observe(panels);
    return () => observer.disconnect();
  }, []);
  /** A pane's own background: chosen for it, else its profile's `background`, else its profile theme's. */
  const paneBackground = useCallback(
    (pane: Pane) => {
      const profile = profiles?.find((p) => p.id === pane.profileId);
      const color = pane.background ?? profile?.background ?? (profile?.theme ? THEMES[profile.theme]?.background : undefined);
      return color ? withAlpha(color, config?.opacity ?? DEFAULT_OPACITY) : undefined;
    },
    [profiles, config?.opacity],
  );

  const closeSearch = () => {
    if (search) registry.clearSearch(search.pane);
    setSearch(undefined);
  };

  return (
    <div
      ref={consoleRef}
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
      <div className="tab-panels" ref={panelsRef}>
        {workspace.tabs.map((tab) => (
          <div key={tab.id} className="tab-panel" role="tabpanel" hidden={tab.id !== workspace.activeTab}>
            <LayoutView
              node={tab.zoomed ? { kind: "leaf", pane: tab.zoomed } : tab.root}
              path={[]}
              panes={workspace.panes}
              focusedPane={tab.focusedPane}
              showFocus={tab.root.kind === "split" && !tab.zoomed}
              broadcast={tab.broadcast}
              registry={registry}
              spec={paneSpec}
              background={paneBackground}
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
        {paletteOpen && <CommandPalette items={paletteItems} onClose={() => setPaletteOpen(false)} />}
        {whatsNew && <WhatsNew version={whatsNew.version} from={whatsNew.from} onClose={() => setWhatsNew(undefined)} />}
        {quickSelect && <QuickSelectOverlay items={quickSelect.items} typed={quickTyped} />}
        {savingWorkspace && (
          <SaveWorkspaceDialog
            existing={namedWorkspaces.map((w) => w.name)}
            onSave={saveNamedWorkspace}
            onClose={() => setSavingWorkspace(false)}
          />
        )}
      {blockMenu && workspace.panes[blockMenu.paneId] && (
        <CommandBlockMenu
          block={blockMenu.block}
          x={blockMenu.x}
          y={blockMenu.y}
          onCopyOutput={() => {
            const text = registry.blockOutput(blockMenu.paneId, blockMenu.block.id);
            if (text) void writeText(text).then(() => setNotice("Output copied."));
            else setNotice("That output is no longer in the scrollback.");
          }}
          onCopyCommand={() => void writeText(blockMenu.block.command)}
          onSelectOutput={() => {
            if (!registry.selectBlock(blockMenu.paneId, blockMenu.block.id)) setNotice("That output is no longer in the scrollback.");
            registry.focus(blockMenu.paneId);
          }}
          onRunAgain={() => {
            registry.focus(blockMenu.paneId);
            registry.typeSnippet(blockMenu.paneId, blockMenu.block.command, true);
          }}
          onClose={() => setBlockMenu(undefined)}
        />
      )}
      {paneMenu && workspace.panes[paneMenu.paneId] && (
        <PaneBackgroundMenu
          key={paneMenu.paneId}
          x={paneMenu.x}
          y={paneMenu.y}
          color={workspace.panes[paneMenu.paneId].background}
          onChange={(color) => setWorkspace((ws) => setPaneBackground(ws, paneMenu.paneId, color))}
          onClose={() => setPaneMenu(undefined)}
        />
      )}
      {searchAllOpen && (
        <SearchAllPanel search={searchAllPanes} paneLabel={paneLabel} onPick={revealHit} onClose={() => setSearchAllOpen(false)} />
      )}
        {settingsOpen && settings && profiles && (
          <SettingsPanel
            snapshot={settings}
            profiles={profiles}
            onClose={() => {
              setSettingsOpen(false);
              setCheckRequest(0);
            }}
            onClearHistory={clearAllHistory}
            update={update}
            onUpdateFound={setUpdate}
            onInstallUpdate={updateNow}
            checkRequest={checkRequest}
            onWhatsNew={(version) => {
              setSettingsOpen(false);
              setWhatsNew({ version });
            }}
          />
        )}
      </div>
      {update && updateBanner && !settingsOpen && (
        <div className="app-notice" role="status">
          {updateError ?? `qterm ${update.version} is available.`}
          <button
            onClick={() => {
              setUpdateError(undefined);
              updateNow().catch((e) => setUpdateError(String(e)));
            }}
          >
            Update and restart
          </button>
          <button className="icon-button" aria-label="Dismiss" title="Later (Settings → Updates)" onClick={() => setUpdateBanner(false)}>
            ×
          </button>
        </div>
      )}
      {notice && (
        <div className="app-notice" role="status">
          {notice}
          <button className="icon-button" aria-label="Dismiss" onClick={() => setNotice(undefined)}>
            ×
          </button>
        </div>
      )}
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
            ? {
                sessions: claudeSessions,
                onResume: resumeClaude,
                onResumeHere: resumeClaudeHere,
                onForget: (ids) => void forgetClaudeSessions(ids),
                onNewSession: newClaudeSession,
                running: runningClaude,
                waiting: waitingClaude,
                plan: planText,
                onFocusPane: (paneId: PaneId) => setWorkspace((ws) => focusPane(ws, paneId)),
              }
            : undefined
        }
        onActivate={(tabId) => setWorkspace((ws) => activateTab(ws, tabId))}
        onClose={closeTab}
        onNewTab={(profileId) => newTab(profileId)}
        onSplit={(dir) => focusedPane && split(focusedPane, dir)}
        onRename={(tabId, title) => setWorkspace((ws) => renameTab(ws, tabId, title))}
        onStyle={(tabId, style) => setWorkspace((ws) => setTabStyle(ws, tabId, style))}
        onMove={(tabId, toIndex) => setWorkspace((ws) => moveTab(ws, tabId, toIndex))}
        onOpenSettings={() => setSettingsOpen((open) => !open)}
        pinned={pinned}
        onTogglePin={togglePin}
        attention={attentionTabs}
        markers={tabMarkers}
        layouts={config?.layouts ?? []}
        onOpenLayout={openLayout}
        onSaveLayout={saveTabAsLayout}
        onDeleteLayout={(name) => void deleteLayout(name)}
      />
      <HeightHandle />
    </div>
  );
}

/** How many tabs a saved workspace holds (for the palette). */
function tabCount(session: string): number {
  try {
    const tabs = (JSON.parse(session) as { tabs?: unknown[] }).tabs;
    return Array.isArray(tabs) ? tabs.length : 0;
  } catch {
    return 0;
  }
}

/** What was saved, with anything remembered while it loaded on top. */
function mergeLoaded(saved: History, current: History): History {
  let merged = saved;
  for (const command of [...current.commands].reverse()) merged = rememberCommand(merged, command);
  for (const folder of [...current.folders].reverse()) merged = rememberFolder(merged, folder);
  return merged;
}

function without<K, V>(map: ReadonlyMap<K, V>, key: K): ReadonlyMap<K, V> {
  if (!map.has(key)) return map;
  const next = new Map(map);
  next.delete(key);
  return next;
}

/** Layout panes that name a profile that doesn't exist. */
function layoutProblems(layouts: LayoutDef[], profiles: Profile[]): string[] {
  const problems: string[] = [];
  const visit = (layout: string, pane: LayoutPane) => {
    if (pane.profile && !findProfile(profiles, pane.profile)) {
      problems.push(`layout "${layout}": profile "${pane.profile}" not found (the default shell is used)`);
    }
    pane.panes?.forEach((child) => visit(layout, child));
  };
  layouts.forEach((layout) => visit(layout.name, layout));
  return problems;
}

function sameStatus(a: ReadonlyMap<PaneId, string>, b: ReadonlyMap<PaneId, string>): boolean {
  return a.size === b.size && [...a].every(([k, v]) => b.get(k) === v);
}

/** Whether panes of this shell keep their output across restarts. */
function keepsOutput(config: { scrollback: { restore: boolean; profiles: Record<string, boolean> } }, profileId: string): boolean {
  return config.scrollback.profiles[profileId] ?? config.scrollback.restore;
}
