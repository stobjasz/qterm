import { useEffect, useMemo, useState, type ReactNode } from "react";

import { getAutostart, openConfigFile, saveConfig, setAutostart, type ConfigSnapshot, type Profile } from "../ipc";
import { ACTION_LIST, buildKeymap } from "../keybindings";
import { THEMES } from "../terminal/themes";
import { changes, overrides, toDraft, type Draft } from "./draft";

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
}

/** Edits config.toml without touching the file by hand. Esc closes without saving. */
export function SettingsPanel({ snapshot, profiles, onClose }: Props) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(snapshot.config));
  const [autostart, setAutostartState] = useState<boolean>();
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);

  useEffect(() => void getAutostart().then(setAutostartState), []);
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
          <Field label="Font">
            <input type="text" value={draft.fontFamily} onChange={(e) => set("fontFamily", e.target.value)} spellCheck={false} />
          </Field>
          <Field label="Font size">
            <input type="number" min={6} max={72} value={draft.fontSize} onChange={(e) => set("fontSize", Number(e.target.value))} />
          </Field>
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
          <Toggle label="Copy selected text automatically" checked={draft.copyOnSelect} onChange={(v) => set("copyOnSelect", v)} />
          <Toggle
            label="Right-click copies, or pastes when nothing is selected"
            checked={draft.rightClickPaste}
            onChange={(v) => set("rightClickPaste", v)}
          />
          <Toggle label="Reopen tabs and layout on start" checked={draft.restoreSession} onChange={(v) => set("restoreSession", v)} />
          <Toggle
            label="Shell integration"
            hint="Shells report their folder, so restored and split panes open where you were. New panes only."
            checked={draft.shellIntegration}
            onChange={(v) => set("shellIntegration", v)}
          />
          <Toggle
            label="Remember Claude Code sessions"
            hint='When a terminal prints "claude --resume <id>", keep it for resuming in its folder (✳ in the tab bar).'
            checked={draft.claudeSessions}
            onChange={(v) => set("claudeSessions", v)}
          />
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
        </div>
        <button className="link-button" onClick={() => void openConfigFile()} title={snapshot.path}>
          Open settings file
        </button>
        <button onClick={onClose}>Cancel</button>
        <button className="primary" disabled={!dirty || saving || keymapErrors.length > 0} onClick={() => void save()}>
          {saving ? "Saving…" : "Save"}
        </button>
      </footer>
    </section>
  );
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
