// The settings panel edits a flat draft; saving sends only what changed, keyed by
// the names used in config.toml.
import type { Config } from "../ipc";
import { ACTION_LIST } from "../keybindings";

export interface Draft {
  hotkey: string;
  height: number;
  width: number;
  monitor: Config["monitor"];
  opacity: number;
  backgroundEffect: Config["backgroundEffect"];
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
  longCommandAlert: number;
  inlineImages: boolean;
  sshProfiles: boolean;
  checkUpdates: boolean;
  fontFamily: string;
  fontSize: number;
  fontLigatures: boolean;
  scrollbackRestore: boolean;
  scrollbackLines: number;
  /** Per-shell switches that differ from scrollbackRestore. */
  scrollbackProfiles: Record<string, boolean>;
  /** Effective chord per action; "" means unbound. */
  chords: Record<string, string>;
}

/** Draft field → config.toml key, for everything except the shortcuts. */
const TOML_KEYS: Record<Exclude<keyof Draft, "chords" | "scrollbackProfiles">, string> = {
  hotkey: "hotkey",
  height: "height",
  width: "width",
  monitor: "monitor",
  opacity: "opacity",
  backgroundEffect: "background_effect",
  slideMs: "slide_ms",
  hideOnBlur: "hide_on_blur",
  defaultProfile: "default_profile",
  theme: "theme",
  copyOnSelect: "copy_on_select",
  rightClickPaste: "right_click_paste",
  restoreSession: "restore_session",
  shellIntegration: "shell_integration",
  claudeSessions: "claude_sessions",
  claudeAlerts: "claude_alerts",
  claudeRestore: "claude_restore",
  editor: "editor",
  longCommandAlert: "long_command_alert",
  inlineImages: "inline_images",
  sshProfiles: "ssh_profiles",
  checkUpdates: "check_updates",
  fontFamily: "font.family",
  fontSize: "font.size",
  fontLigatures: "font.ligatures",
  scrollbackRestore: "scrollback.restore",
  scrollbackLines: "scrollback.lines",
};

export function toDraft(config: Config): Draft {
  return {
    hotkey: config.hotkey,
    height: config.height,
    width: config.width,
    monitor: config.monitor,
    opacity: config.opacity,
    backgroundEffect: config.backgroundEffect,
    slideMs: config.slideMs,
    hideOnBlur: config.hideOnBlur,
    defaultProfile: config.defaultProfile,
    theme: config.theme,
    copyOnSelect: config.copyOnSelect,
    rightClickPaste: config.rightClickPaste,
    restoreSession: config.restoreSession,
    shellIntegration: config.shellIntegration,
    claudeSessions: config.claudeSessions,
    claudeAlerts: config.claudeAlerts,
    claudeRestore: config.claudeRestore,
    editor: config.editor,
    longCommandAlert: config.longCommandAlert,
    inlineImages: config.inlineImages,
    sshProfiles: config.sshProfiles,
    checkUpdates: config.checkUpdates,
    fontFamily: config.font.family,
    fontSize: config.font.size,
    fontLigatures: config.font.ligatures,
    scrollbackRestore: config.scrollback.restore,
    scrollbackLines: config.scrollback.lines,
    scrollbackProfiles: { ...config.scrollback.profiles },
    chords: Object.fromEntries(ACTION_LIST.map((a) => [a.name, config.keybindings[a.name] ?? a.defaultChord])),
  };
}

/** The [keybindings] table for a draft: only chords that differ from the defaults. */
export function overrides(draft: Draft): Record<string, string> {
  return Object.fromEntries(
    ACTION_LIST.filter((a) => normalize(draft.chords[a.name] ?? "") !== normalize(a.defaultChord)).map((a) => [
      a.name,
      draft.chords[a.name]?.trim() ?? "",
    ]),
  );
}

/** What to write: changed settings by TOML key, plus the whole [keybindings] table if it changed. */
export function changes(config: Config, draft: Draft): Record<string, unknown> {
  const original = toDraft(config);
  const out: Record<string, unknown> = {};
  for (const [field, key] of Object.entries(TOML_KEYS) as [keyof typeof TOML_KEYS, string][]) {
    if (draft[field] !== original[field]) out[key] = draft[field];
  }
  const wanted = overrides(draft);
  if (!sameTable(wanted, config.keybindings)) out.keybindings = wanted;
  if (!sameTable(draft.scrollbackProfiles, config.scrollback.profiles)) out["scrollback.profiles"] = draft.scrollbackProfiles;
  return out;
}

/** Whether a shell keeps its output across restarts under this draft. */
export function keepsScrollback(draft: Draft, profileId: string): boolean {
  return draft.scrollbackProfiles[profileId] ?? draft.scrollbackRestore;
}

/** Switches one shell; a value equal to the general setting needs no entry. */
export function withShellScrollback(draft: Draft, profileId: string, on: boolean): Record<string, boolean> {
  const next = { ...draft.scrollbackProfiles };
  if (on === draft.scrollbackRestore) delete next[profileId];
  else next[profileId] = on;
  return next;
}

function normalize(chord: string): string {
  // "" (unbound) and whitespace mean the same.
  return chord.toLowerCase().replace(/\s+/g, "");
}

function sameTable<V>(a: Record<string, V>, b: Record<string, V>): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((k) => b[k] === a[k]);
}
