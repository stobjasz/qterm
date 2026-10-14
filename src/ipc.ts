// Typed wrappers for every Rust command and event. The only module that calls invoke/listen.
import { Channel, invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";

import type { LayoutDef } from "./workspace/layouts";
import type { TabColor } from "./workspace/workspace";

export type SessionId = number;

/** Which shell a profile runs; decides how dropped file paths are written. */
export type ShellKind = "powershell" | "cmd" | "bash" | "wsl" | "other";

export interface Profile {
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
  editor: string;
  /** Seconds; 0 = off. */
  longCommandAlert: number;
  inlineImages: boolean;
  sshProfiles: boolean;
  checkUpdates: boolean;
  explorerMenu: boolean;
  font: { family: string; size: number; ligatures: boolean };
  keybindings: Record<string, string>;
  profiles: CustomProfile[];
  layouts: LayoutDef[];
  snippets: Snippet[];
  scrollback: {
    /** For shells not listed in `profiles`. */
    restore: boolean;
    lines: number;
    /** Profile id → on/off. */
    profiles: Record<string, boolean>;
  };
}

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
): Promise<SessionId> {
  // Raw byte batches arrive as ArrayBuffer (tauri::ipc::Response on the Rust side).
  const channel = new Channel<ArrayBuffer>();
  channel.onmessage = (chunk) => onOutput(new Uint8Array(chunk));
  return invoke("pty_spawn", { request: { paneId, profileId, cwd, cols, rows, elevated }, onOutput: channel });
}

export function ptyWrite(id: SessionId, data: string): Promise<void> {
  return invoke("pty_write", { id, data });
}

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

export function claudeSessionSeen(id: string, profileId: string, paneCwd: string | undefined): Promise<ClaudeSession[]> {
  return invoke("claude_session_seen", { id, profileId, paneCwd });
}

export function forgetClaudeSessions(ids: string[]): Promise<ClaudeSession[]> {
  return invoke("forget_claude_sessions", { ids });
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
export function resolveFiles(paths: string[], cwd: string | undefined): Promise<(string | null)[]> {
  return invoke("resolve_files", { paths, cwd });
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
