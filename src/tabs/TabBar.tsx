import { useEffect, useRef, useState } from "react";

import type { Profile } from "../ipc";
import { tabTitle, type TabId, type Workspace } from "../workspace/workspace";

interface Props {
  workspace: Workspace;
  profiles: Profile[];
  onActivate(tabId: TabId): void;
  onClose(tabId: TabId): void;
  onNewTab(profileId?: string): void;
}

// Mouse-down default is prevented throughout so clicking the bar never takes
// keyboard focus away from the terminal.
export function TabBar({ workspace, profiles, onActivate, onClose, onNewTab }: Props) {
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
    </div>
  );
}
