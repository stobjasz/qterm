import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

import {
  claudeSessionSeen,
  createAgentBrief,
  prepareVerification,
  authorizeVerification,
  type VerificationLaunch,
  cancelVerification,
  prepareWorktreeOpen,
  validateWorktreeStartup,
  publishAgentPanes,
  agentAccessSnapshot,
  claimAgentTask,
  launchAgentTask,
  failAgentTask,
  stopAgentTask,
  onAgentTaskQueued,
  type AgentInvocation,
  startRecipe,
  cancelRecipeRun,
  recipeRunsSnapshot,
  resolveLibrarySession,
  resolveProviderSession,
  createWslAgentBrief,
  validateWslFolder,
  type LibraryEntry,
  type RecipeReview,
  type WorktreeTask,
  type AgentProvider,
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
  runningPrograms,
  onClaudeStatusline,
  onClaudeReply,
  type ClaudeReply,
  stopPrograms,
  projectInfo,
  type ProjectInfo,
  clipboardImageFile,
  toggleConsoleSize,
  listeningPorts,
  endPortOwner,
  type PortOwner,
  showPlanWarning,
  setPlanSummary,
  type StatuslineUsage,
  takeVersionChange,
  firstStart,
  loadWorkspaces,
  saveWorkspaces,
  openInEditor,
  resolveFiles,
  wslTranslatePaths,
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
import {prepareFilePaste,deliverFilePaste,type FileDestination} from "./terminal/filePaste";
import {profileSupportsEnvironment,sourceEnabled,nativeAgentContext,sightingContext,sourceContext,sessionEnvironment} from "./agents/environments";
import {environmentLabel} from "./agents/library";
import { isMultiLine } from "./terminal/paste";
import { ConfirmPaste } from "./terminal/ConfirmPaste";
import { findJson, type Json } from "./terminal/json";
import { JsonViewer } from "./terminal/JsonViewer";
import { useCodex } from "./codex/useCodex";
import { hookObservation, resolveObservation, tabAgentStatus, type AgentObservation, type AgentStatus } from "./agents/status";
import { HandoffDialog } from "./agents/HandoffDialog";
import { AgentInbox } from "./agents/AgentInbox";
import { AgentAccessPanel } from "./agents/AgentAccessPanel";
import { useAgentAccess } from "./agents/useAgentAccess";
import { useSessionLibrary } from "./agents/useSessionLibrary";
import { SessionLibrary } from "./agents/SessionLibrary";
import { SessionHandoffDialog } from "./agents/SessionHandoffDialog";
import { limitText } from "./text";
import { useAgentInbox } from "./agents/useAgentInbox";
import { AlertNotifications } from "./agents/notifications";
import { ProblemsPanel } from "./problems/ProblemsPanel";
import { commandRun, latestRuns, type CommandRun } from "./problems/runs";
import { useCommandRuns } from "./problems/useCommandRuns";
import { VerifyDialog } from "./problems/VerifyDialog";
import { WorktreePanel } from "./project/WorktreePanel";
import { useWorktreeTasks } from "./project/useWorktreeTasks";
import { RecipePanel } from "./project/RecipePanel";
import { useRecipeRuns } from "./project/useRecipeRuns";
import type { LayoutNode } from "./workspace/layout";
import type { Diagnostic } from "./problems/diagnostics";
import { briefText, handoffCommand, resumeCommand, sameCommandFolder, type HandoffContext } from "./agents/handoff";
import type { CacheState } from "./claude/cache";
import { gitSummary, projectLook } from "./project/project";
import { nextWaiting } from "./claude/waiting";
import { crossedWarning, formatReset, mergeUsage, planSummary, type PlanUsage } from "./claude/plan";
import { parseNamed, removeNamed, serializeNamed, upsertNamed, type NamedWorkspace } from "./workspace/named";
import { SaveWorkspaceDialog } from "./workspace/SaveWorkspaceDialog";
import { Persistence, persistOutput, type OutputSnapshot } from "./workspace/persistence";
import { findTargets, labelsFor, type Target } from "./terminal/quickSelect";
import { compileTriggers } from "./terminal/triggers";
import { QuickSelectOverlay, type QuickSelectItem } from "./terminal/QuickSelectOverlay";
import { WhatsNew } from "./updates/WhatsNew";
import { HelpSheet, hotkeyLabel } from "./help/HelpSheet";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { openUrl } from "@tauri-apps/plugin-opener";
import { emptyHistory, parseHistory, rememberCommand, rememberFolder, type History } from "./terminal/history";
import { formatClock, formatDuration } from "./terminal/marks";
import { PortDialog } from "./terminal/PortDialog";
import { ShellPicker } from "./terminal/ShellPicker";
import type { PaneBadge } from "./terminal/PaneView";
import { startFolder, transferFolder } from "./workspace/shellCwd";
import { TAB_COLOR_VALUES } from "./tabs/TabStyleMenu";
import { TerminalRegistry, type CommandBlock, type PaneSpec, type RegistryEvents } from "./terminal/registry";
import { PaneBackgroundMenu } from "./terminal/PaneBackgroundMenu";
import { CommandBlockMenu } from "./terminal/CommandBlockMenu";
import { ConfirmClose, programName } from "./tabs/ConfirmClose";
import { closeContext } from "./tabs/closeContext";
import { lostReservedPane, type PaneReservation } from "./terminal/paneReservation";
import {useProviderProcesses} from "./agents/useProviderProcesses";
import {processEvidence,withProcessEvidence} from "./agents/processEvidence";
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
  replacePane,
  renameTab,
  setTabStyle,
  setPaneBackground,
  TAB_COLORS,
  resizeDivider,
  resizeFocused,
  restoreWorkspace,
  saveWorkspace,
  setPaneCwd,
  setPaneProject,
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
/** Retry failed saves even if the workspace and history haven't changed. */
const SAVE_RETRY_MS = 5000;
/** While a tab shows a dev server's Open button, how often to check its port is still listened on... */
const DEV_LINK_POLL_MS = 3000;
/** ...and how long after it was printed a port not listened on yet is fine (some servers print first). */
const DEV_LINK_GRACE_MS = 15_000;
/** Open buttons kept per pane (the latest addresses). */
const MAX_DEV_LINKS = 3;
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
  /** "Shortcuts and tips" (Ctrl+Shift+/, the ? button, the palette). */
  const [helpOpen, setHelpOpen] = useState(false);
  /** First start on this PC: a welcome with where to find things, until dismissed. */
  const [welcome, setWelcome] = useState(false);
  useEffect(() => void firstStart().then(setWelcome, () => {}), []);
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
  const [saveErrors, setSaveErrors] = useState<ReadonlyMap<string, string>>(new Map());
  const inbox = useAgentInbox();
  const inboxRef = useRef(inbox.snapshot); inboxRef.current = inbox.snapshot;
  const [inboxOpen, setInboxOpen] = useState(false);
  const [agentAccessOpen, setAgentAccessOpen] = useState(false);
  const [recipesOpen,setRecipesOpen]=useState(false);
  const [libraryOpen,setLibraryOpen]=useState(false);
  const [sessionHandoff,setSessionHandoff]=useState<LibraryEntry>();
  const library=useSessionLibrary();
  useEffect(()=>{setSaveErrors(current=>{if((current.get("Session pins")??null)===(library.pins.error??null))return current;const next=new Map(current);if(library.pins.error)next.set("Session pins",library.pins.error);else next.delete("Session pins");return next;});},[library.pins.error]);
  const agentAccess = useAgentAccess();
  const [agentPaneError, setAgentPaneError] = useState<string>();
  const [problemsOpen, setProblemsOpen] = useState(false);
  const [problemRunId, setProblemRunId] = useState<string>();
  const [worktreesOpen, setWorktreesOpen] = useState(false);
  const worktrees = useWorktreeTasks();
  useEffect(() => {
    setSaveErrors((current) => {
      if ((current.get("Worktree tasks") ?? null) === (worktrees.error ?? null)) return current;
      const next = new Map(current); if (worktrees.error) next.set("Worktree tasks", worktrees.error); else next.delete("Worktree tasks"); return next;
    });
  }, [worktrees.error]);
  const records = useCommandRuns();
  const commandRuns = records.runs;
  const [verificationRun, setVerificationRun] = useState<CommandRun>();
  useEffect(() => {
    setSaveErrors((current) => {
      if ((current.get("Command records") ?? null) === (records.error ?? null)) return current;
      const next = new Map(current); if (records.error) next.set("Command records", records.error); else next.delete("Command records"); return next;
    });
  }, [records.error]);
  useEffect(() => {
    if (!problemsOpen || !records.runs.some((r) => r.verification)) return;
    void records.refresh().catch(() => {});
    const timer = window.setInterval(() => void records.refresh().catch(() => {}), 5000);
    return () => window.clearInterval(timer);
  }, [problemsOpen, records.refresh, records.runs.some((r) => !!r.verification)]);
  useEffect(() => {
    setSaveErrors((current) => {
      if ((current.get("Agent inbox") ?? null) === (inbox.error ?? null)) return current;
      const next = new Map(current);
      if (inbox.error) next.set("Agent inbox", inbox.error); else next.delete("Agent inbox");
      return next;
    });
  }, [inbox.error]);
  const [quitSaveFailed, setQuitSaveFailed] = useState(false);
  const [persistence] = useState(() => new Persistence((store, error) => {
    setSaveErrors((current) => {
      if (error === undefined && !current.has(store)) return current;
      if (error !== undefined && current.get(store) === error) return current;
      const next = new Map(current);
      if (error === undefined) next.delete(store); else next.set(store, error);
      return next;
    });
  }));
  const [attention, setAttention] = useState<ReadonlyMap<PaneId, ClaudeAlert>>(new Map());
  const [alertNotifications] = useState(() => new AlertNotifications());
  const pendingAgentEvents = useMemo(() => inbox.snapshot.events.filter((e) => e.runId === inbox.snapshot.runId && e.resolvedAt === null && (e.kind === "permission" || e.kind === "input")), [inbox.snapshot]);
  const codexAttention = useMemo(() => new Map<PaneId, ClaudeAlert>(pendingAgentEvents.filter((e) => e.provider === "codex")
    .reverse().map((e) => [e.paneId, { paneId: e.paneId, sessionId: e.sessionId, title: e.title, message: e.message, kind: "codex:permission" }])), [pendingAgentEvents]);
  /** Background panes that printed something, or rang the bell, since last seen. */
  const [activity, setActivity] = useState<ReadonlySet<PaneId>>(new Set());
  const [bells, setBells] = useState<ReadonlySet<PaneId>>(new Set());
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [searchAllOpen, setSearchAllOpen] = useState(false);
  const [paneMenu, setPaneMenu] = useState<{ paneId: PaneId; x: number; y: number }>();
  /** A click on a command's ✓/✗ bar: its menu. */
  const [blockMenu, setBlockMenu] = useState<{ paneId: PaneId; block: CommandBlock; x: number; y: number }>();
  const [handoff, setHandoff] = useState<{ paneId: PaneId; sourceProfileId: string; environment:string; shellKind:Profile["kind"]; context: HandoffContext }>();
  /** Process detection cannot establish idle; quiet unobserved panes are unknown. */
  const [claudeStatus, setClaudeStatus] = useState<ReadonlyMap<PaneId, AgentStatus>>(new Map());
  const [claudeObservations, setClaudeObservations] = useState<ReadonlyMap<PaneId, AgentObservation>>(new Map());
  const claudeEvents = useRef(new Map<PaneId, AgentObservation>());
  const [claudeUsages, setClaudeUsages] = useState<ReadonlyMap<PaneId, ClaudeUsage>>(new Map());
  /** Which Claude session each pane runs, from the SessionStart hook. */
  const paneSessions = useRef(new Map<PaneId, PaneClaudeSession>());
  /** What Claude said last in each pane (its Stop hook), and its prompt cache (status line). */
  const [replies, setReplies] = useState<ReadonlyMap<PaneId, string>>(new Map());
  const [caches, setCaches] = useState<ReadonlyMap<PaneId, CacheState>>(new Map());
  /** The project each pane's folder is in: git status, scripts, .qterm.toml. */
  const [projects, setProjects] = useState<ReadonlyMap<PaneId, ProjectInfo>>(new Map());
  /** A paste of several lines waiting for a yes. */
  const [pasteConfirm, setPasteConfirm] = useState<{ paneId: PaneId; text: string }>();
  /** The JSON viewer: the value, and where it came from. */
  const [jsonView, setJsonView] = useState<{ value: Json; source: string }>();
  /** Dev server addresses each pane printed, while their servers listen. */
  const [devLinks, setDevLinks] = useState<ReadonlyMap<PaneId, readonly DevLink[]>>(new Map());
  /** Listening ports, read when the palette opens; the one picked there. */
  const [ports, setPorts] = useState<PortOwner[]>([]);
  const [portDialog, setPortDialog] = useState<PortOwner>();
  /** Picking a shell: for a split of a pane, or to switch a pane to. */
  const [shellPicker, setShellPicker] = useState<{ paneId: PaneId; dir?: SplitDir }>();
  const config = settings?.config;
  const workspaceRef = useRef(workspace);
  workspaceRef.current = workspace;
  /** Typed into a pane's shell once it starts (resuming a Claude session). */
  const startupInput = useRef(new Map<PaneId, string>());
  const startupShellKinds=useRef(new Map<PaneId,Profile["kind"]>());
  const worktreeLaunches=useRef(new Map<PaneId,WorktreeTask>());
  const worktreeProfileKeys=useRef(new Map<PaneId,string>());
  const sourceLaunches=useRef(new Map<PaneId,{source:Pick<LibraryEntry,"key"|"sourceVersion"|"sourceConfig"|"provider"|"environment">;cwd:string}>());
  const startupAtPrompt = useRef(new Set<PaneId>());
  const agentTaskPanes = useRef(new Map<PaneId, { id: string; command: string; submitted: boolean; launchKey?:string|null } & PaneReservation>());
  const recipeHandlers=useRef<ReturnType<typeof useRecipeRuns>>(undefined);
  const verificationTickets = useRef(new Map<PaneId, { id: string; command: string; launch?: VerificationLaunch | null } & PaneReservation>());
  useEffect(() => {
    for (const [paneId, ticket] of verificationTickets.current) {
      if (lostReservedPane(ticket,workspace.panes[paneId]?.profileId)) { verificationTickets.current.delete(paneId); void cancelVerification(ticket.id).catch(() => {}); }
    }
  }, [workspace.panes]);
  /** Output saved before the restart, shown above each restored pane's new shell. */
  const restoredOutput = useRef(new Map<PaneId, string>());

  // The registry outlives renders; its events reach the latest handlers through this ref.
  const handlers = useRef<RegistryEvents>(null!);
  const [registry] = useState(
    () =>
      new TerminalRegistry({
        onValidateStartup:async(paneId,session,cwd)=>{
          const verification=verificationTickets.current.get(paneId);
          if(verification?.launch){await authorizeVerification(verification.id,paneId,session,cwd);return;}
          const worktree=worktreeLaunches.current.get(paneId);
          if(worktree){await validateWorktreeStartup(worktree.id,paneId,session,cwd);worktreeLaunches.current.delete(paneId);return;}
          const pending=sourceLaunches.current.get(paneId);if(!pending)throw new Error("Source launch is no longer pending");
          const current=await resolveLibrarySession(pending.source.key,pending.source.sourceVersion);
          if(!sourceEnabled(pending.source,configRef.current)||!current.launchCwd||!sameCommandFolder(current.launchCwd,cwd,current.environment)||!sameCommandFolder(pending.cwd,cwd,current.environment))throw new Error("Source settings or folder changed before the shell became ready");
          sourceLaunches.current.delete(paneId);
        },
        onAuthorizeStartup: async (paneId, session, cwd) => {
          if(recipeHandlers.current?.hasPane(paneId))return recipeHandlers.current.authorize(paneId,session,cwd);
          const task = agentTaskPanes.current.get(paneId);
          if (!task) throw new Error("Task launch is no longer pending");
          task.submitted = true;
          try { await launchAgentTask(task.id, paneId, session, cwd); }
          catch (e) {
            const snapshot = await agentAccessSnapshot();
            const job = snapshot.invocations.find((j) => j.id === task.id);
            if (!job?.startedAt) { task.submitted = false; throw e; }
            setNotice(`The task launch outcome needs inspection: ${e}`);
          }
        },
        onStartupError: (paneId, message) => {
          worktreeLaunches.current.delete(paneId);worktreeProfileKeys.current.delete(paneId);
          sourceLaunches.current.delete(paneId);
          recipeHandlers.current?.fail(paneId,message);
          const task = agentTaskPanes.current.get(paneId);
          if (task) { agentTaskPanes.current.delete(paneId); void failAgentTask(task.id, message).catch(() => {}); }
          const ticket = verificationTickets.current.get(paneId);
          if (ticket) { verificationTickets.current.delete(paneId); void cancelVerification(ticket.id).catch(() => {}); }
          setNotice(message);
        },
        onCommand: (...args) => handlers.current.onCommand(...args),
        onTitle: (...args) => handlers.current.onTitle(...args),
        onExit: (...args) => handlers.current.onExit(...args),
        onCwd: (...args) => handlers.current.onCwd(...args),
        onClaudeSession: (...args) => handlers.current.onClaudeSession(...args),
        onCodexSession: (...args) => handlers.current.onCodexSession?.(...args),
        onSearchResults: (...args) => handlers.current.onSearchResults(...args),
        onActivity: (...args) => handlers.current.onActivity(...args),
        onBell: (...args) => handlers.current.onBell(...args),
        onCommandFinished: (...args) => handlers.current.onCommandFinished(...args),
        onPaneMenu: (...args) => handlers.current.onPaneMenu(...args),
        onCommandBlock: (...args) => handlers.current.onCommandBlock(...args),
        onTrigger: (...args) => handlers.current.onTrigger(...args),
        onPaste: (...args) => handlers.current.onPaste(...args),
        onDevServer: (...args) => handlers.current.onDevServer(...args),
      }),
  );
  const recipes=useRecipeRuns(registry,workspace,message=>setNotice(message));recipeHandlers.current=recipes;
  useEffect(()=>{
    for(const [pane,pending] of sourceLaunches.current){if(!sourceEnabled(pending.source,config)){registry.cancelStartup(pane);sourceLaunches.current.delete(pane);startupInput.current.delete(pane);setNotice("Source launch cancelled: history or source settings changed before its shell was ready.");}}
  },[config?.claudeSessions,config?.codexSessions,config?.wslSources,registry]);
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
      codexSessions: config.codexSessions,
      inlineImages: config.inlineImages,
      ligatures: config.font.ligatures,
    });
  }, [registry, config]);

  // Triggers of each pane's project (.qterm.toml), and what's wrong with any project's settings.
  const projectTriggers = useMemo(
    () => new Map([...projects].map(([paneId, info]) => [paneId, compileTriggers(info.settings?.triggers ?? [])] as const)),
    [projects],
  );
  const projectProblems = useMemo(
    () => [
      ...[...projects.values()].flatMap((info) => (info.settingsError ? [info.settingsError] : [])),
      ...[...projects].flatMap(([paneId, info]) => (projectTriggers.get(paneId)?.errors ?? []).map((e) => `${info.settings?.path}: ${e}`)),
    ],
    [projects, projectTriggers],
  );
  useEffect(() => {
    for (const paneId of Object.keys(workspaceRef.current.panes)) registry.setPaneTriggers(paneId, projectTriggers.get(paneId)?.triggers ?? []);
  }, [registry, projectTriggers]);

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
    ...projectProblems,
  ].filter((e, i, all): e is string => Boolean(e) && all.indexOf(e) === i);

  // --- workspace actions -------------------------------------------------------
  const newTab = useCallback(
    (profileId?: string, cwd?: string, elevated?: boolean, reservedIds?: { tab: string; pane: string }) => {
      const profile = profileId ? profiles?.find((p) => p.id === profileId) : defaultProfile;
      if (!profile) return undefined;
      const ids = reservedIds ?? { tab: nextId("tab"), pane: nextId("pane") };
      setWorkspace((ws) => openTab(ws, ids, profile, cwd, elevated));
      return ids.pane;
    },
    [profiles, defaultProfile],
  );
  const newTabRef = useRef(newTab);
  newTabRef.current = newTab;
  const openResolvedSession=useCallback((current:LibraryEntry)=>{
    if(!configRef.current?.shellIntegration||!current.cwd)throw Error("Enable shell integration and verify the session folder before resuming.");
    const candidates=(profiles??[]).filter(p=>profileSupportsEnvironment(current.environment,p));
    const profile=candidates.find(p=>p.id===current.profileId)??candidates.find(p=>p.id===defaultProfile?.id)??candidates[0];
    if(!profile)throw new Error("No supported shell matches this session's environment. Restore its distribution profile first.");
    const command=resumeCommand(current.provider,current.id,profile.kind,current.sourceHome);if(!command)throw new Error("This shell cannot resume the selected provider session.");
    if(!sourceEnabled(current,configRef.current))throw new Error("Source settings changed; refresh the session again.");
    const pane=newTab(profile.id,current.launchCwd??current.cwd);if(!pane)throw new Error("Could not open the session tab.");
    startupShellKinds.current.set(pane,profile.kind);sourceLaunches.current.set(pane,{source:sourceContext(current),cwd:current.launchCwd??current.cwd});
    startupInput.current.set(pane,`${command}\r`);startupAtPrompt.current.add(pane);
  },[profiles,defaultProfile,newTab]);
  const resumeLibraryEntry=useCallback(async(entry:LibraryEntry)=>{
    const current=await resolveLibrarySession(entry.key,entry.sourceVersion);
    if(!entry.cwd||!current.cwd||!sameCommandFolder(entry.cwd,current.cwd,current.environment))throw new Error("The source folder changed; refresh and review the session again.");
    openResolvedSession(current);setLibraryOpen(false);
  },[openResolvedSession]);
  const sendSessionHandoff=useCallback(async(provider:AgentProvider,profileId:string,text:string)=>{
    if(!sessionHandoff)throw new Error("Source session is no longer selected.");
    if(!config?.shellIntegration)throw new Error("Enable shell integration before opening a handoff agent, or export the reviewed file.");
    const current=await resolveLibrarySession(sessionHandoff.key,sessionHandoff.sourceVersion),profile=profiles?.find(p=>p.id===profileId);
    if(!profile||!profileSupportsEnvironment(current.environment,profile)||!current.cwd)throw new Error("Choose a supported shell in the source environment.");
    if(!sessionHandoff.cwd||!sameCommandFolder(current.cwd,sessionHandoff.cwd,current.environment)||current.project!==sessionHandoff.project)throw new Error("The source project/folder changed. Refresh and review the handoff again.");
    const brief=current.environment.startsWith("wsl:")?await createWslAgentBrief(current.environment.slice(4),text):await createAgentBrief(text),command=handoffCommand(provider,brief.path,profile.kind,provider===current.provider?current.sourceHome:undefined);if(!command)throw new Error("This shell cannot launch the destination agent.");
    if(!sourceEnabled(sessionHandoff,configRef.current))throw new Error("Source settings changed; refresh and review the handoff again.");
    const pane=newTab(profile.id,current.launchCwd??current.cwd);if(!pane)throw new Error("Could not create the handoff pane.");startupShellKinds.current.set(pane,profile.kind);sourceLaunches.current.set(pane,{source:sourceContext(current),cwd:current.launchCwd??current.cwd});startupInput.current.set(pane,`${command}\r`);startupAtPrompt.current.add(pane);setSessionHandoff(undefined);setNotice("The reviewed session handoff will open at the new pane's empty prompt.");
  },[sessionHandoff,config?.shellIntegration,profiles,newTab]);
  const recipeLaunchBindings=useRef(new Map<string,Record<string,string>>());
  const openedRecipeRuns=useRef(new Set<string>());
  const launchReviewedRecipe=useCallback(async(review:RecipeReview,name:string)=>{
    const definition=review.recipes.find(r=>r.name===name),profile=profiles?.find(p=>p.id===review.profileId);
    if(!definition||!profile)throw new Error("The reviewed workflow shell is unavailable");
    const bindings=recipeLaunchBindings.current.get(review.id)??Object.fromEntries(definition.steps.map(s=>[s.name,nextId("pane")]));recipeLaunchBindings.current.set(review.id,bindings);
    let run;
    try{run=await startRecipe(review.id,name,bindings);}catch(e){run=(await recipeRunsSnapshot()).find(r=>r.reviewId===review.id&&r.name===name);if(!run)throw e;}
    if(openedRecipeRuns.current.has(run.id))return;
    if(run.steps.some(s=>s.state!=="pending"))throw new Error("This workflow launch is no longer pending. Review it again to create a new run.");
    try{
      const current=profilesRef.current?.find(p=>p.id===run.profileId);
      if(!configRef.current?.shellIntegration)throw new Error("Shell integration changed before opening workflow panes. Review again.");
      if(!current||!profileSupportsEnvironment(run.environment,current))throw new Error("The workflow shell no longer matches its reviewed environment.");
      openedRecipeRuns.current.add(run.id);
      recipes.register(run);
      const panes:Pane[]=run.steps.map(step=>{startupInput.current.set(step.paneId,`${step.command}\r`);startupAtPrompt.current.add(step.paneId);startupShellKinds.current.set(step.paneId,profile.kind);return{id:step.paneId,profileId:profile.id,profileName:profile.name,environment:run.environment,title:"",cwd:step.directory};});
      if(run.layout==="tabs")setWorkspace(ws=>panes.reduce((next,pane)=>openTabWith(next,nextId("tab"),{kind:"leaf",pane:pane.id},[pane],`${run.name}: ${run.steps.find(s=>s.paneId===pane.id)!.name}`),ws));
      else {const root:LayoutNode=panes.length===1?{kind:"leaf",pane:panes[0].id}:{kind:"split",dir:run.layout==="rows"?"column":"row",children:panes.map(p=>({kind:"leaf",pane:p.id})),sizes:panes.map(()=>1/panes.length)};setWorkspace(ws=>openTabWith(ws,nextId("tab"),root,panes,run.name));}
      setNotice(`Launched workflow ${run.name}; dependent steps reserve input until ready.`);
    }catch(e){await cancelRecipeRun(run.id);throw e;}
  },[profiles,recipes]);
  const claimingTasks = useRef(new Set<string>());
  const acceptAgentTask = useCallback(async (id: string) => {
    if (claimingTasks.current.has(id)) return;
    claimingTasks.current.add(id);
    let claimed = false;
    try {
      const ids = { tab: nextId("tab"), pane: nextId("pane") };
      const job = await claimAgentTask(id, ids.pane); claimed = true;
      const profile = profilesRef.current?.find((p) => p.id === job.profileId);
      if (!profile || !profileSupportsEnvironment(job.environment,profile)) throw new Error("The reviewed task shell is unavailable in its original environment");
      if(!configRef.current?.shellIntegration)throw new Error("Enable shell integration before opening the task pane");
      agentTaskPanes.current.set(ids.pane, { id, profileId: job.profileId, command: job.task.command, submitted: false,launchKey:job.launchKey });
      startupShellKinds.current.set(ids.pane,profile.kind);
      startupInput.current.set(ids.pane, `${job.task.command}\r`); startupAtPrompt.current.add(ids.pane);
      if (!newTabRef.current(job.profileId, job.task.directory, false, ids)) throw new Error("Could not create a task tab");
      setWorkspace((ws) => renameTab(ws, ids.tab, `${job.requester.client}: ${job.task.name}`));
      setNotice(`Queued ${job.task.name} for ${job.requester.client}; its new tab reserves input until the reviewed task can launch.`);
    } catch (e) {
      if (claimed) await failAgentTask(id, String(e)).catch(() => {});
      setNotice(`Could not open the requested task: ${e}`);
    } finally { claimingTasks.current.delete(id); }
  }, [profiles, newTab]);
  useEffect(() => {
    let active = true;
    const listener = onAgentTaskQueued((id) => { if (active) void acceptAgentTask(id); });
    return () => { active = false; void listener.then((stop) => stop()).catch(() => {}); };
  }, [acceptAgentTask]);
  useEffect(() => {
    for (const job of agentAccess.snapshot.invocations) if (job.state === "queued") void acceptAgentTask(job.id);
    for (const [paneId, task] of agentTaskPanes.current) {
      const job = agentAccess.snapshot.invocations.find((j) => j.id === task.id);
      if (job?.state === "cancelled") { registry.cancelStartup(paneId); agentTaskPanes.current.delete(paneId); startupInput.current.delete(paneId); startupAtPrompt.current.delete(paneId); }
    }
  }, [agentAccess.snapshot.invocations, acceptAgentTask, registry]);
  useEffect(() => {
    for (const [paneId, task] of agentTaskPanes.current) if (lostReservedPane(task,workspace.panes[paneId]?.profileId)) {
      agentTaskPanes.current.delete(paneId); void failAgentTask(task.id, "The task pane closed or changed shell").catch(() => {});
    }
  }, [workspace.panes]);
  const stopRequestedTask = useCallback(async (job: AgentInvocation) => {
    const task = job.paneId ? agentTaskPanes.current.get(job.paneId) : undefined;
    if (job.startedAt && (!task || task.id !== job.id)) throw new Error("That command has already finished or its pane changed. Refresh task status before stopping it.");
    await stopAgentTask(job.id);
  }, []);

  const openWorktree = useCallback(async (task: WorktreeTask, agent: boolean) => {
    task=await prepareWorktreeOpen(task.id,agent);
    const profile = profilesRef.current?.find((p) => p.id === task.profileId);
    if (!profile || profile.kind === "other") throw new Error("The recorded shell is unavailable. Restore that profile before opening this task.");
    const distribution=task.environment?.startsWith("wsl:")?task.environment.slice(4):undefined;
    let command: string | undefined;
    if (agent && task.provider !== "shell") {
      if (!config?.shellIntegration) throw new Error("Enable shell integration before opening a task agent.");
      const text=briefText({ command: `Worktree task: ${task.title}`, cwd: task.directory, output: "" }, task.request);
      const brief = distribution?await createWslAgentBrief(distribution,text):await createAgentBrief(text);
      command = handoffCommand(task.provider, brief.path, profile.kind);
      if (!command) throw new Error("This shell cannot launch the task agent.");
    }
    await prepareWorktreeOpen(task.id,agent);
    if(command&&!configRef.current?.shellIntegration)throw Error("Shell integration changed while preparing the task agent");
    const id = newTab(profile.id, task.directory);
    if (!id) throw new Error("Could not open the worktree tab.");
    setWorkspace((ws) => { const tab = ws.tabs.find((t) => paneIds(t.root).includes(id)); return tab ? renameTab(ws, tab.id, task.title) : ws; });
    if(task.profileKey)worktreeProfileKeys.current.set(id,task.profileKey);
    if (command) { worktreeLaunches.current.set(id,task);startupShellKinds.current.set(id,profile.kind);startupInput.current.set(id, `${command}\r`); startupAtPrompt.current.add(id); }
    setWorktreesOpen(false);
    setNotice(command ? "The task agent will launch at the new worktree's empty shell prompt." : "Opened the task worktree in a new shell tab.");
  }, [profiles, config?.shellIntegration, newTab]);

  const showHandoff = useCallback((paneId: PaneId, block?: CommandBlock) => {
    const pane = workspaceRef.current.panes[paneId];
    if (!pane) return;
    const selected = block ? "" : registry.selection(paneId);
    const command = selected ? undefined : block ?? registry.lastCommandBlock(paneId);
    const output = selected || (command ? registry.blockOutput(paneId, command.id) : "");
    if (!output.trim()) { setNotice("Select some output first, or run a command that prints output."); return; }
    setHandoff({ paneId, sourceProfileId: pane.profileId,environment:registry.environmentOf(paneId)??pane.environment??"unknown",shellKind:registry.shellKindOf(paneId)??"other", context: {
      command: command?.command, cwd: command?.cwd ?? pane.cwd, environment:registry.environmentOf(paneId)??pane.environment??"unknown", exitCode: command?.exitCode, output, selected: Boolean(selected),
    } });
  }, [registry]);

  const sendHandoff = useCallback(async (provider: AgentProvider, profileId: string, where: "new" | "current", text: string) => {
    if (!handoff) throw new Error("The source output is no longer selected.");
    const profile = profiles?.find((p) => p.id === profileId);
    const from = {id:handoff.sourceProfileId,kind:handoff.shellKind,environment:handoff.environment};
    if (!profile || !profileSupportsEnvironment(handoff.environment,profile)) throw new Error("Choose a supported shell in the output's original environment.");
    if (!config?.shellIntegration) throw new Error("Enable shell integration before launching an agent from this action, or copy the brief for a manual handoff.");
    const start = startFolder(handoff.context.cwd, from, profile);
    if (start.lost) throw new Error("This shell cannot open the command's folder. Choose a compatible shell.");
    const distribution=handoff.environment.startsWith("wsl:")?handoff.environment.slice(4):undefined;
    let prompt:string|undefined;
    if (where === "current") {
      const ws = workspaceRef.current;
      const pane = ws.panes[handoff.paneId];
      const session = registry.sessionOf(handoff.paneId);
      if (!pane || pane.profileId !== profileId || session === undefined || registry.environmentOf(pane.id)!==handoff.environment || registry.shellKindOf(pane.id)!==profile.kind || (start.cwd && (!pane.cwd || !sameCommandFolder(pane.cwd, start.cwd,handoff.environment)))) throw new Error("The source pane changed shell or folder. Open a new tab instead.");
      if (ws.tabs.some((tab) => tab.broadcast && paneIds(tab.root).includes(pane.id))) throw new Error("Turn off broadcast input before reusing this pane.");
      prompt=registry.handoffPrompt(pane.id);
      if (!distribution&&(await runningPrograms([session])).length) throw new Error("The source pane is busy. Open a new tab instead.");
    }
    if(distribution){if(!start.cwd)throw Error("The Linux command folder is unknown. Copy the brief for a manual handoff.");start.cwd=await validateWslFolder(distribution,start.cwd);}
    const brief = distribution?await createWslAgentBrief(distribution,text):await createAgentBrief(text);
    const command = handoffCommand(provider, brief.path, profile.kind);
    if (!command) throw new Error("This shell cannot launch the agent.");
    if(!configRef.current?.shellIntegration)throw Error("Shell integration changed while preparing the handoff. Review it again.");
    if (where === "new") {
      const id = newTab(profile.id, start.cwd);
      if (!id) throw new Error("Could not create an agent tab.");
      startupInput.current.set(id, `${command}\r`);
      startupShellKinds.current.set(id,profile.kind);
      startupAtPrompt.current.add(id);
      setNotice("The agent will launch when its new pane reaches an empty shell prompt.");
    } else {
      const ws=workspaceRef.current,pane=ws.panes[handoff.paneId];
      if(!pane||pane.profileId!==profileId||ws.tabs.some(tab=>tab.broadcast&&paneIds(tab.root).includes(pane.id)))throw Error("The source pane or broadcast mode changed. Open a new tab instead.");
      registry.focus(handoff.paneId);
      registry.submitHandoff(handoff.paneId,prompt!,command);
    }
    setHandoff(undefined);
  }, [handoff, profiles, registry, newTab, config?.shellIntegration]);

  const runVerification = useCallback(async () => {
    const run = verificationRun;
    if (!run?.cwd || !run.command.trim() || run.commandTruncated) throw new Error("This run has no complete recorded command or folder.");
    const profile = profiles?.find((p) => p.id === run.profileId);
    if (!profile || profile.kind === "other" || !run.shellKind || run.shellKind !== profile.kind || !profileSupportsEnvironment(run.environment ?? "native",profile)) throw new Error("The original shell profile is unavailable or no longer matches the recorded environment.");
    if (!config?.shellIntegration) throw new Error("Enable shell integration before tracking verification results.");
    const prepared = await prepareVerification(run.cwd, run.command, profile.id, run.environment ?? "native");
    try {
      const current=profilesRef.current?.find(p=>p.id===profile.id);
      if(!configRef.current?.shellIntegration||!current||current.kind!==profile.kind||!profileSupportsEnvironment(run.environment??"native",current))throw new Error("Shell settings changed while preparing verification. Review the command again.");
      if(profile.kind==="wsl"&&(!prepared.launch||prepared.launch.profileId!==profile.id||prepared.launch.environment!==run.environment))throw new Error("The prepared verification does not match the recorded WSL environment.");
      const paneId = newTabRef.current(profile.id, prepared.launch?.cwd ?? run.cwd);
      if (!paneId) throw new Error("Could not open a verification pane.");
      verificationTickets.current.set(paneId, { id: prepared.id, command:run.command, profileId: profile.id, launch:prepared.launch });
      startupShellKinds.current.set(paneId,profile.kind);
      startupInput.current.set(paneId, `${run.command}\r`); startupAtPrompt.current.add(paneId);
    } catch(error) { await cancelVerification(prepared.id); throw error; }
    setVerificationRun(undefined);
    setNotice("The reviewed check will run when its new pane reaches an empty prompt in the recorded folder.");
  }, [verificationRun, profiles, config?.shellIntegration, newTab]);

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

  /**
   * Where `to` starts for a pane in `cwd` running `fromProfile`: the same folder, as that
   * shell writes it. Says so when it can't start there (its home folder then).
   */
  const folderFor = useCallback(
    async (cwd: string | undefined, fromProfile: string | undefined, to: Profile,environment?:string) => {
      const current = profiles?.find((p) => p.id === fromProfile);
      const from = current?{...current,environment}:environment?{id:fromProfile??"unavailable",kind:"other" as const,environment}:undefined;
      const start = await transferFolder(cwd, from, to,wslTranslatePaths);
      if (start.lost) setNotice(`${to.name} can't start in ${cwd}, so it opened in its home folder.`);
      return start.cwd;
    },
    [profiles],
  );

  // A split runs the same profile (or `options.profileId`) in the same folder as the pane
  // being split, or in `options.cwd`, typing `options.command` once its shell starts (a
  // project task).
  const split = useCallback(
    (paneId: PaneId, dir: SplitDir, options?: { cwd?: string; command?: string; profileId?: string }) => {
      const source = workspaceRef.current.panes[paneId];
      const profile = profiles?.find((p) => p.id === (options?.profileId ?? source?.profileId)) ?? defaultProfile;
      if (!profile) return;
      void (async()=>{
        if(options?.command&&!configRef.current?.shellIntegration)throw Error("Enable shell integration before launching a project task at its new prompt.");
        const cwd = options?.cwd ?? await folderFor(source?.cwd, source?.profileId, profile,registry.environmentOf(paneId)??source?.environment);
        const current=workspaceRef.current.panes[paneId];if(!source||!current||current.profileId!==source.profileId||current.cwd!==source.cwd)throw Error("The source pane changed while its folder was being translated; try again.");
        const newPane=nextId("pane");if(options?.command){startupInput.current.set(newPane,`${options.command}\r`);startupAtPrompt.current.add(newPane);}
        setWorkspace((ws) => splitPane(ws, paneId, dir, newPane, profile, cwd));
      })().catch(e=>setNotice(`Could not split the pane: ${e}`));
    },
    [profiles, defaultProfile, folderFor],
  );

  const closePaneById = useCallback(
    (paneId: PaneId) => {
      registry.dispose(paneId);
      startupInput.current.delete(paneId);
      startupShellKinds.current.delete(paneId);
      worktreeLaunches.current.delete(paneId);worktreeProfileKeys.current.delete(paneId);
      sourceLaunches.current.delete(paneId);
      startupAtPrompt.current.delete(paneId);
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

  /** Closing by hand: ask first when a program still runs there (a shell that exits closes as before). */
  const [confirmClose, setConfirmClose] = useState<{ what: "tab" | "pane"; programs: string[]; error?: string; verb: "close" | "switch"; close(): void }>();
  const closeRequest = useRef(0);
  const askToClose = useCallback(
    (what: "tab" | "pane", panes: PaneId[], close: () => void, verb: "close" | "switch" = "close") => {
      const request=++closeRequest.current;
      const context=closeContext(workspaceRef.current,what,panes,id=>registry.closeToken(id));
      const valid=()=>{
        if(request!==closeRequest.current)return false;
        if(context!==undefined&&context===closeContext(workspaceRef.current,what,panes,id=>registry.closeToken(id)))return true;
        setNotice("The pane or tab changed while checking running programs. Try the close or switch action again.");
        return false;
      };
      const finish=()=>{if(valid())close();};
      const sessions = panes.map((id) => registry.sessionOf(id)).filter((s): s is number => s !== undefined);
      void runningPrograms(sessions)
        .then((programs) => {if(valid())programs.length ? setConfirmClose({ what, programs: programs.map(programName), verb, close:finish }) : finish();})
        .catch((error) => {if(valid())setConfirmClose({ what, programs: [], error: String(error), verb, close:finish });});
    },
    [registry],
  );
  const requestCloseTab = useCallback(
    (tabId: TabId) => {
      const tab = workspaceRef.current.tabs.find((t) => t.id === tabId);
      if (tab) askToClose("tab", paneIds(tab.root), () => closeTab(tabId));
    },
    [askToClose, closeTab],
  );

  /** Puts `profileId`'s shell where the pane is, in its folder; asks first if a program runs there. */
  const switchShell = useCallback(
    (paneId: PaneId, profileId: string) => {
      const pane = workspaceRef.current.panes[paneId];
      const profile = profiles?.find((p) => p.id === profileId);
      if (!pane || !profile) return;
      askToClose(
        "pane",
        [paneId],
        () => {void (async()=>{
          const session=registry.sessionOf(paneId),submission=registry.submissionRevision(paneId);
          const cwd = await folderFor(pane.cwd, pane.profileId, profile,registry.environmentOf(paneId)??pane.environment);
          const current=workspaceRef.current.panes[paneId];if(!current||registry.sessionOf(paneId)!==session||registry.submissionRevision(paneId)!==submission||current.profileId!==pane.profileId||current.cwd!==pane.cwd)throw Error("The source pane changed while its folder was being translated; try again.");
          const newPane = nextId("pane");
          registry.dispose(paneId);
          startupInput.current.delete(paneId);
          startupShellKinds.current.delete(paneId);
          worktreeLaunches.current.delete(paneId);worktreeProfileKeys.current.delete(paneId);
          sourceLaunches.current.delete(paneId);
          startupAtPrompt.current.delete(paneId);
          setAttention((current) => without(current, paneId));
          setWorkspace((ws) => replacePane(ws, paneId, newPane, profile, cwd));
        })().catch(e=>setNotice(`Could not switch the pane: ${e}`));},
        "switch",
      );
    },
    [profiles, folderFor, askToClose, registry],
  );

  const profilesRef = useRef(profiles);
  profilesRef.current = profiles;
  const claudeStatusRef = useRef<ReadonlyMap<PaneId, AgentStatus>>(new Map());
  const codexStatusRef = useRef<ReadonlyMap<PaneId, AgentStatus>>(new Map());
  const resumeProvider=useCallback(async(provider:AgentProvider,session:ClaudeSession,where:"new"|"current")=>{
    try{
      if(!configRef.current?.shellIntegration)throw Error("Enable shell integration before resuming a provider session.");
      const environment=sessionEnvironment(session),targetId=activeTab(workspaceRef.current)?.focusedPane;
      const target=targetId?workspaceRef.current.panes[targetId]:undefined,kind=targetId?registry.shellKindOf(targetId):undefined;
      let prompt:string|undefined;
      if(where==="current"&&target&&kind&&kind!=="other"&&registry.environmentOf(target.id)===environment&&!claudeStatusRef.current.has(target.id)&&!codexStatusRef.current.has(target.id)){
        try{prompt=registry.handoffPrompt(target.id);}catch{/* A busy/unknown initial prompt uses the verified new-tab path. */}
      }
      const current=await resolveProviderSession({provider,id:session.id.toLowerCase(),environment});
      if(session.cwd&&current.cwd&&!sameCommandFolder(session.cwd,current.cwd,environment))throw Error("The session folder changed. Refresh and review it in Session library before resuming.");
      if(where==="new"||!prompt||!target||!kind){openResolvedSession(current);if(where==="current")setNotice("The current pane is busy or incompatible, so the verified session opened in a new tab.");return;}
      if(registry.handoffPrompt(target.id)!==prompt)throw Error("The source pane changed while resolving the session; nothing was typed.");
      const nativeSession=registry.sessionOf(target.id);
      if(environment==="native"&&nativeSession!==undefined&&(await runningPrograms([nativeSession])).length){
        if(registry.handoffPrompt(target.id)!==prompt)throw Error("The source pane changed while checking its programs; nothing was typed.");
        openResolvedSession(current);setNotice("The current pane has a running program, so the verified session opened in a new tab.");return;
      }
      const verified=await resolveLibrarySession(current.key,current.sourceVersion);
      if(!verified.launchCwd||!current.launchCwd||!sameCommandFolder(current.launchCwd,verified.launchCwd,environment)||!sourceEnabled(verified,configRef.current))throw Error("Source settings or folder changed; refresh and review this session again.");
      if(!configRef.current?.shellIntegration||activeTab(workspaceRef.current)?.focusedPane!==target.id||workspaceRef.current.panes[target.id]?.profileId!==target.profileId)throw Error("The focused pane changed; nothing was typed.");
      const command=resumeCommand(provider,verified.id,kind,verified.sourceHome,verified.launchCwd);if(!command)throw Error("This shell cannot resume the selected provider session.");
      registry.submitHandoff(target.id,prompt,command);registry.focus(target.id);
    }catch(error){setNotice(`Could not resume ${provider}: ${error}`);}
  },[registry,openResolvedSession]);
  const resumeClaude=useCallback((session:ClaudeSession)=>void resumeProvider("claude",session,"new"),[resumeProvider]);
  const resumeClaudeHere=useCallback((session:ClaudeSession)=>void resumeProvider("claude",session,"current"),[resumeProvider]);
  const newProviderSession=useCallback(async(provider:AgentProvider,cwd:string,environment:string)=>{
    try{
      if(!configRef.current?.shellIntegration)throw Error("Enable shell integration before launching an agent at its new prompt.");
      const candidates=(profiles??[]).filter(profile=>profileSupportsEnvironment(environment,profile)&&!(profile.kind==="cmd"&&cwd.startsWith("\\\\")));
      const profile=candidates.find(profile=>profile.id===defaultProfile?.id)??candidates[0];if(!profile)throw Error("No supported shell matches this folder's captured environment.");
      const folder=environment.startsWith("wsl:")?await validateWslFolder(environment.slice(4),cwd):cwd;
      if(!configRef.current?.shellIntegration)throw Error("Shell integration changed before launch.");
      const pane=newTab(profile.id,folder);if(!pane)throw Error("Could not open the agent pane.");startupShellKinds.current.set(pane,profile.kind);startupAtPrompt.current.add(pane);startupInput.current.set(pane,provider==="codex"?"codex --no-daemon\r":"claude\r");
    }catch(error){setNotice(`Could not open ${provider}: ${error}`);}
  },[profiles,defaultProfile,newTab]);
  const newClaudeSession=useCallback((cwd:string,environment:string)=>void newProviderSession("claude",cwd,environment),[newProviderSession]);

  const paneSpec = useCallback((pane: Pane): PaneSpec => {
    const profile = profilesRef.current?.find((p) => p.id === pane.profileId);
    return {
      profileId: pane.profileId,
      profileKey:agentTaskPanes.current.get(pane.id)?.launchKey??recipeHandlers.current?.profileKey(pane.id)??verificationTickets.current.get(pane.id)?.launch?.profileKey??worktreeProfileKeys.current.get(pane.id),
      distribution: profile?.distribution,
      shellKind:startupShellKinds.current.get(pane.id)??profile?.kind,
      environment:pane.environment,
      cwd: pane.cwd,
      startupInput: startupInput.current.get(pane.id),
      startupAtPrompt: startupAtPrompt.current.has(pane.id),
      startupAuthorization: agentTaskPanes.current.has(pane.id) || !!recipeHandlers.current?.hasPane(pane.id),
      startupValidation:!!verificationTickets.current.get(pane.id)?.launch||sourceLaunches.current.has(pane.id)||worktreeLaunches.current.has(pane.id),
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
  const focusedProject = focusedPane ? projects.get(focusedPane) : undefined;

  handlers.current = {
    onCommand(paneId: PaneId, command: Command) {
      switch (command.type) {
        case "newTab":
          if (command.profileIndex === undefined) newTab();
          else if (profiles?.[command.profileIndex]) newTab(profiles[command.profileIndex].id);
          break;
        case "closePane":
          askToClose("pane", [paneId], () => closePaneById(paneId));
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
        case "showHelp":
          setHelpOpen((open) => !open);
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
          const waiting = inboxRef.current.events.filter((e) => e.resolvedAt === null && (e.kind === "permission" || e.kind === "input") && e.runId === inboxRef.current.runId).map((e) => e.paneId);
          const next = nextWaiting(order, new Set(waiting), paneId);
          if (next) setWorkspace((w) => focusPane(w, next));
          else setNotice("No coding agent is waiting for you in any pane.");
          break;
        }
        case "agentInbox": setInboxOpen(true); break;
        case "problems": setProblemsOpen(true); break;
        case "worktrees": setWorktreesOpen(true); break;
        case "agentAccess": setAgentAccessOpen(true); break;
        case "recipes": setRecipesOpen(true); break;
        case "sessionLibrary": setLibraryOpen(true); break;
        case "stopPrograms": {
          const session = registry.sessionOf(paneId);
          if (session === undefined) break;
          const release=registry.reserveStop(paneId);
          if(!release){setNotice("This pane is preparing startup input or already stopping programs.");break;}
          setNotice("Stopping programs; this pane's input is reserved until Stop finishes.");
          void stopPrograms(session)
            .then((ended) => registry.sessionOf(paneId)===session&&
              setNotice(ended.length ? `Stopped ${ended.map(programName).join(", ")}; the shell is still there.` : "Nothing runs in this pane but its shell."),
            )
            .catch((e) => setNotice(`Could not stop it: ${e}`)).finally(release);
          break;
        }
        case "viewJson": {
          const selected = registry.selection(paneId);
          const text = selected || registry.lastCommandOutput(paneId);
          const value = text ? findJson(text) : undefined;
          if (value !== undefined) setJsonView({ value, source: selected ? "the selection" : "the last command's output" });
          else if (selected) setNotice("There's no JSON in the selection.");
          else setNotice("Select some JSON first, or run a command that prints JSON: its output is used.");
          break;
        }
        case "splitWith":
          setShellPicker({ paneId, dir: command.dir });
          break;
        case "askAgent":
          showHandoff(paneId);
          break;
        case "switchShell":
          setShellPicker({ paneId });
          break;
        case "toggleSize":
          void toggleConsoleSize().catch((e) => setNotice(`Could not resize the console: ${e}`));
          break;
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
    onExit: (paneId, code) => {
      recipeHandlers.current?.fail(paneId,"Workflow shell exited before completion");
      const task=agentTaskPanes.current.get(paneId);
      if(task){
        registry.cancelStartup(paneId);startupInput.current.delete(paneId);startupAtPrompt.current.delete(paneId);
        agentTaskPanes.current.delete(paneId);
        void failAgentTask(task.id,`The task shell exited before command completion (exit ${code})`).catch(()=>{});
      }
      const ticket=verificationTickets.current.get(paneId);
      if(ticket){
        registry.cancelStartup(paneId);startupInput.current.delete(paneId);
        verificationTickets.current.delete(paneId);
        void cancelVerification(ticket.id).catch(()=>{});
      }
      if(code===0)closePaneById(paneId);
    },
    onCwd: (paneId, cwd) => {
      setWorkspace((ws) => setPaneCwd(ws, paneId, cwd));
      setHistory((h) => rememberFolder(h, cwd));
    },
    onCodexSession: (paneId, id) => codex.seen(paneId, id, false),
    onClaudeSession: (paneId, id) => {
      const pane = workspaceRef.current.panes[paneId];
      if (pane) void claudeSessionSeen(id, pane.profileId, pane.cwd,sightingContext(registry.environmentOf(paneId)??pane.environment,registry.shellKindOf(paneId))).catch(e=>setNotice(`Could not remember Claude session: ${e}`));
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
    onPaste: (paneId, text) => {
      // No text: maybe an image (a screenshot), typed as the path of a file holding it.
      if (!text) return void pasteImage(paneId);
      // Several lines would run one by one in a shell; Claude Code and full-screen programs take them as input.
      const ask = configRef.current?.pasteWarning !== false && isMultiLine(text) && !claudeStatusRef.current.has(paneId) && !codexStatusRef.current.has(paneId) && !registry.fullScreen(paneId);
      if (ask) setPasteConfirm({ paneId, text });
      else registry.pasteText(paneId, text);
    },
    onDevServer: (paneId, url, port) =>
      setDevLinks((current) => {
        const kept = (current.get(paneId) ?? []).filter((link) => link.port !== port && link.url !== url);
        return new Map(current).set(paneId, [...kept, { url, port, at: Date.now() }].slice(-MAX_DEV_LINKS));
      }),
    onCommandFinished: (paneId, finished) => {
      const run = commandRun({ paneId, profileId: workspaceRef.current.panes[paneId]?.profileId, shellKind:finished.shellKind, command: finished.command,
        environment:finished.environment,
        cwd: finished.cwd, exitCode: finished.exitCode, output: finished.output, outputTruncated: finished.outputTruncated,
        startedAt: finished.startedAt, finishedAt: finished.startedAt + finished.durationMs });
      const task = agentTaskPanes.current.get(paneId);
      const recipeId=recipeHandlers.current?.finished(paneId,finished.command);if(recipeId)run.id=recipeId;
      if (task?.submitted) {
        if (finished.command.trim() === task.command.trim()) run.id = task.id;
        else void failAgentTask(task.id, "The shell reported a different command; its result was saved as an ordinary command").catch(() => {});
        agentTaskPanes.current.delete(paneId);
      }
      const ticket = verificationTickets.current.get(paneId);
      verificationTickets.current.delete(paneId);
      const matchesTicket=ticket&&finished.command===ticket.command;
      if(ticket&&!matchesTicket){registry.cancelStartup(paneId);startupInput.current.delete(paneId);void cancelVerification(ticket.id).catch(()=>{});}
      void records.record(run, matchesTicket?ticket.id:undefined).catch((e) => setNotice(`Could not save command record: ${e}`));
      // A command may have changed the repository, or the project's settings.
      refreshProject.current(paneId);
      // A server it ran has stopped: check its port now rather than at the next poll.
      if (devLinksRef.current.size) void checkDevLinks.current(paneId);
      const cwd = finished.cwd;
      setHistory((h) =>
        rememberCommand(h, { command: finished.command, cwd, exitCode: finished.exitCode, at: Date.now(), durationMs: finished.durationMs }),
      );
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

  /** The image on the clipboard, saved as a file, its path typed as the pane's shell writes paths. */
  function pasteImage(paneId: PaneId) {
    let destinations:FileDestination[];try{destinations=fileDestinations(paneId);}catch(e){setNotice(`Could not paste the image: ${e}`);return;}
    void clipboardImageFile()
      .then((file) => {
        if (!file) return;
        return pasteFiles(paneId,[file],destinations);
      })
      .catch((e) => setNotice(`Could not paste the image: ${e}`));
  }

  /** File paths are data. Translate in the actual destination before shell quoting. */
  function fileDestinations(paneId:PaneId):FileDestination[]{
    return registry.inputTargets(paneId).map(id=>{
      const session=registry.sessionOf(id),environment=registry.environmentOf(id),kind=registry.shellKindOf(id);
      if(!workspaceRef.current.panes[id]||session===undefined||!environment||!kind||!registry.acceptsPaste(id))throw Error("A file destination is unavailable or reserved for task startup.");
      return{id,session,submission:registry.submissionRevision(id),environment,kind};
    });
  }
  async function pasteFiles(paneId:PaneId,paths:string[],destinations=fileDestinations(paneId)){
    const prepared=await prepareFilePaste(paths,destinations,wslTranslatePaths);
    deliverFilePaste(prepared,destinations,fileDestinations(paneId),(id,text)=>registry.pasteTextToPane(id,text));
  }

  // --- dev servers: an Open button while their port is listened on ---------------------
  const devLinksRef = useRef(devLinks);
  devLinksRef.current = devLinks;
  /**
   * Drops the links whose port nobody listens on any more. A port not listened on yet is
   * fine for a moment after its address was printed, unless the command in that pane has
   * ended (`endedIn`): then nothing will start listening there.
   */
  const checkDevLinks = useRef<(endedIn?: PaneId) => Promise<void>>(null!);
  checkDevLinks.current = async (endedIn) => {
    const owners = await listeningPorts().catch(() => undefined);
    if (!owners) return;
    const listened = new Set(owners.map((o) => o.port));
    const now = Date.now();
    const alive = (paneId: PaneId, link: DevLink) => listened.has(link.port) || (paneId !== endedIn && now - link.at < DEV_LINK_GRACE_MS);
    setDevLinks((current) => {
      if ([...current].every(([paneId, links]) => links.every((link) => alive(paneId, link)))) return current;
      const next = new Map<PaneId, readonly DevLink[]>();
      for (const [paneId, links] of current) {
        const kept = links.filter((link) => alive(paneId, link));
        if (kept.length) next.set(paneId, kept);
      }
      return next;
    });
  };
  const hasDevLinks = devLinks.size > 0;
  useEffect(() => {
    if (!hasDevLinks) return;
    const timer = window.setInterval(() => void checkDevLinks.current(), DEV_LINK_POLL_MS);
    return () => window.clearInterval(timer);
  }, [hasDevLinks]);
  // The palette lists the ports in use as they are now.
  useEffect(() => {
    if (paletteOpen) void listeningPorts().then(setPorts, () => setPorts([]));
  }, [paletteOpen]);
  /** "Who uses this port?" → End: the process and what it started. */
  const endPort = useCallback((owner: PortOwner) => {
    void endPortOwner(owner.port, owner.pid)
      .then((ended) => setNotice(`Ended ${ended.map(programName).join(", ")}; port ${owner.port} is free.`))
      .catch((e) => setNotice(`Could not end it: ${e}`))
      .finally(() => void checkDevLinks.current());
  }, []);

  // --- projects: each pane's git status, scripts and .qterm.toml ----------------------------
  /** Per pane: a read in flight, and whether another is wanted when it's back (the folder changed meanwhile). */
  const projectReads = useRef(new Map<PaneId, { again: boolean }>());
  /** Reads the pane's project again (after a cd, a command, a Claude turn). */
  const refreshProject = useRef<(paneId: PaneId) => void>(null!);
  refreshProject.current = (paneId) => {
    const pending = projectReads.current.get(paneId);
    if (pending) {
      pending.again = true;
      return;
    }
    const cwd = workspaceRef.current.panes[paneId]?.cwd;
    if (!cwd) return setProjects((current) => without(current, paneId));
    const read = { again: false };
    projectReads.current.set(paneId, read);
    void projectInfo(cwd,workspaceRef.current.panes[paneId]?.profileId,registry.environmentOf(paneId))
      .catch(() => undefined)
      .then((info) => {
        projectReads.current.delete(paneId);
        if (!workspaceRef.current.panes[paneId]) return;
        setProjects((current) => (info ? new Map(current).set(paneId, info) : without(current, paneId)));
        if (read.again) refreshProject.current(paneId);
      });
  };
  // A new pane, or one whose folder changed: read its project. Closed panes are forgotten.
  const projectCwds = useRef(new Map<PaneId, string | undefined>());
  useEffect(() => {
    for (const pane of Object.values(workspace.panes)) {
      if (projectCwds.current.has(pane.id) && projectCwds.current.get(pane.id) === pane.cwd) continue;
      projectCwds.current.set(pane.id, pane.cwd);
      refreshProject.current(pane.id);
    }
    for (const paneId of [...projectCwds.current.keys()]) if (!workspace.panes[paneId]) projectCwds.current.delete(paneId);
    const gone = (map: ReadonlyMap<PaneId, unknown>) => [...map.keys()].some((id) => !workspace.panes[id]);
    setProjects((current) => (gone(current) ? new Map([...current].filter(([id]) => workspace.panes[id])) : current));
    setDevLinks((current) => (gone(current) ? new Map([...current].filter(([id]) => workspace.panes[id])) : current));
  }, [workspace.panes]);
  // The project's name, colour and icon go on its panes' tabs.
  useEffect(() => {
    setWorkspace((ws) => Object.keys(ws.panes).reduce((next, paneId) => setPaneProject(next, paneId, projectLook(projects.get(paneId))), ws));
  }, [projects]);
  // The palette lists the focused pane's scripts as they are now.
  useEffect(() => {
    const paneId = activeTab(workspaceRef.current)?.focusedPane;
    if (paletteOpen && paneId) refreshProject.current(paneId);
  }, [paletteOpen]);

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
    if (workspaceRef.current.panes[alert.paneId]) claudeEvents.current.set(alert.paneId,
      hookObservation(alert.kind?.startsWith("stop_failure") ? "failed" : "waiting", alert.kind ?? "Notification", registry.submissionRevision(alert.paneId), alert.sessionId));
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
    if (!consoleInFocus && notify && alertNotifications.allow(alert)) void showClaudeAlert(alert);
  }
  /** Durable pending requests from either provider, including closed panes. */
  const claudeWaiting = useMemo(() => new Set(inbox.snapshot.events.filter((e) => e.resolvedAt === null && (e.kind === "permission" || e.kind === "input")).map((e) => e.paneId)).size, [inbox.snapshot.events]);
  useEffect(() => void setAttentionCount(claudeWaiting), [claudeWaiting]);
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
  useEffect(() => {
    if (!agentAccess.snapshot.grants.length) return;
    let active = true;
    const publish = () => void publishAgentPanes(Object.values(workspace.panes).map((pane) => ({
      id: pane.id, cwd: pane.cwd && pane.cwd.length <= 4096 ? pane.cwd : null,
      label: limitText(paneLabel(pane.id), 512), profileId: pane.profileId,
      environment: registry.environmentOf(pane.id) ?? pane.environment ?? null,
      kind: (registry.environmentOf(pane.id)??pane.environment)?.startsWith("wsl:") ? "wsl" : profiles?.find((p) => p.id === pane.profileId)?.kind ?? "other",
    }))).then(() => active && setAgentPaneError(undefined), (e) => active && setAgentPaneError(`Could not publish pane observations: ${e}`));
    publish(); const timer = window.setInterval(publish, 5000);
    return () => { active = false; window.clearInterval(timer); };
  }, [agentAccess.snapshot.grants.length, workspace, profiles, paneLabel]);
  const revealHit = useCallback(
    (hit: SearchHit, query: string, options: SearchOptions) => {
      setWorkspace((ws) => focusPane(ws, hit.paneId));
      void registry.revealMatch(hit.paneId, hit.index, query, options);
    },
    [registry],
  );

  const processSnapshot=useProviderProcesses(Boolean(config?.claudeSessions||config?.claudeAlerts||config?.codexSessions||config?.codexAlerts||config?.codexRestore),registry,workspace);
  const codex = useCodex({
    processes:processSnapshot,
    config, workspace, registry, attention: codexAttention,
    raiseAlert: (alert, notify) => raiseAlert(alert, notify),
    clearAlert: (paneId) => setAttention((current) => current.get(paneId)?.kind?.startsWith("codex:") ? without(current, paneId) : current),
    focusPane: (paneId) => setWorkspace((ws) => focusPane(ws, paneId)),
    label: paneLabel, notice: setNotice,
    refreshProject: (paneId) => refreshProject.current(paneId),
    resumeSession:(session,where)=>void resumeProvider("codex",session,where),
    newSession:(cwd,environment)=>void newProviderSession("codex",cwd,environment),
  });
  codexStatusRef.current = codex.status;
  useEffect(() => {
    const titles = new Map([...codex.usages].flatMap(([id, u]) => u.title ? [[id, u.title] as const] : []));
    if (titles.size) setWorkspace((ws) => withClaudeTitles(ws, titles));
  }, [codex.usages]);

  // --- Claude Code's status line: exact figures and plan usage ------------------------
  const onStatusline = useRef<(line: StatuslineUsage) => void>(null!);
  onStatusline.current = (line) => {
    if (!workspaceRef.current.panes[line.paneId]) return;
    const session = paneSessions.current.get(line.paneId);
    if (line.sessionId && session && line.sessionId !== session.sessionId) return;
    statuslines.current.set(line.paneId, line);
    if (line.cache) {
      const cache = line.cache;
      setCaches((current) => new Map(current).set(line.paneId, cache));
    }
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

  // --- Claude's last reply (Stop hook) --------------------------------------------------
  const onReply = useRef<(reply: ClaudeReply) => void>(null!);
  onReply.current = (reply) => {
    if (!workspaceRef.current.panes[reply.paneId]) return;
    claudeEvents.current.set(reply.paneId, hookObservation("completed", "Stop", registry.submissionRevision(reply.paneId), reply.sessionId));
    setReplies((current) => new Map(current).set(reply.paneId, reply.message));
    // Claude may have changed the repository during the turn.
    refreshProject.current(reply.paneId);
  };

  // --- quick select: keys pick a label while the labels show ------------------------
  /** Copies the target, or with Shift opens it: a link in the browser, a file in the editor, a folder in a new tab. */
  const pickTarget = useCallback(
    (paneId: PaneId, target: Target, open: boolean) => {
      const copy = () => void writeText(target.text).then(() => setNotice(`Copied ${target.text}`));
      if (!open || target.kind === "hash" || target.kind === "ip") return copy();
      if (target.kind === "url") return void openUrl(target.text).catch((e) => setNotice(`Could not open it: ${e}`));
      if (target.kind === "folder") return void newTab(undefined, target.text);
      void resolveFiles([target.text], workspaceRef.current.panes[paneId]?.cwd,workspaceRef.current.panes[paneId]?.profileId,registry.environmentOf(paneId))
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
        hint:
          [projects.get(tab.focusedPane)?.git && `⎇ ${gitSummary(projects.get(tab.focusedPane)!.git!)}`, i < 9 && `Ctrl+Alt+${i + 1}`]
            .filter(Boolean)
            .join(" · ") || undefined,
        run: () => setWorkspace((ws) => activateTab(ws, tab.id)),
      })),
      ...(profiles ?? []).map((profile) => ({
        id: `profile:${profile.id}`,
        group: "New tab",
        label: profile.name,
        run: () => void newTab(profile.id),
      })),
      ...(["row", "column"] as const).flatMap((dir) =>
        (profiles ?? []).map((profile) => ({
          id: `split-with:${dir}:${profile.id}`,
          group: dir === "row" ? "Split right with" : "Split down with",
          label: profile.name,
          run: () => {
            const pane = target();
            if (pane) split(pane, dir, { profileId: profile.id });
          },
        })),
      ),
      ...(profiles ?? []).map((profile) => ({
        id: `switch-shell:${profile.id}`,
        group: "Switch this pane to",
        label: profile.name,
        run: () => {
          const pane = target();
          if (pane) switchShell(pane, profile.id);
        },
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
      ...(focusedProject?.settings?.snippets ?? []).map((snippet, i) => ({
        id: `project-snippet:${i}`,
        group: "Snippet",
        label: snippet.name,
        hint: `project · ${snippet.command.length > 40 ? `${snippet.command.slice(0, 39)}…` : snippet.command}`,
        run: () => {
          const pane = target();
          if (pane) registry.typeSnippet(pane, snippet.command, snippet.run);
        },
      })),
      ...(focusedProject?.tasks?.tasks ?? []).map((task) => ({
        id: `task:${task.source}:${task.name}`,
        group: "Project task",
        label: task.name,
        hint: `${task.command} · ${task.source}`,
        // In a new pane beside this one, in the folder the manifest is in.
        run: () => {
          const pane = target();
          if (pane) split(pane, "row", { cwd: focusedProject!.tasks!.dir, command: task.command });
        },
      })),
      ...[...devLinks].flatMap(([paneId, links]) =>
        links.map((link) => ({
          id: `dev-server:${paneId}:${link.port}`,
          group: "Dev server",
          label: `Open ${link.url}`,
          hint: paneLabel(paneId),
          run: () => void openUrl(link.url).catch((e) => setNotice(`Could not open it: ${e}`)),
        })),
      ),
      ...ports.map((owner) => {
        const paneId = owner.sessionId === null ? undefined : Object.keys(workspace.panes).find((id) => registry.sessionOf(id) === owner.sessionId);
        return {
          id: `port:${owner.port}:${owner.pid}`,
          group: "Port",
          label: `${owner.port} ${owner.process ? programName(owner.process) : `process ${owner.pid}`}`,
          hint: paneId ? paneLabel(paneId) : `pid ${owner.pid}`,
          run: () => setPortDialog(owner),
        };
      }),
      ...(config?.codexSessions ? codex.sessions : []).flatMap((session) => {const environment=sessionEnvironment(session),label=`${session.title??session.id} · ${environmentLabel(environment)}`;return[
        { id: `codex:${environment}:${session.id}`, group: "Resume Codex", label, run: () => codex.resume(session) },
        { id: `codex-here:${environment}:${session.id}`, group: "Resume Codex here", label, run: () => codex.resumeHere(session) },
      ];}),
      ...(config?.claudeSessions ? claudeSessions : []).flatMap((session) => {
        const environment=sessionEnvironment(session),label = `${session.title ?? session.id.slice(0, 8)}${session.cwd ? ` (${session.cwd})` : ""} · ${environmentLabel(environment)}`;
        return [
          { id: `claude:${environment}:${session.id}`, group: "Resume Claude", label, run: () => resumeClaude(session) },
          { id: `claude-here:${environment}:${session.id}`, group: "Resume Claude here", label, run: () => resumeClaudeHere(session) },
        ];
      }),
      ...pendingAgentEvents.filter((e) => workspace.panes[e.paneId]).map((event) => ({
        id: `waiting:${event.id}`,
        group: "Agent waits",
        label: `${event.provider === "codex" ? "Codex" : "Claude"} · ${paneLabel(event.paneId)}`,
        hint: event.message.length > 40 ? `${event.message.slice(0, 39)}…` : event.message,
        run: () => setWorkspace((ws) => focusPane(ws, event.paneId)),
      })),
      ...history.commands.slice(0, 50).map((recent, i) => ({
        id: `recent-command:${i}`,
        group: "Recent command",
        label: recent.command,
        hint:
          [
            recent.exitCode !== undefined && recent.exitCode !== 0 ? `✗ ${recent.exitCode}` : "",
            formatClock(recent.at, Date.now()),
            recent.durationMs !== undefined ? formatDuration(recent.durationMs) : "",
            recent.cwd ?? "",
          ]
            .filter(Boolean)
            .join(" · ") || undefined,
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
  }, [config, workspace, profiles, claudeSessions, codex.sessions, codex.resume, codex.resumeHere, newTab, resumeClaude, openLayout, saveTabAsLayout, openAdminTab, resumeClaudeHere, pendingAgentEvents, paneLabel, history, namedWorkspaces, openNamedWorkspace, changeNamedWorkspaces, projects, focusedProject, split, devLinks, ports, registry, switchShell]);

  claudeStatusRef.current = claudeStatus;
  // Recent output is only an activity hint; silence never proves the agent idle.
  const claudeFeatures = Boolean(config?.claudeSessions || config?.claudeAlerts);
  useEffect(() => {
    if (!claudeFeatures) {
      setClaudeStatus(new Map());
      setClaudeObservations(new Map());
      return;
    }
    let disposed = false;
    const poll = async () => {
      try {
        if (disposed) return;
        const now = Date.now();
        const next = new Map<PaneId, AgentStatus>();
        const observed = new Map<PaneId, AgentObservation>();
        for (const paneId of Object.keys(workspaceRef.current.panes)) {
          const session = registry.sessionOf(paneId);
          if(session===undefined)continue;
          const environment=registry.environmentOf(paneId),native=nativeAgentContext(environment,registry.shellKindOf(paneId));
          const evidence=processEvidence(processSnapshot.get(session),environment,"claude",claudeEvents.current.has(paneId)||paneSessions.current.has(paneId),claudeStatusRef.current.has(paneId),registry.atEmptyPrompt(paneId),native||environment?.startsWith("wsl:")===true,now);
          if(!evidence.track)continue;
          const event = withProcessEvidence(resolveObservation(claudeEvents.current.get(paneId), registry.submissionRevision(paneId), registry.lastOutput(paneId), now, CLAUDE_BUSY_MS),evidence);
          next.set(paneId, event.state); observed.set(paneId, event);
        }
        for (const id of claudeEvents.current.keys()) if (!next.has(id)) claudeEvents.current.delete(id);
        setClaudeStatus((current) => (sameStatus(current, next) ? current : next));
        setClaudeObservations(observed);
      } catch {
        if (!disposed) {
          setClaudeStatus((current) => new Map([...current.keys()].map((id) => [id, "unknown"])));
          setClaudeObservations((current) => new Map([...current].map(([id, value]) => [id, { ...value, state: "unknown", reason: "Process scan failed; last observation retained." }])));
        }
      }
    };
    void poll();
    return () => { disposed = true; };
  }, [claudeFeatures, registry,processSnapshot]);

  // A pane's last reply and cache countdown go when Claude Code isn't running there any more.
  useEffect(() => {
    const keep = <V,>(current: ReadonlyMap<PaneId, V>) =>
      [...current.keys()].every((id) => claudeStatus.has(id)) ? current : new Map([...current].filter(([id]) => claudeStatus.has(id)));
    setReplies(keep);
    setCaches(keep);
  }, [claudeStatus]);

  // Token use of the Claude sessions running in panes, re-read every few seconds.
  useEffect(() => {
    if (claudeStatus.size === 0) {
      setClaudeUsages((current) => (current.size ? new Map() : current));
      return;
    }
    const poll = async () => {
      const next = new Map<PaneId, ClaudeUsage>();
      for (const paneId of claudeStatus.keys()) {
        const sessionAtStart = paneSessions.current.get(paneId);
        const known = sessionAtStart?.transcriptPath ?? undefined;
        const cwd = known ? undefined : workspaceRef.current.panes[paneId]?.cwd;
        const native=nativeAgentContext(registry.environmentOf(paneId),registry.shellKindOf(paneId));
        const usage = mergeUsage(native?((await claudeUsage(known, cwd).catch(() => null)) ?? undefined):undefined, statuslines.current.get(paneId));
        if (!workspaceRef.current.panes[paneId] || paneSessions.current.get(paneId)?.sessionId !== sessionAtStart?.sessionId) continue;
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
          const codexPane = codex.status.has(tab.focusedPane) ? tab.focusedPane : ids.find((id) => codex.status.has(id));
          const codexStatuses = ids.map((id) => codex.status.get(id));
          // The focused pane's session if it runs one, else the tab's first.
          const usage = claudeUsages.get(tab.focusedPane) ?? ids.map((id) => claudeUsages.get(id)).find(Boolean);
          const claudePane = claudeStatus.has(tab.focusedPane) ? tab.focusedPane : ids.find((id) => claudeStatus.has(id));
          return [
            tab.id,
            {
              activity: ids.some((id) => activity.has(id)),
              bell: ids.some((id) => bells.has(id)),
              zoomed: Boolean(tab.zoomed),
              broadcast: Boolean(tab.broadcast),
              claude: tabAgentStatus(statuses),
              codex: tabAgentStatus(codexStatuses),
              claudeObservation: ids.map((id) => claudeObservations.get(id)).find((o) => o?.state === tabAgentStatus(statuses)),
              codexObservation: ids.map((id) => codex.observations.get(id)).find((o) => o?.state === tabAgentStatus(codexStatuses)),
              codexUsage: codexPane ? codex.usages.get(codexPane) : undefined,
              codexReply: codexPane ? codex.replies.get(codexPane) : undefined,
              claudeUsage: usage,
              claudeReply: claudePane ? replies.get(claudePane) : undefined,
              claudeCache: claudePane ? caches.get(claudePane) : undefined,
              git: projects.get(tab.focusedPane)?.git ?? undefined,
              devLinks: [...new Set(ids.flatMap((id) => (devLinks.get(id) ?? []).map((link) => link.url)))],
            },
          ] as const;
        }),
      ),
    [workspace.tabs, workspace.panes, activity, bells, claudeStatus, claudeObservations, claudeUsages, codex.status, codex.observations, codex.usages, codex.replies, replies, caches, projects, devLinks],
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
          const event = pendingAgentEvents.find((e) => e.provider === "claude" && e.paneId === paneId);
          return event ? [{ paneId, label: paneLabel(paneId), message: event.message, reply: replies.get(paneId) }] : [];
        }),
    [workspace.tabs, pendingAgentEvents, paneLabel, replies],
  );
  /** Claude sessions running now, for the ✳ menu. */
  const runningClaude = useMemo(
    () =>
      [...claudeStatus].map(([paneId, state]) => ({ paneId, label: paneLabel(paneId), usage: claudeUsages.get(paneId), state, observation: claudeObservations.get(paneId) })),
    [claudeStatus, claudeObservations, claudeUsages, paneLabel, workspace.tabs],
  );
  const attentionTabs = useMemo(
    () =>
      new Map(
        workspace.tabs.flatMap((tab) => {
          const ids = paneIds(tab.root);
          const event = tab.id !== workspace.activeTab ? inbox.snapshot.events.find((e) => e.runId === inbox.snapshot.runId && e.viewedAt === null && e.resolvedAt === null && ids.includes(e.paneId)) : undefined;
          const alert = event ? { paneId: event.paneId, sessionId: event.sessionId, title: event.title, message: event.message, kind: event.provider === "codex" ? `codex:${event.kind}` : event.kind === "failure" ? "stop_failure" : event.kind === "completed" ? "agent_completed" : event.kind } : ids.map((id) => attention.get(id)).find(Boolean);
          return alert ? [[tab.id, alert] as const] : [];
        }),
      ),
    [workspace.tabs, workspace.activeTab, attention, inbox.snapshot],
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
      onClaudeSessionStart((session) => {
        if (!workspaceRef.current.panes[session.paneId]) return;
        if (paneSessions.current.get(session.paneId)?.sessionId !== session.sessionId) {
          setReplies((current) => without(current, session.paneId));
          setCaches((current) => without(current, session.paneId));
          setClaudeUsages((current) => without(current, session.paneId));
          statuslines.current.delete(session.paneId);
        }
        paneSessions.current.set(session.paneId, session);
        claudeEvents.current.set(session.paneId, hookObservation("unknown", "SessionStart", registry.submissionRevision(session.paneId), session.sessionId));
      }),
      onClaudeStatusline((line) => onStatusline.current(line)),
      onClaudeReply((reply) => onReply.current(reply)),
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
      setWorkspace((ws) => focusPane(ws, paneId));
      registry.focus(paneId);
      void pasteFiles(paneId,drag.paths).catch(e=>setNotice(`Could not paste the files: ${e}`));
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
      if (config.codexRestore) {
        for (const pane of Object.values(restored.panes)) {
          if (pane.codexSession) startupInput.current.set(pane.id, `codex --no-daemon resume ${pane.codexSession}\r`);
        }
      }
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
    await persistence.run("Saved output", async () => {
      for (const paneId of Object.keys(workspaceRef.current.panes)) registry.clearHistory(paneId);
      await deleteScrollback();
      lastScrollbackSave.current.clear();
    });
  }, [registry, persistence]);
  const configRef = useRef(config);
  configRef.current = config;
  const lastScrollbackSave = useRef(new Map<PaneId, number>());
  const saveScrollbacks = useCallback(() => persistence.run("Saved output", async () => {
    const cfg = configRef.current;
    if (!cfg || startup.current !== "done") return;
    const keep: PaneId[] = [];
    const snapshots: OutputSnapshot[] = [];
    for (const pane of Object.values(workspaceRef.current.panes)) {
      if (!cfg.restoreSession || !keepsOutput(cfg, pane.profileId)) continue;
      const worth = registry.worthSaving(pane.id);
      // Nothing but prompts: no file, and an older one is pruned below.
      if (worth === false) continue;
      keep.push(pane.id);
      // Not started yet (a restored tab not shown so far): its file stays as it is.
      if (worth === undefined) continue;
      const revision = registry.outputRevision(pane.id);
      const changed = revision > (lastScrollbackSave.current.get(pane.id) ?? 0);
      const text = changed ? registry.serialize(pane.id, cfg.scrollback.lines) : undefined;
      if (text === undefined) continue;
      snapshots.push({ paneId: pane.id, revision, text });
    }
    await persistOutput(snapshots, lastScrollbackSave.current, saveScrollback, () => pruneScrollback(keep));
    for (const id of lastScrollbackSave.current.keys()) if (!keep.includes(id)) lastScrollbackSave.current.delete(id);
  }), [registry, persistence]);
  useEffect(() => {
    const timer = window.setInterval(() => void saveScrollbacks().catch(() => {}), SCROLLBACK_SAVE_MS);
    return () => window.clearInterval(timer);
  }, [saveScrollbacks]);
  // Hiding the console is a natural moment to save; quitting is the last one.
  useEffect(() => {
    if (!shown) void saveScrollbacks().catch(() => {});
  }, [shown, saveScrollbacks]);
  // Save the layout shortly after it changes (shell titles alone don't count).
  const codexByPaneRef = useRef(codex.byPane);
  codexByPaneRef.current = codex.byPane;
  const claudeByPaneRef = useRef(claudeByPane);
  claudeByPaneRef.current = claudeByPane;
  /** Writes the tabs now if they changed since the last save. */
  const flushSession = useCallback(async () => {
    const ws = workspaceRef.current;
    if (startup.current !== "done" || ws.tabs.length === 0) return;
    const text = saveWorkspace(ws, claudeByPaneRef.current, codexByPaneRef.current);
    await persistence.save("Workspace", text, saveSession);
  }, [persistence]);
  useEffect(() => {
    const timer = window.setTimeout(() => void flushSession().catch(() => {}), SAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [workspace, claudeByPane, codex.byPane, flushSession]);


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
    if (historyLoaded.current) await persistence.save("Recent commands", JSON.stringify(historyRef.current), saveHistory);
  }, [persistence]);
  useEffect(() => {
    if (!historyLoaded.current) return;
    const timer = window.setTimeout(() => void flushHistory().catch(() => {}), SAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [history, flushHistory]);

  const retrySaves = useCallback(async () => {
    await Promise.allSettled([flushSession(), saveScrollbacks(), flushHistory(), inbox.flush(), records.flush(), worktrees.flush(), library.flush()]);
  }, [flushSession, saveScrollbacks, flushHistory, inbox.flush, records.flush, worktrees.flush, library.flush]);
  useEffect(() => {
    if (saveErrors.size === 0) return;
    const timer = window.setInterval(() => void retrySaves(), SAVE_RETRY_MS);
    return () => window.clearInterval(timer);
  }, [saveErrors.size, retrySaves]);

  /** Saves tabs and output like quitting does, then installs; qterm exits and restarts. */
  const updateNow = useCallback(async () => {
    await Promise.all([flushSession(), saveScrollbacks(), flushHistory(), inbox.flush(), records.flush(), worktrees.flush(), library.flush()]);
    await installUpdate();
  }, [flushSession, saveScrollbacks, flushHistory, inbox.flush, records.flush, worktrees.flush, library.flush]);
  const [updateError, setUpdateError] = useState<string>();

  // Quitting right after a change (a cd, a new tab) must not lose it to the save delay.
  useEffect(() => {
    const unlisten = onQuitRequested(() => void Promise.all([flushSession(), saveScrollbacks(), flushHistory(), inbox.flush(), records.flush(), worktrees.flush(), library.flush()])
      .then(() => quitNow())
      .catch(() => {
        setQuitSaveFailed(true);
        setNotice("Could not save before quitting. Retry saving, then quit again, or choose Quit without saving.");
      }));
    return () => void unlisten.then((fn) => fn());
  }, [saveScrollbacks, flushSession, flushHistory, inbox.flush, records.flush, worktrees.flush, library.flush]);

  // Re-parenting a terminal (zoom, split, swap) drops its keyboard focus, so focus
  // again whenever the active tab's layout changes, not only the focused pane.
  const activeLayout = useMemo(() => {
    const tab = activeTab(workspace);
    return tab ? `${tab.id}|${tab.zoomed ?? ""}|${JSON.stringify(tab.root)}` : "";
  }, [workspace]);
  useEffect(() => {
    if (shown && focusedPane && !search && !settingsOpen && !paletteOpen && !jsonView && !pasteConfirm && !portDialog && !shellPicker && !handoff && !inboxOpen && !problemsOpen && !verificationRun && !worktreesOpen && !agentAccessOpen && !recipesOpen && !libraryOpen && !sessionHandoff) registry.focus(focusedPane);
  }, [registry, shown, focusedPane, activeLayout, search, settingsOpen, paletteOpen, jsonView, pasteConfirm, portDialog, shellPicker, handoff, inboxOpen, problemsOpen, verificationRun, worktreesOpen, agentAccessOpen, recipesOpen, libraryOpen, sessionHandoff]);

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

  /** Tabs whose panes run more than one kind of shell: there, each pane names its own. */
  const mixedTabs = useMemo(
    () => new Set(workspace.tabs.filter((tab) => new Set(paneIds(tab.root).map((id) => workspace.panes[id]?.profileId)).size > 1).map((tab) => tab.id)),
    [workspace.tabs, workspace.panes],
  );
  const paneBadge = useCallback(
    (pane: Pane): PaneBadge | undefined => {
      const profile = profiles?.find((p) => p.id === pane.profileId);
      return {
        name: profile?.name ?? pane.profileName,
        color: profile?.tabColor ? TAB_COLOR_VALUES[profile.tabColor] : undefined,
        title: `${profile?.name ?? pane.profileName}${pane.cwd ? ` in ${pane.cwd}` : ""}`,
      };
    },
    [profiles],
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
              badge={mixedTabs.has(tab.id) ? paneBadge : undefined}
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
        {helpOpen && (
          <HelpSheet overrides={config?.keybindings ?? {}} hotkey={hotkeyLabel(config?.hotkey ?? "Backquote")} onClose={() => setHelpOpen(false)} />
        )}
        {whatsNew && <WhatsNew version={whatsNew.version} from={whatsNew.from} onClose={() => setWhatsNew(undefined)} />}
        {quickSelect && <QuickSelectOverlay items={quickSelect.items} typed={quickTyped} />}
        {savingWorkspace && (
          <SaveWorkspaceDialog
            existing={namedWorkspaces.map((w) => w.name)}
            onSave={saveNamedWorkspace}
            onClose={() => setSavingWorkspace(false)}
          />
        )}
      {confirmClose && (
        <ConfirmClose
          what={confirmClose.what}
          programs={confirmClose.programs}
          error={confirmClose.error}
          verb={confirmClose.verb}
          onClose={() => {
            setConfirmClose(undefined);
            confirmClose.close();
          }}
          onCancel={() => setConfirmClose(undefined)}
        />
      )}
      {pasteConfirm && (
        <ConfirmPaste
          text={pasteConfirm.text}
          onPaste={() => {
            setPasteConfirm(undefined);
            registry.pasteText(pasteConfirm.paneId, pasteConfirm.text);
          }}
          onCancel={() => setPasteConfirm(undefined)}
        />
      )}
      {portDialog && (() => {
        const owner = portDialog;
        const paneId = owner.sessionId === null ? undefined : Object.keys(workspace.panes).find((id) => registry.sessionOf(id) === owner.sessionId);
        return (
          <PortDialog
            owner={owner}
            paneLabel={paneId ? paneLabel(paneId) : undefined}
            onGoToPane={
              paneId
                ? () => {
                    setPortDialog(undefined);
                    setWorkspace((ws) => focusPane(ws, paneId));
                  }
                : undefined
            }
            onEnd={() => {
              setPortDialog(undefined);
              endPort(owner);
            }}
            onCancel={() => setPortDialog(undefined)}
          />
        );
      })()}
      {shellPicker && profiles && workspace.panes[shellPicker.paneId] && (
        <ShellPicker
          title={shellPicker.dir ? `Split ${shellPicker.dir === "row" ? "right" : "down"} with` : "Switch this pane to"}
          profiles={profiles}
          current={workspace.panes[shellPicker.paneId].profileId}
          onPick={(profile) =>
            shellPicker.dir ? split(shellPicker.paneId, shellPicker.dir, { profileId: profile.id }) : switchShell(shellPicker.paneId, profile.id)
          }
          onClose={() => setShellPicker(undefined)}
        />
      )}
      {jsonView && (
        <JsonViewer value={jsonView.value} source={jsonView.source} onCopy={(text) => writeText(text)} onClose={() => setJsonView(undefined)} />
      )}
      {handoff && <HandoffDialog context={handoff.context} sourceProfileId={handoff.sourceProfileId}
        profiles={(profiles ?? []).filter((profile) => profileSupportsEnvironment(handoff.environment,profile) && !startFolder(handoff.context.cwd,{id:handoff.sourceProfileId,kind:handoff.shellKind,environment:handoff.environment},profile).lost)}
        onSend={sendHandoff} onCancel={() => setHandoff(undefined)} />}
      {inboxOpen && <AgentInbox snapshot={inbox.snapshot} error={inbox.error}
        paneLabels={new Map(Object.keys(workspace.panes).map((id) => [id, paneLabel(id)]))}
        onAction={inbox.act} onClose={() => setInboxOpen(false)}
        onGo={(id) => { if (workspaceRef.current.panes[id]) setWorkspace((ws) => focusPane(ws, id)); setInboxOpen(false); }} />}
      {libraryOpen && <SessionLibrary wslSources={config?.wslSources??[]} snapshot={library.snapshot} pins={library.pins} error={library.error} enabled={{claude:!!config?.claudeSessions,codex:!!config?.codexSessions}}
        onLoad={library.load} onPin={library.pin} onPinsAction={library.act} onResume={resumeLibraryEntry} onHandoff={entry=>{setLibraryOpen(false);setSessionHandoff(entry);}} onClose={()=>setLibraryOpen(false)}/>}
      {sessionHandoff && <SessionHandoffDialog source={sessionHandoff} enabled={sourceEnabled(sessionHandoff,config)}
        onValidate={async()=>{await resolveLibrarySession(sessionHandoff.key,sessionHandoff.sourceVersion,false);if(!sourceEnabled(sessionHandoff,configRef.current))throw new Error("Source settings changed; review the source again.");}}
        profiles={(profiles??[]).filter(p=>profileSupportsEnvironment(sessionHandoff.environment,p))} checks={commandRuns} onSend={sendSessionHandoff} onClose={()=>{setSessionHandoff(undefined);setLibraryOpen(true);}}/>}
      {agentAccessOpen && <AgentAccessPanel cwd={focusedPane ? workspace.panes[focusedPane]?.cwd : undefined} snapshot={agentAccess.snapshot} error={agentAccess.error ?? agentPaneError}
        profiles={(profiles ?? []).filter((p) => p.kind !== "other")} environment={focusedPane ? registry.environmentOf(focusedPane)??workspace.panes[focusedPane]?.environment : undefined} profileId={focusedPane ? workspace.panes[focusedPane]?.profileId : undefined} recordedIds={new Set(commandRuns.map((r) => r.id))}
        onGrant={agentAccess.grant} onRevoke={agentAccess.revoke} onClose={() => setAgentAccessOpen(false)} onStop={stopRequestedTask}
        onGo={(paneId) => { if (workspaceRef.current.panes[paneId]) { setWorkspace((ws) => focusPane(ws, paneId)); setAgentAccessOpen(false); } else setNotice("That task pane is closed."); }}
        onInspect={(job) => { setProblemRunId(job.id); setAgentAccessOpen(false); setProblemsOpen(true); }} />}
      {recipesOpen && <RecipePanel cwd={focusedPane?workspace.panes[focusedPane]?.cwd:undefined} profileId={focusedPane?workspace.panes[focusedPane]?.profileId:undefined}
        profiles={(profiles??[]).filter(p=>p.kind!=="other")} runs={recipes.runs} error={recipes.error} recordedIds={new Set(commandRuns.map(r=>r.id))}
        onLaunch={launchReviewedRecipe} onCancel={recipes.cancel} onStop={recipes.stop} onClose={()=>setRecipesOpen(false)}
        onGo={pane=>{if(workspaceRef.current.panes[pane]){setWorkspace(ws=>focusPane(ws,pane));setRecipesOpen(false);}else setNotice("That workflow pane is closed.");}}
        onInspect={id=>{setProblemRunId(id);setRecipesOpen(false);setProblemsOpen(true);}}/>}
      {worktreesOpen && <WorktreePanel cwd={focusedPane ? workspace.panes[focusedPane]?.cwd : undefined} profileId={focusedPane ? workspace.panes[focusedPane]?.profileId : undefined}
        environment={focusedPane?(registry.environmentOf(focusedPane)??workspace.panes[focusedPane]?.environment):undefined}
        profiles={(profiles ?? []).filter((p) => p.kind !== "other")} snapshot={worktrees.snapshot} saveError={worktrees.error} runs={commandRuns}
        onCreate={worktrees.create} onAction={worktrees.action} onOpen={openWorktree} onClose={() => setWorktreesOpen(false)}
        onInspect={(run) => { setProblemRunId(run.id); setWorktreesOpen(false); setProblemsOpen(true); }} />}
      {problemsOpen && <ProblemsPanel runs={commandRuns} initialRunId={problemRunId}
        snapshot={records.snapshot} saveError={records.error} comparisonError={records.refreshError} onAction={records.act} onRefresh={records.refresh}
        onVerify={(run) => { setProblemsOpen(false); setVerificationRun(run); }}
        paneLabels={new Map(Object.keys(workspace.panes).map((id) => [id, paneLabel(id)]))}
        onOpen={async (run: CommandRun, diagnostic: Diagnostic) => {
          if (!diagnostic.file) throw new Error("This diagnostic has no source location.");
          const [file] = await resolveFiles([diagnostic.file], run.cwd,run.profileId,run.environment??(run.shellKind==="wsl"?undefined:"native"));
          if (!file) throw new Error(`Source file no longer exists: ${diagnostic.file}`);
          await openInEditor(file, diagnostic.line, diagnostic.col);
        }} onClose={() => { setProblemsOpen(false); setProblemRunId(undefined); }}
        onGo={(id) => { if (workspaceRef.current.panes[id]) setWorkspace((ws) => focusPane(ws, id)); setProblemsOpen(false); }} />}
      {verificationRun && <VerifyDialog run={verificationRun} shell={profiles?.find((p) => p.id === verificationRun.profileId)?.name ?? "original shell"}
        onRun={runVerification} onClose={() => { setVerificationRun(undefined); setProblemsOpen(true); }} />}
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
          onAskAgent={() => showHandoff(blockMenu.paneId, blockMenu.block)}
          onSelectOutput={() => {
            if (!registry.selectBlock(blockMenu.paneId, blockMenu.block.id)) setNotice("That output is no longer in the scrollback.");
            registry.focus(blockMenu.paneId);
          }}
          onRunAgain={() => {
            registry.focus(blockMenu.paneId);
            registry.typeSnippet(blockMenu.paneId, blockMenu.block.command, true);
          }}
          onViewJson={() => {
            const value = findJson(registry.blockOutput(blockMenu.paneId, blockMenu.block.id));
            if (value === undefined) setNotice("That command's output isn't JSON.");
            else setJsonView({ value, source: blockMenu.block.command });
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
          shell={profiles?.find((p) => p.id === workspace.panes[paneMenu.paneId].profileId)?.name ?? workspace.panes[paneMenu.paneId].profileName}
          onSwitchShell={() => setShellPicker({ paneId: paneMenu.paneId })}
          onClose={() => setPaneMenu(undefined)}
        />
      )}
      {searchAllOpen && (
        <SearchAllPanel search={searchAllPanes} paneLabel={paneLabel} onPick={revealHit} onClose={() => setSearchAllOpen(false)} />
      )}
        {settingsOpen && settings && profiles && (
          <SettingsPanel
            paneLabel={(id) => workspace.panes[id] ? paneLabel(id) : undefined}
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
      {welcome && (
        <div className="app-notice" role="status" aria-label="Welcome">
          Welcome to qterm. {hotkeyLabel(config?.hotkey ?? "Backquote")} shows and hides it, Ctrl+Shift+P finds anything.
          <button
            onClick={() => {
              setWelcome(false);
              setHelpOpen(true);
            }}
          >
            Shortcuts and tips
          </button>
          <button className="icon-button" aria-label="Dismiss" onClick={() => setWelcome(false)}>
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
      {saveErrors.size > 0 && (
        <div className="app-notice persistence-error" role="alert" aria-label="Save problem">
          <span><strong>Changes could not be saved.</strong> Retrying automatically.
            {[...saveErrors].map(([store, error]) => <span key={store}> {store}: {error}</span>)}
          </span>
          <button onClick={() => void retrySaves()}>Retry saving</button>
          {quitSaveFailed && <button onClick={() => void quitNow().catch((e) => setNotice(`Could not quit: ${e}`))}>Quit without saving</button>}
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
        problemCount={latestRuns(commandRuns).reduce((n, run) => n + run.diagnostics.items.filter((d) => d.severity === "error").length, 0)}
        onOpenProblems={() => { setProblemRunId(undefined); setProblemsOpen(true); }}
        onOpenWorktrees={() => setWorktreesOpen(true)}
        onOpenAgentAccess={() => setAgentAccessOpen(true)}
        onOpenRecipes={()=>setRecipesOpen(true)}
        onOpenSessionLibrary={()=>setLibraryOpen(true)}
        inboxOpenCount={inbox.snapshot.events.filter((e) => e.resolvedAt === null).length}
        inboxUnreadCount={inbox.snapshot.events.filter((e) => e.viewedAt === null).length}
        onOpenInbox={() => setInboxOpen(true)}
        workspace={workspace}
        profiles={profiles ?? []}
        codex={config?.codexSessions ? codex.menu : undefined}
        claude={
          config?.claudeSessions
            ? {
                sessions: claudeSessions,
                onResume: resumeClaude,
                onResumeHere: resumeClaudeHere,
                onForget: (references) => void forgetClaudeSessions(references).catch(error=>setNotice(`Could not forget Claude sessions: ${error}`)),
                onNewSession: newClaudeSession,
                running: runningClaude,
                waiting: waitingClaude,
                plan: planText,
                onFocusPane: (paneId: PaneId) => setWorkspace((ws) => focusPane(ws, paneId)),
              }
            : undefined
        }
        onActivate={(tabId) => setWorkspace((ws) => activateTab(ws, tabId))}
        onClose={requestCloseTab}
        onNewTab={(profileId) => newTab(profileId)}
        onSplit={(dir) => focusedPane && split(focusedPane, dir)}
        onSplitWith={(profileId, dir) => focusedPane && split(focusedPane, dir, { profileId })}
        onRename={(tabId, title) => setWorkspace((ws) => renameTab(ws, tabId, title))}
        onStyle={(tabId, style) => setWorkspace((ws) => setTabStyle(ws, tabId, style))}
        onMove={(tabId, toIndex) => setWorkspace((ws) => moveTab(ws, tabId, toIndex))}
        onOpenSettings={() => setSettingsOpen((open) => !open)}
        onOpenLink={(url) => void openUrl(url).catch((e) => setNotice(`Could not open it: ${e}`))}
        pinned={pinned}
        onTogglePin={togglePin}
        onHelp={() => setHelpOpen((open) => !open)}
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

/** A dev server's address, printed in a pane at `at`. */
interface DevLink {
  url: string;
  port: number;
  at: number;
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
