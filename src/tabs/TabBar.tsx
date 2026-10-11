import { useEffect, useRef, useState } from "react";

import type { Profile } from "../ipc";
import { tabTitle, type SplitDir, type TabId, type Workspace } from "../workspace/workspace";

interface Props {
  workspace: Workspace;
  profiles: Profile[];
  onActivate(tabId: TabId): void;
  onClose(tabId: TabId): void;
  onNewTab(profileId?: string): void;
  onSplit(dir: SplitDir): void;
}

// Mouse-down default is prevented throughout so clicking the bar never takes
// keyboard focus away from the terminal.
export function TabBar({ workspace, profiles, onActivate, onClose, onNewTab, onSplit }: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== "Escape") return;
      if (e instanceof MouseEvent && menuRef.current?.contains(e.target as Node)) return;
      setMenuOpen(false);
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", close);
    };
  }, [menuOpen]);

  return (
    <div className="tabbar" onMouseDown={(e) => e.preventDefault()}>
      <div className="tabs" role="tablist" aria-label="Terminal tabs">
        {workspace.tabs.map((tab) => {
          const title = tabTitle(workspace, tab);
          const active = tab.id === workspace.activeTab;
          return (
            <div
              key={tab.id}
              role="tab"
              aria-selected={active}
              className={`tab${active ? " active" : ""}`}
              title={title}
              onClick={() => onActivate(tab.id)}
              onAuxClick={(e) => e.button === 1 && onClose(tab.id)}
            >
              <span className="tab-title">{title}</span>
              <button
                className="tab-close"
                aria-label={`Close ${title}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onClose(tab.id);
                }}
              >
                ×
              </button>
            </div>
          );
        })}
      </div>
      <button className="tab-new" aria-label="New tab" title="New tab (Ctrl+Shift+T)" onClick={() => onNewTab()}>
        +
      </button>
      <div className="profile-menu" ref={menuRef}>
        <button
          className="tab-new"
          aria-label="Choose profile"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
        >
          ▾
        </button>
        {menuOpen && (
          <div className="menu" role="menu" aria-label="Profiles">
            {profiles.map((profile, i) => (
              <button
                key={profile.id}
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  onNewTab(profile.id);
                }}
              >
                <span>{profile.name}</span>
                {i < 9 && <kbd>Ctrl+Shift+{i + 1}</kbd>}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="tabbar-spacer" />
      <button className="tab-new" aria-label="Split right" title="Split right (Alt+Shift+=)" onClick={() => onSplit("row")}>
        <SplitIcon dir="row" />
      </button>
      <button className="tab-new" aria-label="Split down" title="Split down (Alt+Shift+-)" onClick={() => onSplit("column")}>
        <SplitIcon dir="column" />
      </button>
    </div>
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
