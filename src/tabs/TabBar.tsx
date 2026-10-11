import { useRef, useState, type PointerEvent } from "react";

import { ClaudeMenu } from "../claude/ClaudeMenu";
import type { ClaudeAlert, ClaudeSession, Profile } from "../ipc";
import { tabTitle, type SplitDir, type TabId, type Workspace } from "../workspace/workspace";
import { Popup } from "./Popup";

/** A drag only starts after the pointer moved this far, so clicks stay clicks. */
const DRAG_THRESHOLD_PX = 6;

interface Props {
  workspace: Workspace;
  profiles: Profile[];
  /** Present when remembering Claude sessions is switched on. */
  claude?: {
    sessions: ClaudeSession[];
    onResume(session: ClaudeSession): void;
    onForget(ids: string[]): void;
  };
  onActivate(tabId: TabId): void;
  onClose(tabId: TabId): void;
  onNewTab(profileId?: string): void;
  onSplit(dir: SplitDir): void;
  onRename(tabId: TabId, title: string): void;
  onMove(tabId: TabId, toIndex: number): void;
  onOpenSettings(): void;
  /** Tabs with a pane where Claude Code is waiting, and its latest message. */
  attention: ReadonlyMap<TabId, ClaudeAlert>;
}

// Mouse-down default is prevented (except in text fields) so clicking the bar never
// takes keyboard focus away from the terminal.
export function TabBar(props: Props) {
  const { workspace, profiles, claude } = props;
  const [editing, setEditing] = useState<TabId>();
  const [dropIndex, setDropIndex] = useState<number>();
  const tabsRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ tabId: TabId; startX: number; active: boolean }>(undefined);

  // Insertion point among all tabs for a pointer at `x`.
  const insertionAt = (x: number) =>
    [...(tabsRef.current?.children ?? [])].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.left + r.width / 2 < x;
    }).length;

  const onPointerDown = (e: PointerEvent, tabId: TabId) => {
    if (e.button !== 0 || editing === tabId) return;
    drag.current = { tabId, startX: e.clientX, active: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent) => {
    const d = drag.current;
    if (!d || (!d.active && Math.abs(e.clientX - d.startX) < DRAG_THRESHOLD_PX)) return;
    d.active = true;
    setDropIndex(insertionAt(e.clientX));
  };
  const onPointerUp = () => {
    const d = drag.current;
    drag.current = undefined;
    if (d?.active && dropIndex !== undefined) {
      const from = workspace.tabs.findIndex((t) => t.id === d.tabId);
      // moveTab takes the tab out first, so later positions shift down by one.
      props.onMove(d.tabId, dropIndex > from ? dropIndex - 1 : dropIndex);
    }
    setDropIndex(undefined);
  };

  return (
    <div className="tabbar" onMouseDown={(e) => !(e.target instanceof HTMLInputElement) && e.preventDefault()}>
      <div className="tabs" role="tablist" aria-label="Terminal tabs" ref={tabsRef}>
        {workspace.tabs.map((tab, i) => {
          const title = tabTitle(workspace, tab);
          const active = tab.id === workspace.activeTab;
          const waiting = props.attention.get(tab.id);
          const drop = dropIndex === i ? " drop-before" : dropIndex === i + 1 && i === workspace.tabs.length - 1 ? " drop-after" : "";
          return (
            <div
              key={tab.id}
              role="tab"
              aria-selected={active}
              className={`tab${active ? " active" : ""}${drop}${waiting ? " attention" : ""}`}
              title={`${waiting ? `Claude: ${waiting.message}\n` : ""}${title}\nDouble-click to rename, drag to move`}
              onClick={() => props.onActivate(tab.id)}
              onDoubleClick={() => setEditing(tab.id)}
              onAuxClick={(e) => e.button === 1 && props.onClose(tab.id)}
              onPointerDown={(e) => onPointerDown(e, tab.id)}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            >
              {editing === tab.id ? (
                <RenameField
                  initial={tab.title ?? title}
                  onDone={(value) => {
                    setEditing(undefined);
                    if (value !== undefined) props.onRename(tab.id, value);
                  }}
                />
              ) : (
                <span className="tab-title">{title}</span>
              )}
              {waiting && (
                <span className="tab-attention" role="status" aria-label={`Claude is waiting: ${waiting.message}`}>
                  ✳
                </span>
              )}
              <button
                className="tab-close"
                aria-label={`Close ${title}`}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  props.onClose(tab.id);
                }}
              >
                ×
              </button>
            </div>
          );
        })}
      </div>
      <button className="tab-new" aria-label="New tab" title="New tab (Ctrl+Shift+T)" onClick={() => props.onNewTab()}>
        +
      </button>
      <Popup label="Choose profile" icon="▾" menuLabel="Profiles">
        {(close) =>
          profiles.map((profile, i) => (
            <button
              key={profile.id}
              role="menuitem"
              onClick={() => {
                close();
                props.onNewTab(profile.id);
              }}
            >
              <span>{profile.name}</span>
              {i < 9 && <kbd>Ctrl+Shift+{i + 1}</kbd>}
            </button>
          ))
        }
      </Popup>
      <div className="tabbar-spacer" />
      {claude && <ClaudeMenu {...claude} />}
      <button className="tab-new" aria-label="Split right" title="Split right (Alt+Shift+=)" onClick={() => props.onSplit("row")}>
        <SplitIcon dir="row" />
      </button>
      <button className="tab-new" aria-label="Split down" title="Split down (Alt+Shift+-)" onClick={() => props.onSplit("column")}>
        <SplitIcon dir="column" />
      </button>
      <button className="tab-new" aria-label="Settings" title="Settings (Ctrl+,)" onClick={props.onOpenSettings}>
        ⚙
      </button>
    </div>
  );
}

function RenameField({ initial, onDone }: { initial: string; onDone(value?: string): void }) {
  return (
    <input
      className="tab-rename"
      aria-label="Tab name"
      defaultValue={initial}
      autoFocus
      onFocus={(e) => e.currentTarget.select()}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") onDone(e.currentTarget.value);
        if (e.key === "Escape") onDone(undefined);
      }}
      onBlur={(e) => onDone(e.currentTarget.value)}
    />
  );
}

function SplitIcon({ dir }: { dir: SplitDir }) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" aria-hidden="true">
      <rect x="1.5" y="1.5" width="11" height="11" rx="1.5" />
      {dir === "row" ? <line x1="7" y1="1.5" x2="7" y2="12.5" /> : <line x1="1.5" y1="7" x2="12.5" y2="7" />}
    </svg>
  );
}
