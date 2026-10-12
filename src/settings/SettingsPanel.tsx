import { useEffect, useMemo, useState, type ReactNode } from "react";

import {
  appInfo,
  checkUpdate,
  claudeHookStatus,
  exportSettings,
  importSettings,
  getAutostart,
  installClaudeHook,
  openConfigFile,
  removeClaudeHook,
  openSudoSettings,
  sudoStatus,
  type SudoMode,
  scrollbackUsage,
  saveConfig,
  setAutostart,
  type ConfigSnapshot,
  type HookStatus,
  type Profile,
  type ScrollbackUsage,
  type AppInfo,
  type UpdateInfo,
} from "../ipc";
import { ACTION_LIST, buildKeymap } from "../keybindings";
import { THEMES } from "../terminal/themes";
import { changes, keepsScrollback, overrides, toDraft, withShellScrollback, type Draft } from "./draft";

const HOTKEYS: [string, string][] = [
  ["Backquote", "~ (the key left of 1)"],
  ["ScrollLock", "Scroll Lock"],
  ["Pause", "Pause"],
  ["Insert", "Insert"],
  ...Array.from({ length: 12 }, (_, i): [string, string] => [`F${i + 13}`, `F${i + 13}`]),
];

interface Props {
  snapshot: ConfigSnapshot;
  profiles: Profile[];
  onClose(): void;
  /** Deletes all saved output and clears the open panes' history. */
  onClearHistory(): Promise<void>;
  /** The newer version found so far, if any. */
  update: UpdateInfo | undefined;
  onUpdateFound(update: UpdateInfo | undefined): void;
  /** Saves tabs and output, then installs the update; qterm restarts. */
  onInstallUpdate(): Promise<void>;
  /** Goes up on each tray → Check for updates…; the panel checks then. */
  checkRequest: number;
}

/** Edits config.toml without touching the file by hand. Esc closes without saving. */
export function SettingsPanel({ snapshot, profiles, onClose, onClearHistory, update, onUpdateFound, onInstallUpdate, checkRequest }: Props) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(snapshot.config));
  const [autostart, setAutostartState] = useState<boolean>();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [hook, setHook] = useState<HookStatus>();
  const [usage, setUsage] = useState<ScrollbackUsage>();
  const [sudo, setSudo] = useState<SudoMode>();
  useEffect(() => void sudoStatus().then(setSudo, () => setSudo("missing")), []);
  const [confirmClear, setConfirmClear] = useState(false);
  const refreshUsage = () => void scrollbackUsage().then(setUsage, (e) => setError(String(e)));
  useEffect(refreshUsage, []);
  const clearHistory = () =>
    void onClearHistory().then(() => {
      setConfirmClear(false);
      refreshUsage();
    }, (e) => setError(String(e)));

  const [app, setApp] = useState<AppInfo>();
  useEffect(() => void appInfo().then(setApp), []);
  const [updateStatus, setUpdateStatus] = useState<"checking" | "current" | "installing">();
  const checkNow = () => {
    setUpdateStatus("checking");
    setError(undefined);
    void checkUpdate().then(
      (found) => {
        onUpdateFound(found ?? undefined);
        setUpdateStatus(found ? undefined : "current");
      },
      (e) => {
        setUpdateStatus(undefined);
        setError(String(e));
      },
    );
  };
  // A new request checks (also one made before the panel opened).
  useEffect(() => void (checkRequest > 0 && checkNow()), [checkRequest]);
  const installNow = () => {
    setUpdateStatus("installing");
    setError(undefined);
    onInstallUpdate().catch((e) => {
      setUpdateStatus(undefined);
      setError(String(e));
    });
  };

  useEffect(() => void getAutostart().then(setAutostartState), []);
  useEffect(() => void claudeHookStatus().then(setHook, (e) => setError(String(e))), []);
  const changeHook = (action: () => Promise<HookStatus>) => void action().then(setHook, (e) => setError(String(e)));
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const pending = useMemo(() => changes(snapshot.config, draft), [snapshot.config, draft]);
  const keymapErrors = useMemo(() => buildKeymap(overrides(draft)).errors, [draft]);
  const dirty = Object.keys(pending).length > 0;
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));

  const save = async () => {
    setSaving(true);
    setError(undefined);
    try {
      await saveConfig(pending);
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  const hotkeyOptions = HOTKEYS.some(([key]) => key === draft.hotkey) ? HOTKEYS : [...HOTKEYS, [draft.hotkey, draft.hotkey] as [string, string]];

  return (
    <section className="settings-panel" role="dialog" aria-label="Settings" aria-modal="true">
      <header>
        <h2>Settings</h2>
        <button className="icon-button" aria-label="Close settings" title="Close (Esc)" onClick={onClose}>
          ×
        </button>
      </header>

      <div className="settings-body">
        <Group title="Updates">
          <div className="settings-field">
            <span>
              {app ? `qterm ${app.version}, ${app.portable ? "portable exe" : "installed"}` : "qterm"}
              <span className="settings-hint">
                New versions come from GitHub Releases and are checked against qterm's signing key before they install.
                {app?.portable
                  ? " The portable exe replaces itself and restarts."
                  : " The installer updates qterm in place and restarts it."}{" "}
                Tabs and their output are saved first.
              </span>
            </span>
            <div className="settings-actions">
              {update ? (
                <button className="primary" disabled={updateStatus === "installing"} onClick={installNow}>
                  {updateStatus === "installing" ? "Updating…" : `Update to ${update.version} and restart`}
                </button>
              ) : (
                <button disabled={updateStatus === "checking"} onClick={checkNow}>
                  {updateStatus === "checking" ? "Checking…" : "Check now"}
                </button>
              )}
              {updateStatus === "current" && <span>✓ qterm is up to date</span>}
            </div>
          </div>
          <Toggle
            label="Check for updates automatically"
            hint="Shortly after start and then daily. A newer version is offered here and in the tray; nothing installs by itself."
            checked={draft.checkUpdates}
            onChange={(v) => set("checkUpdates", v)}
          />
        </Group>

        <Group title="Console">
          <Field label="Hotkey" hint="One key that shows and hides qterm. The tray can switch it off.">
            <select value={draft.hotkey} onChange={(e) => set("hotkey", e.target.value)}>
              {hotkeyOptions.map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field label={`Height ${Math.round(draft.height * 100)}%`}>
            <input type="range" min={10} max={100} value={Math.round(draft.height * 100)} onChange={(e) => set("height", Number(e.target.value) / 100)} />
          </Field>
          <Field label={`Width ${Math.round(draft.width * 100)}%`}>
            <input type="range" min={20} max={100} value={Math.round(draft.width * 100)} onChange={(e) => set("width", Number(e.target.value) / 100)} />
          </Field>
          <Field label="Monitor">
            <select value={draft.monitor} onChange={(e) => set("monitor", e.target.value as Draft["monitor"])}>
              <option value="cursor">Where the mouse is</option>
              <option value="primary">Primary monitor</option>
            </select>
          </Field>
          <Field label={`Slide animation ${draft.slideMs} ms`}>
            <input type="range" min={0} max={500} step={10} value={draft.slideMs} onChange={(e) => set("slideMs", Number(e.target.value))} />
          </Field>
          <Toggle label="Hide when another window is clicked" checked={draft.hideOnBlur} onChange={(v) => set("hideOnBlur", v)} />
          <Toggle
            label="Start with Windows"
            hint="Applies right away."
            checked={autostart ?? false}
            disabled={autostart === undefined}
            onChange={(v) => void setAutostart(v).then(() => setAutostartState(v), (e) => setError(String(e)))}
          />
        </Group>

        <Group title="Appearance">
          <Field label="Theme">
            <div className="theme-grid" role="radiogroup" aria-label="Theme">
              {Object.entries(THEMES).map(([name, theme]) => (
                <button
                  key={name}
                  role="radio"
                  aria-checked={draft.theme === name}
                  className="theme-swatch"
                  style={{ background: theme.background, color: theme.foreground, borderColor: theme.accent }}
                  onClick={() => set("theme", name)}
                >
                  <span className="theme-dots" aria-hidden="true">
                    {theme.ansi.slice(1, 7).map((c) => (
                      <i key={c} style={{ background: c }} />
                    ))}
                  </span>
                  {theme.label}
                </button>
              ))}
            </div>
          </Field>
          <Field label={`Background opacity ${Math.round(draft.opacity * 100)}%`}>
            <input type="range" min={0} max={100} value={Math.round(draft.opacity * 100)} onChange={(e) => set("opacity", Number(e.target.value) / 100)} />
          </Field>
          <Field label="Background effect" hint="What shows through the translucent background. Lower the opacity to see more of it.">
            <select value={draft.backgroundEffect} onChange={(e) => set("backgroundEffect", e.target.value as Draft["backgroundEffect"])}>
              <option value="none">None: the windows behind, sharp</option>
              <option value="acrylic">Acrylic: frosted glass</option>
              <option value="mica">Mica: the wallpaper's tint</option>
            </select>
          </Field>
          <Field label="Font">
            <input type="text" value={draft.fontFamily} onChange={(e) => set("fontFamily", e.target.value)} spellCheck={false} />
          </Field>
          <Field label="Font size">
            <input type="number" min={6} max={72} value={draft.fontSize} onChange={(e) => set("fontSize", Number(e.target.value))} />
          </Field>
          <Toggle
            label="Font ligatures (=> != ->)"
            hint="Needs a font that has them, e.g. Cascadia Code or Fira Code; Cascadia Mono has none."
            checked={draft.fontLigatures}
            onChange={(v) => set("fontLigatures", v)}
          />
        </Group>

        <Group title="Terminal">
          <Field label="Shell for new tabs">
            <select value={draft.defaultProfile} onChange={(e) => set("defaultProfile", e.target.value)}>
              <option value="">First found ({profiles[0]?.name ?? "none"})</option>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
          <Toggle
            label="SSH hosts as shells"
            hint="Each Host in your ~/.ssh/config appears as “SSH <host>” in the ▾ menu and the palette."
            checked={draft.sshProfiles}
            onChange={(v) => set("sshProfiles", v)}
          />
          <Toggle label="Copy selected text automatically" checked={draft.copyOnSelect} onChange={(v) => set("copyOnSelect", v)} />
          <Toggle
            label="Right-click copies, or pastes when nothing is selected"
            checked={draft.rightClickPaste}
            onChange={(v) => set("rightClickPaste", v)}
          />
          <Toggle
            label="Show inline images"
            hint="Pictures that programs print as sixel, iTerm or Kitty graphics (chafa, img2sixel, timg)."
            checked={draft.inlineImages}
            onChange={(v) => set("inlineImages", v)}
          />
          <Toggle label="Reopen tabs and layout on start" checked={draft.restoreSession} onChange={(v) => set("restoreSession", v)} />
          <Toggle
            label="Shell integration"
            hint="Shells report their folder, so restored and split panes open where you were. New panes only."
            checked={draft.shellIntegration}
            onChange={(v) => set("shellIntegration", v)}
          />
          <Field
            label="Notify when a long command finishes"
            hint="Seconds a command must run before its end gets a ✓/✗ on the tab and a Windows notification (when you aren't looking at it). 0 = off. Needs shell integration."
          >
            <input
              type="number"
              min={0}
              max={86400}
              step={5}
              value={draft.longCommandAlert}
              onChange={(e) => set("longCommandAlert", Math.max(0, Math.round(Number(e.target.value))))}
            />
          </Field>
          <Field label="Open files with" hint="Ctrl+click a file reference like src/app.ts:42. {file}, {line} and {col} are filled in.">
            <input type="text" value={draft.editor} onChange={(e) => set("editor", e.target.value)} spellCheck={false} />
          </Field>
        </Group>

        <Group title="Scrollback">
          <Toggle
            label="Keep each pane's output across restarts"
            hint="Restored tabs show their earlier output above a “restored” line (needs “Reopen tabs and layout on start”)."
            checked={draft.scrollbackRestore}
            onChange={(v) => set("scrollbackRestore", v)}
          />
          <Field label="Lines kept per pane">
            <input
              type="number"
              min={100}
              max={10000}
              step={100}
              value={draft.scrollbackLines}
              onChange={(e) => set("scrollbackLines", Number(e.target.value))}
            />
          </Field>
          <div className="settings-field">
            <span className="settings-label">Per shell</span>
            {profiles.map((profile) => (
              <Toggle
                key={profile.id}
                label={profile.name}
                checked={keepsScrollback(draft, profile.id)}
                onChange={(on) => set("scrollbackProfiles", withShellScrollback(draft, profile.id, on))}
              />
            ))}
          </div>
          <div className="settings-field">
            <span className="settings-label">Saved output</span>
            <span className="settings-hint">
              Clearing deletes the saved files and the history of every open pane (like “Clear buffer”). To clear one
              pane, use “Clear pane history” in the command palette.
            </span>
            <div className="settings-actions">
              <span>{usage === undefined ? "Checking…" : usage.panes === 0 ? "Nothing saved" : `${usage.panes} ${usage.panes === 1 ? "pane" : "panes"}, ${formatBytes(usage.bytes)}`}</span>
              {confirmClear ? (
                <>
                  <button className="danger" onClick={clearHistory}>
                    Clear everything
                  </button>
                  <button onClick={() => setConfirmClear(false)}>Keep</button>
                </>
              ) : (
                <button onClick={() => setConfirmClear(true)}>Clear all saved output…</button>
              )}
            </div>
          </div>
        </Group>

        <Group title="Administrator tabs">
          <div className="settings-field">
            <span className="settings-hint">
              “New admin tab” in the command palette runs a shell as administrator through Windows' own sudo, after the
              UAC prompt. It needs sudo set to <em>Inline</em>; otherwise the shell opens as administrator in its own
              window. Microsoft's warning applies: in Inline mode, other programs running as you can type into an
              administrator tab.
            </span>
            <div className="settings-actions">
              <span>{sudo === undefined ? "Checking…" : SUDO_LABELS[sudo]}</span>
              {sudo !== undefined && sudo !== "missing" && sudo !== "inline" && (
                <button onClick={() => void openSudoSettings().catch((e) => setError(String(e)))}>Open Windows sudo settings</button>
              )}
            </div>
          </div>
        </Group>

        <Group title="Claude Code">
          <Toggle
            label="Remember Claude Code sessions"
            hint='When a terminal prints "claude --resume <id>", keep it for resuming in its folder (✳ in the tab bar).'
            checked={draft.claudeSessions}
            onChange={(v) => set("claudeSessions", v)}
          />
          <Toggle
            label="Alert me when Claude is waiting"
            hint="A Windows notification and a ✳ on the tab when Claude Code in a qterm pane needs you (a permission or your next message)."
            checked={draft.claudeAlerts}
            onChange={(v) => set("claudeAlerts", v)}
          />
          <Toggle
            label="Resume Claude Code sessions on start"
            hint="When tabs reopen, panes that were running Claude Code get “claude --resume <id>” typed for them. Needs “Reopen tabs and layout on start”; most reliable with the hook below set up."
            checked={draft.claudeRestore}
            onChange={(v) => set("claudeRestore", v)}
          />
          <div className="settings-field">
            <span className="settings-label">Notification hook</span>
            <span className="settings-hint">
              Claude Code tells qterm through hooks in {hook?.settingsPath ?? "its settings.json"}: when it waits for you, and
              which session each pane runs (for the context and cost shown on its tab). They only act inside qterm; other
              terminals are unaffected. Applies to Claude sessions started afterwards.
            </span>
            <div className="settings-actions">
              <span>
                {hook === undefined
                  ? "Checking…"
                  : hook.current
                    ? "✓ Set up"
                    : hook.installed
                      ? "Set up for another qterm location"
                      : "Not set up"}
              </span>
              {hook && !hook.current && (
                <button onClick={() => changeHook(installClaudeHook)}>{hook.installed ? "Update" : "Set up Claude Code alerts"}</button>
              )}
              {hook?.installed && <button onClick={() => changeHook(removeClaudeHook)}>Remove</button>}
            </div>
          </div>
        </Group>

        <Group title="Keyboard shortcuts">
          <p className="settings-hint">Like "ctrl+shift+t" or "alt+left". Leave empty to switch a shortcut off.</p>
          <div className="shortcut-grid">
            {ACTION_LIST.map((action) => (
              <label key={action.name} className="shortcut">
                <span>{action.label}</span>
                <input
                  type="text"
                  spellCheck={false}
                  value={draft.chords[action.name] ?? ""}
                  placeholder="off"
                  onChange={(e) => set("chords", { ...draft.chords, [action.name]: e.target.value })}
                />
                <button
                  className="icon-button"
                  title={`Reset to ${action.defaultChord}`}
                  aria-label={`Reset ${action.label}`}
                  disabled={draft.chords[action.name] === action.defaultChord}
                  onClick={() => set("chords", { ...draft.chords, [action.name]: action.defaultChord })}
                >
                  ↺
                </button>
              </label>
            ))}
          </div>
        </Group>
      </div>

      <footer>
        <div className="settings-messages" role="status">
          {[error, ...keymapErrors].filter(Boolean).map((message) => (
            <p key={message} className="settings-error">
              {message}
            </p>
          ))}
          {notice && !error && <p className="settings-notice">{notice}</p>}
        </div>
        <button className="link-button" onClick={() => void openConfigFile()} title={snapshot.path}>
          Open settings file
        </button>
        <button
          className="link-button"
          title="Save your settings (config.toml) to a file, e.g. for another PC"
          onClick={() => void exportSettings().then((done) => done && setNotice("Settings exported."), (e) => setError(String(e)))}
        >
          Export…
        </button>
        <button
          className="link-button"
          title="Replace your settings with a file exported before (the current ones are kept as config.toml.bak)"
          onClick={() => void importSettings().then((done) => done && onClose(), (e) => setError(String(e)))}
        >
          Import…
        </button>
        <button onClick={onClose}>Cancel</button>
        <button className="primary" disabled={!dirty || saving || keymapErrors.length > 0} onClick={() => void save()}>
          {saving ? "Saving…" : "Save"}
        </button>
      </footer>
    </section>
  );
}

const SUDO_LABELS: Record<SudoMode, string> = {
  missing: "Windows' sudo isn't available (Windows 11 24H2 or later)",
  disabled: "Windows' sudo is off",
  newWindow: "Windows' sudo opens a new window",
  inputClosed: "Windows' sudo runs with input closed",
  inline: "✓ Windows' sudo runs inline",
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="settings-group">
      <legend>{title}</legend>
      {children}
    </fieldset>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="settings-field">
      <span className="settings-label">{label}</span>
      {children}
      {hint && <span className="settings-hint">{hint}</span>}
    </label>
  );
}

function Toggle(props: { label: string; hint?: string; checked: boolean; disabled?: boolean; onChange(value: boolean): void }) {
  return (
    <label className="settings-toggle">
      <input type="checkbox" checked={props.checked} disabled={props.disabled} onChange={(e) => props.onChange(e.target.checked)} />
      <span>
        {props.label}
        {props.hint && <span className="settings-hint">{props.hint}</span>}
      </span>
    </label>
  );
}
