// Typed wrappers for every Rust command and event. The only module that calls invoke/listen.
import { Channel, invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type SessionId = number;

export interface Profile {
  id: string;
  name: string;
}

/** Mirrors config.toml (see src-tauri/src/config/default.toml), in camelCase. */
export interface Config {
  hotkey: string;
  height: number;
  width: number;
  monitor: "cursor" | "primary";
  opacity: number;
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
  editor: string;
  font: { family: string; size: number };
  keybindings: Record<string, string>;
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
): Promise<SessionId> {
  // Raw byte batches arrive as ArrayBuffer (tauri::ipc::Response on the Rust side).
  const channel = new Channel<ArrayBuffer>();
  channel.onmessage = (chunk) => onOutput(new Uint8Array(chunk));
  return invoke("pty_spawn", { request: { paneId, profileId, cwd, cols, rows }, onOutput: channel });
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

export function onPtyExit(handler: (exit: PtyExit) => void): Promise<UnlistenFn> {
  return listen<PtyExit>("pty-exit", (event) => handler(event.payload));
}

export function onQuakeVisibility(handler: (change: QuakeVisibility) => void): Promise<UnlistenFn> {
  return listen<QuakeVisibility>("quake-visibility", (event) => handler(event.payload));
}
