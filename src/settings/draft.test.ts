import { describe, expect, it } from "vitest";

import type { Config } from "../ipc";
import { changes, keepsScrollback, overrides, toDraft, withShellScrollback } from "./draft";

const config: Config = {
  hotkey: "Backquote",
  height: 0.5,
  width: 1,
  monitor: "cursor",
  opacity: 0.82,
  backgroundEffect: "none",
  slideMs: 150,
  hideOnBlur: false,
  defaultProfile: "",
  theme: "qterm",
  copyOnSelect: false,
  rightClickPaste: true,
  restoreSession: true,
  shellIntegration: true,
  claudeSessions: false,
  claudeAlerts: true,
  claudeRestore: false,
  codexSessions: false,
  codexAlerts: true,
  codexRestore: false,
  editor: "code --goto {file}:{line}:{col}",
  longCommandAlert: 30,
  inlineImages: true,
  sshProfiles: true,
  checkUpdates: true,
  explorerMenu: false,
  pasteWarning: true,
  font: { family: "Cascadia Mono", size: 14, ligatures: false },
  keybindings: {},
  profiles: [],
  layouts: [],
  snippets: [],
  triggers: [],
  scrollback: { restore: true, lines: 1000, profiles: {} },
};

describe("settings draft", () => {
  it("saves explicit WSL source choices without inventing opt-in or mutating the loaded settings",()=>{
    const draft=toDraft(config);expect(draft.wslSources).toEqual([]);draft.wslSources.push({distribution:"Ubuntu",enabled:false,claudeHome:"/isolated/claude",codexHome:""});
    expect(changes(config,draft)).toEqual({wsl_sources:[{distribution:"Ubuntu",enabled:false,claude_home:"/isolated/claude",codex_home:""}]});expect(config.wslSources).toBeUndefined();
    const loaded={...config,wslSources:draft.wslSources};expect(changes(loaded,toDraft(loaded))).toEqual({});
  });
  it("has nothing to save when untouched", () => {
    expect(changes(config, toDraft(config))).toEqual({});
  });

  it("sends changed settings under their config.toml names", () => {
    const draft = { ...toDraft(config), height: 0.4, slideMs: 0, claudeSessions: true, fontSize: 16, theme: "nord" };
    expect(changes(config, draft)).toEqual({
      height: 0.4,
      slide_ms: 0,
      claude_sessions: true,
      "font.size": 16,
      theme: "nord",
    });
  });

  it("shows overridden chords and saves only those that differ from the defaults", () => {
    const withOverride = { ...config, keybindings: { new_tab: "ctrl+t" } };
    const draft = toDraft(withOverride);
    expect(draft.chords.new_tab).toBe("ctrl+t");
    expect(draft.chords.find).toBe("ctrl+shift+f");

    draft.chords.find = "F3";
    draft.chords.new_tab = "Ctrl + Shift + T"; // back to the default, differently spelled
    expect(changes(withOverride, draft)).toEqual({ keybindings: { find: "F3" } });
  });

  it("keeps an unbound action as an empty override", () => {
    const draft = toDraft(config);
    draft.chords.equalize = "";
    expect(overrides(draft)).toEqual({ equalize: "" });
  });
});

describe("scrollback per shell", () => {
  it("follows the general switch unless a shell says otherwise", () => {
    const draft = toDraft({ ...config, scrollback: { restore: true, lines: 1000, profiles: { cmd: false } } });
    expect(keepsScrollback(draft, "pwsh")).toBe(true);
    expect(keepsScrollback(draft, "cmd")).toBe(false);
  });

  it("stores only exceptions and saves them as one table", () => {
    const draft = toDraft(config);
    draft.scrollbackProfiles = withShellScrollback(draft, "wsl:Ubuntu", false);
    expect(draft.scrollbackProfiles).toEqual({ "wsl:Ubuntu": false });
    draft.scrollbackProfiles = withShellScrollback(draft, "wsl:Ubuntu", true);
    expect(draft.scrollbackProfiles).toEqual({});

    draft.scrollbackProfiles = { cmd: false };
    draft.scrollbackLines = 500;
    expect(changes(config, draft)).toEqual({ "scrollback.lines": 500, "scrollback.profiles": { cmd: false } });
  });
});
