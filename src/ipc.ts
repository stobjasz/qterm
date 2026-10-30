// Typed wrappers for every Rust command and event. The only module that calls invoke/listen.
import { Channel, invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";

import type { LayoutDef } from "./workspace/layouts";
import type { TabColor } from "./workspace/workspace";
import type { TriggerDef } from "./terminal/triggers";

export type SessionId = number;

/** Which shell a profile runs; decides how dropped file paths are written. */
export type ShellKind = "powershell" | "cmd" | "bash" | "wsl" | "other";

export interface Profile {
  distribution?: string | null;
  id: string;
  name: string;
  kind: ShellKind;
  /** Custom profiles may bring their own look. */
  theme?: string;
  fontSize?: number;
  /** Marks its tabs ([[profiles]] tab_color / icon). */
  tabColor?: TabColor;
  icon?: string;
  /** Its panes' background colour ("#rrggbb"). */
  background?: string;
}

/** A [[profiles]] entry as written in config.toml. */
export interface CustomProfile {
  id: string | null;
  name: string;
  command: string;
  cwd: string | null;
  env: Record<string, string>;
  theme: string | null;
  fontSize: number | null;
  tabColor: TabColor | null;
  icon: string | null;
  background: string | null;
}

/** Mirrors config.toml (see src-tauri/src/config/default.toml), in camelCase. */
export interface Config {
  hotkey: string;
  height: number;
  width: number;
  monitor: "cursor" | "primary";
  opacity: number;
  backgroundEffect: "none" | "acrylic" | "mica";
  slideMs: number;
  hideOnBlur: boolean;
  defaultProfile: string;
  theme: string;
  copyOnSelect: boolean;
  rightClickPaste: boolean;
  restoreSession: boolean;
  shellIntegration: boolean;
  claudeSessions: boolean;
  claudeAlerts: boolean;
  claudeRestore: boolean;
  codexSessions: boolean;
  codexAlerts: boolean;
  codexRestore: boolean;
  wslSources?:WslSource[];
  editor: string;
  /** Seconds; 0 = off. */
  longCommandAlert: number;
  inlineImages: boolean;
  sshProfiles: boolean;
  checkUpdates: boolean;
  explorerMenu: boolean;
  /** Ask before pasting several lines into a shell. */
  pasteWarning: boolean;
  font: { family: string; size: number; ligatures: boolean };
  keybindings: Record<string, string>;
  profiles: CustomProfile[];
  layouts: LayoutDef[];
  snippets: Snippet[];
  triggers: TriggerDef[];
  scrollback: {
    /** For shells not listed in `profiles`. */
    restore: boolean;
    lines: number;
    /** Profile id → on/off. */
    profiles: Record<string, boolean>;
  };
}

export interface WslSource{distribution:string;enabled:boolean;claudeHome:string;codexHome:string}

/** A [[snippets]] entry: a named command for the current pane. */
export interface Snippet {
  name: string;
  command: string;
  /** Press Enter after typing it. */
  run: boolean;
}

/** The config in effect, plus why the file on disk was rejected if it was. */
export interface ConfigSnapshot {
  config: Config;
  error: string | null;
  path: string;
  /** The folder of your choice the settings live in, if any (Settings → Settings file). */
  folder: string | null;
}

export interface PtyExit {
  id: SessionId;
  code: number;
}

export interface QuakeVisibility {
  visible: boolean;
  slideMs: number;
}

export function getConfig(): Promise<ConfigSnapshot> {
  return invoke("get_config");
}

export function onConfigChanged(handler: (snapshot: ConfigSnapshot) => void): Promise<UnlistenFn> {
  return listen<ConfigSnapshot>("config-changed", (event) => handler(event.payload));
}

export function listProfiles(): Promise<Profile[]> {
  return invoke("list_profiles");
}

export function ptySpawn(
  paneId: string,
  profileId: string,
  cols: number,
  rows: number,
  cwd: string | undefined,
  onOutput: (data: Uint8Array) => void,
  elevated = false,
  expectedEnvironment?: string,
  expectedKind?:ShellKind,
): Promise<SessionId> {
  // Raw byte batches arrive as ArrayBuffer (tauri::ipc::Response on the Rust side).
  const channel = new Channel<ArrayBuffer>();
  channel.onmessage = (chunk) => onOutput(new Uint8Array(chunk));
  return invoke("pty_spawn", { request: { paneId, profileId, cwd, cols, rows, elevated,expectedEnvironment,expectedKind }, onOutput: channel });
}

export function ptyWrite(id: SessionId, data: string): Promise<void> {
  return invoke("pty_write", { id, data });
}

export function wslTranslatePaths(distribution:string,paths:string[],toLinux:boolean):Promise<string[]>{return invoke("wsl_translate_paths",{distribution,paths,toLinux});}

/** Tells Rust that xterm.js has processed `bytes` of output (flow control). */
export function ptyAck(id: SessionId, bytes: number): Promise<void> {
  return invoke("pty_ack", { id, bytes });
}

export function ptyResize(id: SessionId, cols: number, rows: number): Promise<void> {
  return invoke("pty_resize", { id, cols, rows });
}

export function ptyKill(id: SessionId): Promise<void> {
  return invoke("pty_kill", { id });
}

/** The UI is listening; on a normal launch Rust shows the console now. */
export function uiReady(): Promise<void> {
  return invoke("ui_ready");
}

export function hideWindow(): Promise<void> {
  return invoke("hide_window");
}

export function loadSession(): Promise<string | null> {
  return invoke("load_session");
}

export function saveSession(session: string): Promise<void> {
  return invoke("save_session", { session });
}

export interface ClaudeSession {
  environment?:string|null;
  id: string;
  /** Where to resume; null when neither the transcript nor the pane knew. */
  cwd: string | null;
  title: string | null;
  profileId: string;
  /** Unix milliseconds. */
  seenAt: number;
}

export function listClaudeSessions(): Promise<ClaudeSession[]> {
  return invoke("list_claude_sessions");
}

export function claudeSessionSeen(id: string, profileId: string, paneCwd: string | undefined,environment?:string): Promise<ClaudeSession[]> {
  return invoke("claude_session_seen", { id, profileId, paneCwd,environment });
}

export interface SessionReference {id:string;environment:string}
export function forgetClaudeSessions(references: SessionReference[]): Promise<ClaudeSession[]> {
  return invoke("forget_claude_sessions", { references });
}

export function onClaudeSessionsChanged(handler: (sessions: ClaudeSession[]) => void): Promise<UnlistenFn> {
  return listen<ClaudeSession[]>("claude-sessions-changed", (event) => handler(event.payload));
}

/** Settings panel: TOML keys ("height", "font.size", "keybindings") to new values. */
export function saveConfig(changes: Record<string, unknown>): Promise<void> {
  return invoke("save_config", { changes });
}

export function openConfigFile(): Promise<void> {
  return invoke("open_config_file");
}

const SETTINGS_FILTER = [{ name: "qterm settings", extensions: ["toml"] }];

/** Asks where to save, then copies config.toml there. False when cancelled. */
export async function exportSettings(): Promise<boolean> {
  const path = await saveDialog({ title: "Export qterm settings", defaultPath: "qterm-settings.toml", filters: SETTINGS_FILTER });
  if (!path) return false;
  await invoke("export_settings", { path });
  return true;
}

/** Asks for a settings file, then replaces config.toml with it if valid. False when cancelled. */
export async function importSettings(): Promise<boolean> {
  const path = await openDialog({ title: "Import qterm settings", multiple: false, directory: false, filters: SETTINGS_FILTER });
  if (!path) return false;
  await invoke("import_settings", { path });
  return true;
}

export function getAutostart(): Promise<boolean> {
  return invoke("get_autostart");
}

export function setAutostart(enabled: boolean): Promise<void> {
  return invoke("set_autostart", { enabled });
}

/** The tray asked for the settings panel. */
export function onOpenSettings(handler: () => void): Promise<UnlistenFn> {
  return listen("open-settings", () => handler());
}

/** Resizes the console to `height` CSS pixels while its bottom edge is dragged; returns the share. */
export function resizeConsole(height: number): Promise<number> {
  return invoke("resize_console", { height });
}

/** Saves the console height (share of the work area) as the `height` setting. */
export function saveConsoleHeight(share: number): Promise<void> {
  return invoke("save_console_height", { share });
}

/** Absolute paths of the candidates that exist (relative ones against `cwd`), else null. */
export function resolveFiles(paths: string[], cwd: string | undefined,profileId?:string|null,environment?:string|null): Promise<(string | null)[]> {
  return invoke("resolve_files", { paths, cwd,profileId,environment });
}

/** Opens a file at a line with the configured editor. */
export function openInEditor(file: string, line?: number, col?: number): Promise<void> {
  return invoke("open_in_editor", { file, line, col });
}

/** Claude Code in a pane is waiting for the user (its Notification hook fired). */
export interface ClaudeAlert {
  paneId: string;
  title: string | null;
  message: string;
  /** e.g. "permission_prompt", "idle_prompt". */
  kind: string | null;
  sessionId: string | null;
}

export function onClaudeAttention(handler: (alert: ClaudeAlert) => void): Promise<UnlistenFn> {
  return listen<ClaudeAlert>("claude-attention", (event) => handler(event.payload));
}

/** Windows notification for an alert; clicking it brings the console up on that pane. */
export function showClaudeAlert(alert: ClaudeAlert): Promise<void> {
  return invoke("show_claude_alert", { alert });
}

export function setAttentionCount(count: number): Promise<void> {
  return invoke("set_attention_count", { count });
}

/** A notification was clicked: switch to this pane. */
export function onFocusPane(handler: (paneId: string) => void): Promise<UnlistenFn> {
  return listen<string>("focus-pane", (event) => handler(event.payload));
}

export interface HookStatus {
  installed: boolean;
  /** Installed and pointing at this qterm exe. */
  current: boolean;
  settingsPath: string;
}

export type AgentProvider = "claude" | "codex";
export interface RepositorySnapshot { root: string; head: string | null; branch: string | null; digest: string; files: number; bytes: number; capturedAt: number }
export interface VerificationEvidence {
  before: RepositorySnapshot; after: RepositorySnapshot | null; eligible: boolean; changedDuringRun: boolean;
  status: "matches" | "stale" | "unknown"; reason: string; checkedAt: number;
}
export interface RecordedCommandRun {
  environment?:string|null;
  requester?: AgentRequester | null;
  id: string; paneId: string; profileId?: string | null; cwd?: string | null; command: string;
  shellKind?: ShellKind | null; appRunId?: string | null;
  commandTruncated?: boolean;
  exitCode?: number | null; startedAt: number; finishedAt: number; output: string; outputTruncated: boolean;
  verification?: VerificationEvidence | null;
}
export interface CommandRunsSnapshot { runId: string; revision: number; runs: RecordedCommandRun[]; error: string | null; recoveryRequired: boolean; backupPath: string | null }
export type CommandRunsAction = "retry" | "resetSaved" | "clear";
export const commandRunsSnapshot = (): Promise<CommandRunsSnapshot> => invoke("command_runs_snapshot");
export const recordCommandRun = (run: RecordedCommandRun, ticket?: string): Promise<CommandRunsSnapshot> => invoke("record_command_run", { run, ticket });
export const commandRunsAction = (action: CommandRunsAction): Promise<CommandRunsSnapshot> => invoke("command_runs_action", { action });
export const prepareVerification = (cwd: string, command: string): Promise<{ id: string; before: RepositorySnapshot }> => invoke("prepare_verification", { cwd, command });
export const cancelVerification = (ticket: string): Promise<void> => invoke("cancel_verification", { ticket });
export const refreshVerification = (): Promise<CommandRunsSnapshot> => invoke("refresh_verification");
export const onCommandRunsChanged = (handler: (snapshot: CommandRunsSnapshot) => void): Promise<UnlistenFn> => listen<CommandRunsSnapshot>("command-runs-changed", (event) => handler(event.payload));
export interface AgentInboxEvent {
  id: string; provider: AgentProvider; paneId: string; sessionId: string | null; cwd: string | null;
  kind: "approval" | "permission" | "input" | "completed" | "failure"; title: string; message: string;
  createdAt: number; updatedAt: number; viewedAt: number | null; resolvedAt: number | null;
  resolution: string | null; repeats: number; runId: string;
}
export interface AgentInboxSnapshot {
  revision: number; runId: string; events: AgentInboxEvent[]; error: string | null;
  recoveryRequired: boolean; backupPath: string | null;
}
export type AgentInboxAction = "view" | "resolve" | "reopen" | "clearResolved" | "retry" | "resetSaved";
export const agentInboxSnapshot = (): Promise<AgentInboxSnapshot> => invoke("agent_inbox_snapshot");
export const agentInboxAction = (action: AgentInboxAction, ids: string[] = []): Promise<AgentInboxSnapshot> => invoke("agent_inbox_action", { action, ids });
export const onAgentInboxChanged = (handler: (value: AgentInboxSnapshot) => void): Promise<UnlistenFn> => listen<AgentInboxSnapshot>("agent-inbox-changed", (event) => handler(event.payload));
export const createAgentBrief = (text: string): Promise<{ path: string }> => invoke("create_agent_brief", { text });
export interface AgentIntegrationHealth {
  provider: AgentProvider;
  home: string | null;
  executable: string;
  inbox: string | null;
  lastEvent: { event: string; paneId: string; sessionId: string | null; receivedAt: number } | null;
  lastProbe: { checkedAt: number; success: boolean; error: string | null } | null;
}
export const agentIntegrationHealth = (provider: AgentProvider): Promise<AgentIntegrationHealth> => invoke("agent_integration_health", { provider });
export const testAgentDelivery = (provider: AgentProvider): Promise<AgentIntegrationHealth> => invoke("test_agent_delivery", { provider });

export function claudeHookStatus(): Promise<HookStatus> {
  return invoke("claude_hook_status");
}

export function installClaudeHook(): Promise<HookStatus> {
  return invoke("install_claude_hook");
}

export function removeClaudeHook(): Promise<HookStatus> {
  return invoke("remove_claude_hook");
}

/** Saves (or replaces by name) a [[layouts]] entry. */
export function saveLayout(layout: LayoutDef): Promise<void> {
  return invoke("save_layout", { layout });
}

export function deleteLayout(name: string): Promise<void> {
  return invoke("delete_layout", { name });
}

/** A Claude Code transcript, for the "All sessions" view. */
export interface TranscriptSummary {
  id: string;
  cwd: string | null;
  title: string | null;
  gitBranch: string | null;
  /** Messages the user typed. */
  prompts: number;
  lastPrompt: string | null;
  /** Unix milliseconds. */
  modified: number;
}

export function listAllClaudeSessions(): Promise<TranscriptSummary[]> {
  return invoke("list_all_claude_sessions");
}

/** Token use of a Claude Code session (see src-tauri/src/claude_usage.rs). */
export interface ClaudeUsage {
  sessionId: string;
  model: string | null;
  /** What the latest request sent: how full the context is. */
  contextTokens: number;
  contextLimit: number | null;
  /** At API list prices; null until a request of a known model was seen. */
  costUsd: number | null;
  costComplete: boolean;
  outputTokens: number;
  requests: number;
  /** Claude Code's title for the session, else its first prompt. */
  title: string | null;
}

/** From the session's transcript if known, else the newest transcript of `cwd`. */
export function claudeUsage(transcript: string | undefined, cwd: string | undefined): Promise<ClaudeUsage | null> {
  return invoke("claude_usage", { transcript: transcript ?? null, cwd: cwd ?? null });
}

/** Claude Code started, resumed or cleared a session in a pane (its SessionStart hook). */
export interface PaneClaudeSession {
  paneId: string;
  sessionId: string;
  transcriptPath: string | null;
}

/** Claude finished a turn in a pane (its Stop hook): what it said last. */
export interface ClaudeReply {
  paneId: string;
  sessionId: string | null;
  message: string;
}

export function onClaudeReply(handler: (reply: ClaudeReply) => void): Promise<UnlistenFn> {
  return listen<ClaudeReply>("claude-reply", (event) => handler(event.payload));
}

export function onClaudeSessionStart(handler: (session: PaneClaudeSession) => void): Promise<UnlistenFn> {
  return listen<PaneClaudeSession>("claude-session-start", (event) => handler(event.payload));
}

/** How Windows' sudo is set up; administrator tabs need "inline". */
export type SudoMode = "missing" | "disabled" | "newWindow" | "inputClosed" | "inline";

export function sudoStatus(): Promise<SudoMode> {
  return invoke("sudo_status");
}

export function openSudoSettings(): Promise<void> {
  return invoke("open_sudo_settings");
}

/** Opens a shell as administrator in its own window (UAC prompt), outside qterm. */
export function openElevatedWindow(profileId: string, cwd: string | undefined): Promise<void> {
  return invoke("open_elevated_window", { profileId, cwd: cwd ?? null });
}

/** Programs running in these sessions' shells ("node.exe"), each once. */
export function runningPrograms(ids: SessionId[]): Promise<string[]> {
  return invoke("running_programs", { ids });
}

/** Ends what runs in the session's shell (and everything it started), keeping the shell; the programs that ended. */
export function stopPrograms(id: SessionId): Promise<string[]> {
  return invoke("stop_programs", { id });
}

export interface GitStatus {
  /** The branch, or the commit when detached. */
  branch: string;
  /** Null without an upstream. */
  ahead: number | null;
  behind: number | null;
  changed: number;
  untracked: number;
}

/** A script from the project's manifests, e.g. "pnpm run dev" from package.json. */
export interface ProjectTask {
  name: string;
  command: string;
  source: string;
}

/** The project's .qterm.toml. */
export interface ProjectSettings {
  path: string;
  name: string | null;
  tabColor: string | null;
  icon: string | null;
  snippets: Snippet[];
  triggers: TriggerDef[];
}

/** What a folder's project says (see src-tauri/src/project.rs). */
export interface ProjectInfo {
  git: GitStatus | null;
  /** The scripts of the nearest folder that has any, and that folder. */
  tasks: { dir: string; tasks: ProjectTask[] } | null;
  settings: ProjectSettings | null;
  /** Why the .qterm.toml found isn't used. */
  settingsError: string | null;
}

export function projectInfo(cwd: string,profileId?:string,environment?:string): Promise<ProjectInfo> {
  return invoke("project_info", { cwd,profileId,environment });
}
export const wslDistributions=():Promise<string[]>=>invoke("wsl_distributions");
export const createWslAgentBrief=(distribution:string,text:string):Promise<{path:string;distribution:string}>=>invoke("create_wsl_agent_brief",{distribution,text});
export const validateWslFolder=(distribution:string,cwd:string):Promise<string>=>invoke("validate_wsl_folder",{distribution,cwd});

export interface WorktreeTask {
  id: string; title: string; request: string; repository: string; commonDir: string;
  directory: string; branch: string; base: string; commit: string;
  provider: AgentProvider | "shell"; profileId: string; createdAt: number;
  status: "creating" | "active" | "completed" | "failed"; error: string | null;
}
export interface WorktreeDraft {
  cwd: string; title: string; request: string; branch: string; base: string;
  directory: string; provider: AgentProvider | "shell"; profileId: string;
}
export interface WorktreePreview { token: string; task: WorktreeTask; sourceDirty: boolean }
export interface WorktreeSnapshot { tasks: WorktreeTask[]; revision: number; error: string | null; recoveryRequired: boolean; backupPath: string | null }
export interface WorktreeDetails { branch: string; head: string; changed: number; untracked: number; commits: string; summary: string; summaryTruncated: boolean }
export const worktreeTasksSnapshot = () => invoke<WorktreeSnapshot>("worktree_tasks_snapshot");
export const previewWorktreeTask = (draft: WorktreeDraft) => invoke<WorktreePreview>("preview_worktree_task", { draft });
export const cancelWorktreePreview = (token: string) => invoke<void>("cancel_worktree_preview", { token });
export const createWorktreeTask = (token: string) => invoke<WorktreeSnapshot>("create_worktree_task", { token });
export const worktreeTaskAction = (action: "retry" | "recover" | "complete" | "reopen", taskId?: string) => invoke<WorktreeSnapshot>("worktree_task_action", { action, taskId });
export const worktreeTaskDetails = (taskId: string) => invoke<WorktreeDetails>("worktree_task_details", { taskId });
export const onWorktreeTasksChanged = (fn: (value: WorktreeSnapshot) => void) => listen<WorktreeSnapshot>("worktree-tasks-changed", (event) => fn(event.payload));

export interface GrantedTask { id: string; name: string; command: string; source: string; directory: string; manifestDigest: string }
export interface ExecutionPolicy { profileId: string; profileName: string; tasks: GrantedTask[]; manifests: { path: string; digest: string; preview: string; truncated: boolean }[] }
export interface AgentRequester { client: string; grantId: string; taskId: string; taskName: string; requestId: string }
export interface AgentInvocation { id: string; requester: AgentRequester; project: string; task: GrantedTask; profileId: string; state: string; paneId: string | null; queuedAt: number; startedAt: number | null; finishedAt: number | null; exitCode: number | null; error: string | null; evidenceWarning: string | null }
export interface AgentAccessReview { id: string; project: string; execution: ExecutionPolicy | null }
export interface AgentGrant { id: string; client: string; project: string; connectionFile: string; createdAt: number; tasks: GrantedTask[]; profileId: string | null }
export interface AgentAccessSnapshot { grants: AgentGrant[]; listening: boolean; revision: number; executable: string; invocations: AgentInvocation[] }
export interface AgentPane { id: string; cwd: string | null; label: string; profileId: string; kind: string }
export const agentAccessSnapshot = () => invoke<AgentAccessSnapshot>("agent_access_snapshot");
export const reviewAgentAccess = (cwd: string, profileId?: string) => invoke<AgentAccessReview>("review_agent_access", { cwd, profileId });
export const cancelAgentAccessReview = (id: string) => invoke<void>("cancel_agent_access_review", { id });
export const grantAgentAccess = (review: string, client: string, taskIds: string[] = []) => invoke<AgentAccessSnapshot>("grant_agent_access", { review, client, taskIds });
export const revokeAgentAccess = (id: string) => invoke<AgentAccessSnapshot>("revoke_agent_access", { id });
export const publishAgentPanes = (panes: AgentPane[]) => invoke<void>("publish_agent_panes", { panes });
export const onAgentAccessChanged = (fn: (value: AgentAccessSnapshot) => void) => listen<AgentAccessSnapshot>("agent-access-changed", (event) => fn(event.payload));
export const onAgentTaskQueued = (fn: (id: string) => void) => listen<string>("agent-task-queued", (event) => fn(event.payload));
export const claimAgentTask = (id: string, paneId: string) => invoke<AgentInvocation>("claim_agent_task", { id, paneId });
export const launchAgentTask = (id: string, paneId: string, session: number, cwd: string) => invoke<AgentInvocation>("launch_agent_task", { id, paneId, session, cwd });
export const failAgentTask = (id: string, message: string) => invoke<void>("fail_agent_task", { id, message });
export const stopAgentTask = (id: string) => invoke<void>("stop_agent_task", { id });

/** A listening TCP port and the process holding it (see src-tauri/src/ports.rs). */
export interface PortOwner {
  port: number;
  pid: number;
  /** "node.exe"; "" when Windows won't say. */
  process: string;
  addresses: string[];
  /** The pane session whose shell it runs under, if it's one of qterm's. */
  sessionId: SessionId | null;
}

export function listeningPorts(): Promise<PortOwner[]> {
  return invoke("listening_ports");
}

/** Ends the process on `port` (if `pid` still holds it) and what it started; the programs that ended. */
export function endPortOwner(port: number, pid: number): Promise<string[]> {
  return invoke("end_port_owner", { port, pid });
}

/** The image on the clipboard saved as a PNG file; null when there is none. */
export function clipboardImageFile(): Promise<string | null> {
  return invoke("clipboard_image_file");
}

/** The console fills the screen's work area, or goes back to its size; true when full. */
export function toggleConsoleSize(): Promise<boolean> {
  return invoke("toggle_console_size");
}

/** Sessions with Claude Code running inside their shell. */
export function claudeRunning(): Promise<SessionId[]> {
  return invoke("claude_running");
}

/** A pane's serialized output, kept across restarts. */
export function saveScrollback(paneId: string, text: string): Promise<void> {
  return invoke("save_scrollback", { paneId, text });
}

export function loadScrollback(paneId: string): Promise<string | null> {
  return invoke("load_scrollback", { paneId });
}

/** Deletes the saved output of these panes, or of every pane. */
export function deleteScrollback(paneIds?: string[]): Promise<void> {
  return invoke("delete_scrollback", { paneIds: paneIds ?? null });
}

export interface ScrollbackUsage {
  panes: number;
  bytes: number;
}

export function scrollbackUsage(): Promise<ScrollbackUsage> {
  return invoke("scrollback_usage");
}

/** Deletes saved output of every pane not in `keep`. */
export function pruneScrollback(keep: string[]): Promise<void> {
  return invoke("prune_scrollback", { keep });
}

export interface AppInfo {
  version: string;
  /** The portable exe (replaces itself on update), not an installed copy. */
  portable: boolean;
}

export function appInfo(): Promise<AppInfo> {
  return invoke("app_info");
}

export interface UpdateInfo {
  version: string;
  currentVersion: string;
  notes: string | null;
}

/** Asks GitHub Releases for a newer version; null when this one is current. */
export function checkUpdate(): Promise<UpdateInfo | null> {
  return invoke("check_update");
}

/** Downloads, verifies and installs the update, then qterm restarts. Save tabs and output first. */
export function installUpdate(): Promise<void> {
  return invoke("install_update");
}

/** Tray → "Check for updates…" (Settings opens too). */
export function onCheckUpdates(handler: () => void): Promise<UnlistenFn> {
  return listen("check-updates", () => handler());
}

/** The daily check found a newer version. */
export function onUpdateAvailable(handler: (update: UpdateInfo) => void): Promise<UnlistenFn> {
  return listen<UpdateInfo>("update-available", (event) => handler(event.payload));
}

/** The folder qterm was started in from Explorer's menu, once. */
export function takeOpenHere(): Promise<string | null> {
  return invoke("take_open_here");
}

/** Explorer → "Open in qterm" while qterm runs: a new tab in that folder. */
export function onOpenHere(handler: (dir: string) => void): Promise<UnlistenFn> {
  return listen<string>("open-here", (event) => handler(event.payload));
}

/** Recent commands and folders (history.json), as saved by the UI. */
export function loadHistory(): Promise<string | null> {
  return invoke("load_history");
}

export function saveHistory(history: string): Promise<void> {
  return invoke("save_history", { history });
}

const OUTPUT_FILTERS = [
  { name: "Text", extensions: ["txt"] },
  { name: "HTML (with colours)", extensions: ["html"] },
];

/** Asks where to save a pane's output; null when cancelled. */
export function chooseOutputFile(defaultName: string): Promise<string | null> {
  return saveDialog({ title: "Save pane output", defaultPath: defaultName, filters: OUTPUT_FILTERS });
}

/** Writes a pane's output to `path`, or to a new temp file without one; returns the file. */
export function saveOutput(path: string | null, contents: string): Promise<string> {
  return invoke("save_output", { path, contents });
}

/** Named workspaces (workspaces.json). */
export function loadWorkspaces(): Promise<string | null> {
  return invoke("load_workspaces");
}

export function saveWorkspaces(workspaces: string): Promise<void> {
  return invoke("save_workspaces", { workspaces });
}

/** Pinned open: clicking elsewhere and the hotkey don't hide the console. */
export function setPinned(pinned: boolean): Promise<void> {
  return invoke("set_pinned", { pinned });
}

export interface VersionChange {
  from: string;
  to: string;
}

/** qterm's first start on this PC: show the welcome hint. */
export function firstStart(): Promise<boolean> {
  return invoke("first_start");
}

/** The first start after an update, once: the versions before and now. */
export function takeVersionChange(): Promise<VersionChange | null> {
  return invoke("take_version_change");
}

export interface PlanLimit {
  usedPercent: number;
  /** Unix seconds. */
  resetsAt: number | null;
}

/** Claude Code's own figures for the session in a pane (its status line, relayed). */
export interface StatuslineUsage {
  paneId: string;
  sessionId: string | null;
  modelId: string | null;
  modelName: string | null;
  contextTokens: number | null;
  contextLimit: number | null;
  contextPercent: number | null;
  costUsd: number | null;
  fiveHour: PlanLimit | null;
  sevenDay: PlanLimit | null;
  cache: { warm: boolean; expiresAt: number | null } | null;
}

export function onClaudeStatusline(handler: (usage: StatuslineUsage) => void): Promise<UnlistenFn> {
  return listen<StatuslineUsage>("claude-statusline", (event) => handler(event.payload));
}

export interface StatuslineStatus {
  installed: boolean;
  current: boolean;
  /** A status line of the user's own, kept behind qterm's (or replaced by it on setup). */
  ownCommand: string | null;
}

export function claudeStatuslineStatus(): Promise<StatuslineStatus> {
  return invoke("claude_statusline_status");
}

export function installClaudeStatusline(): Promise<StatuslineStatus> {
  return invoke("install_claude_statusline");
}

export function removeClaudeStatusline(): Promise<StatuslineStatus> {
  return invoke("remove_claude_statusline");
}

export function showPlanWarning(title: string, message: string): Promise<void> {
  return invoke("show_plan_warning", { title, message });
}

export function setPlanSummary(summary: string | null): Promise<void> {
  return invoke("set_plan_summary", { summary });
}

/** A Windows Terminal shell qterm doesn't have yet. */
export interface WtProfile {
  name: string;
  command: string;
  cwd: string | null;
  background: string | null;
  tabColor: string | null;
  icon: string | null;
  /** "Windows Terminal", "Visual Studio", ... */
  origin: string;
}

export function windowsTerminalProfiles(): Promise<WtProfile[]> {
  return invoke("windows_terminal_profiles");
}

/** Adds them as [[profiles]] in config.toml. */
export function importWindowsTerminalProfiles(profiles: WtProfile[]): Promise<void> {
  return invoke("import_windows_terminal_profiles", { profiles });
}

/** How the settings moved: copied to the folder, the folder's own taken, or back home. */
export type Relocated = "moved" | "usedExisting" | "default";

/** Asks for a folder to keep the settings in (OneDrive, a dotfiles repo); null when cancelled. */
export async function chooseSettingsFolder(): Promise<string | null> {
  const folder = await openDialog({ title: "Keep qterm's settings in this folder", directory: true });
  return typeof folder === "string" ? folder : null;
}

/** Moves config.toml to `folder` (null: back to the default place); applies at once. */
export function setSettingsFolder(folder: string | null): Promise<Relocated> {
  return invoke("set_settings_folder", { folder });
}

/** Writes a line to qterm's log file. */
export function logUi(message: string): Promise<void> {
  return invoke("log_ui", { message });
}

/** Version, Windows, console host, settings, hotkey and the log's tail, for bug reports. */
export function diagnostics(): Promise<string> {
  return invoke("diagnostics");
}

export function openLogs(): Promise<void> {
  return invoke("open_logs");
}

/** Tray → Quit: save what needs saving, then call quitNow (Rust exits anyway after a grace period). */
export function onQuitRequested(handler: () => void): Promise<UnlistenFn> {
  return listen("quit-requested", () => handler());
}

export function quitNow(): Promise<void> {
  return invoke("quit_now");
}

export function onPtyExit(handler: (exit: PtyExit) => void): Promise<UnlistenFn> {
  return listen<PtyExit>("pty-exit", (event) => handler(event.payload));
}

export function onQuakeVisibility(handler: (change: QuakeVisibility) => void): Promise<UnlistenFn> {
  return listen<QuakeVisibility>("quake-visibility", (event) => handler(event.payload));
}

/** Files dragged from Explorer over the console; positions in CSS pixels of the page. */
export type FileDrag =
  | { type: "over"; x: number; y: number }
  | { type: "drop"; x: number; y: number; paths: string[] }
  | { type: "leave" };

export function onFileDrag(handler: (drag: FileDrag) => void): Promise<UnlistenFn> {
  return getCurrentWebview().onDragDropEvent(({ payload }) => {
    if (payload.type === "leave") return handler({ type: "leave" });
    // Tauri reports physical pixels.
    const x = payload.position.x / window.devicePixelRatio;
    const y = payload.position.y / window.devicePixelRatio;
    handler(payload.type === "drop" ? { type: "drop", x, y, paths: payload.paths } : { type: "over", x, y });
  });
}


export type CodexSession = ClaudeSession;

export interface LibraryIdentity { provider:AgentProvider; environment:string; id:string }
export interface SessionPin extends LibraryIdentity { pinnedAt:number }
export interface SessionPins {pins:SessionPin[];revision:number;error:string|null;recoveryRequired:boolean;backupPath:string|null}
export interface LibraryEntry extends LibraryIdentity {sourceHome?:string|null;sourceVersion?:string|null;sourceConfig?:string|null;launchCwd?:string|null;key:string;cwd:string|null;project:string|null;title:string|null;branch:string|null;lastPrompt:string|null;modified:number|null;seenAt:number|null;profileId:string|null;remembered:boolean;pinned:boolean;available:boolean;availability:string;reason:string|null;observedAt:number|null}
export interface LibrarySource {provider:AgentProvider;environment?:string;home:string|null;observedAt:number|null;errors:string[];truncated:boolean;enabled:boolean}
export interface SessionLibrarySnapshot {sourceRevision?:string;entries:LibraryEntry[];sources:LibrarySource[];pins:SessionPins;truncated:boolean}
export const loadSessionLibrary=(refresh=false):Promise<SessionLibrarySnapshot>=>invoke("load_session_library",{refresh});
export const resolveLibrarySession=(key:string,sourceVersion?:string|null,requireFolder=true):Promise<LibraryEntry>=>invoke("resolve_library_session",{key,sourceVersion,requireFolder});
export const resolveProviderSession=(identity:LibraryIdentity):Promise<LibraryEntry>=>invoke("resolve_provider_session",{identity});
export const sessionPinsSnapshot=():Promise<SessionPins>=>invoke("session_pins_snapshot");
export const pinLibrarySession=(identity:LibraryIdentity,pinned:boolean):Promise<SessionPins>=>invoke("pin_library_session",{identity,pinned});
export const sessionPinsAction=(action:"retry"|"recover"):Promise<SessionPins>=>invoke("session_pins_action",{action});
export const onSessionPinsChanged=(handler:(pins:SessionPins)=>void)=>listen<SessionPins>("session-pins-changed",e=>handler(e.payload));

export type RecipeState = "pending" | "running" | "ready" | "succeeded" | "failed" | "blocked" | "cancelled" | "unknown" | "timed_out" | "stopping" | "exited";
export interface RecipeStep { name:string; command:string; cwd:string; directory:string; dependsOn:string[]; readyOutput:string|null; timeoutSeconds:number }
export interface RecipeDefinition { name:string; layout:"tabs"|"rows"|"columns"; steps:RecipeStep[] }
export interface RecipeReview { id:string; source:string; project:string; digest:string; profileId:string; profileName:string; recipes:RecipeDefinition[] }
export interface RecipeStepRun extends RecipeStep { id:string; paneId:string; state:RecipeState; runnable:boolean; startedAt:number|null; finishedAt:number|null; exitCode:number|null; error:string|null; evidenceWarning:string|null }
export interface RecipeRun { id:string; reviewId:string; name:string; layout:RecipeDefinition["layout"]; project:string; profileId:string; createdAt:number; steps:RecipeStepRun[] }
export const reviewRecipes=(cwd:string,profileId:string):Promise<RecipeReview>=>invoke("review_recipes",{cwd,profileId});
export const cancelRecipeReview=(id:string):Promise<void>=>invoke("cancel_recipe_review",{id});
export const startRecipe=(reviewId:string,name:string,bindings:Record<string,string>):Promise<RecipeRun>=>invoke("start_recipe",{reviewId,name,bindings});
export const recipeRunsSnapshot=():Promise<RecipeRun[]>=>invoke("recipe_runs_snapshot");
export const onRecipeRunsChanged=(handler:(runs:RecipeRun[])=>void)=>listen<RecipeRun[]>("recipe-runs-changed",e=>handler(e.payload));
export const launchRecipeStep=(id:string,paneId:string,session:number,cwd:string):Promise<RecipeRun>=>invoke("launch_recipe_step",{id,paneId,session,cwd});
export const recipeStepOutput=(observation:{id:string;paneId:string;session:number;sequence:number;text:string}):Promise<void>=>invoke("recipe_step_output",{observation});
export const failRecipeStep=(id:string,message:string):Promise<void>=>invoke("fail_recipe_step",{id,message});
export const cancelRecipeRun=(id:string):Promise<void>=>invoke("cancel_recipe_run",{id});
export const stopRecipeRun=(id:string):Promise<void>=>invoke("stop_recipe_run",{id});
export interface CodexUsage {
  sessionId: string;
  model: string | null;
  contextTokens: number;
  contextLimit: number | null;
  outputTokens: number;
  title: string | null;
  rateLimits: { primary?: CodexLimit | null; secondary?: CodexLimit | null } | null;
}
export interface CodexLimit { used_percent: number; window_minutes?: number; resets_at?: number }
export interface CodexActivity { paneId: string; sessionId: string | null; busy: boolean }
export const listCodexSessions = (): Promise<CodexSession[]> => invoke("list_codex_sessions");
export const listAllCodexSessions = (): Promise<TranscriptSummary[]> => invoke("list_all_codex_sessions");
export interface CodexScan {
  home: string;
  sessionsPath: string;
  sessions: TranscriptSummary[];
  diagnostics: { filesScanned: number; unrecognizedFiles: number; missingSessionsFolder: boolean; errors: string[] };
}
export const scanCodexSessions = (): Promise<CodexScan> => invoke("scan_codex_sessions");
export const codexUsageMany = (ids: string[]): Promise<CodexUsage[]> => invoke("codex_usage_many", { ids });
export const codexSessionSeen = (id: string, profileId: string, paneCwd?: string,environment?:string): Promise<CodexSession[]> => invoke("codex_session_seen", { id, profileId, paneCwd,environment });
export const forgetCodexSessions = (references: SessionReference[]): Promise<CodexSession[]> => invoke("forget_codex_sessions", { references });
export const codexRunning = (): Promise<SessionId[]> => invoke("codex_running");
export const codexUsage = (id: string): Promise<CodexUsage | null> => invoke("codex_usage", { id });
export const codexHookStatus = (): Promise<HookStatus> => invoke("codex_hook_status");
export const installCodexHook = (): Promise<HookStatus> => invoke("install_codex_hook");
export const removeCodexHook = (): Promise<HookStatus> => invoke("remove_codex_hook");
export const onCodexSessionsChanged = (handler: (sessions: CodexSession[]) => void) => listen<CodexSession[]>("codex-sessions-changed", (e) => handler(e.payload));
export const onCodexSessionStart = (handler: (session: PaneClaudeSession) => void) => listen<PaneClaudeSession>("codex-session-start", (e) => handler(e.payload));
export const onCodexAttention = (handler: (alert: ClaudeAlert) => void) => listen<ClaudeAlert>("codex-attention", (e) => handler(e.payload));
export const onCodexReply = (handler: (reply: ClaudeReply) => void) => listen<ClaudeReply>("codex-reply", (e) => handler(e.payload));
export const onCodexActivity = (handler: (activity: CodexActivity) => void) => listen<CodexActivity>("codex-activity", (e) => handler(e.payload));

export const setCodexPlanSummary = (summary: string | null): Promise<void> => invoke("set_codex_plan_summary", { summary });
