import { useEffect, useRef, useState } from "react";

import type { Profile } from "../ipc";

interface Props {
  /** "Split right with", "Switch this pane to", ... */
  title: string;
  profiles: Profile[];
  /** The shell the pane runs now, marked in the list. */
  current?: string;
  onPick(profile: Profile): void;
  onClose(): void;
}

/** Pick a shell: 1-9 picks at once, or ↑/↓ and Enter; Esc cancels. */
export function ShellPicker({ title, profiles, current, onPick, onClose }: Props) {
  const [selected, setSelected] = useState(0);
  const list = useRef<HTMLUListElement>(null);
  useEffect(() => list.current?.focus(), []);
  useEffect(() => {
    list.current?.children[selected]?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const pick = (profile: Profile | undefined) => {
    if (!profile) return;
    onClose();
    onPick(profile);
  };

  return (
    <div className="palette-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="palette shell-picker" role="dialog" aria-label={title}>
        <div className="shell-picker-title">{title}</div>
        <ul
          ref={list}
          role="listbox"
          aria-label="Shells"
          tabIndex={0}
          aria-activedescendant={profiles[selected] ? `shell-${selected}` : undefined}
          onKeyDown={(e) => {
            const digit = /^Digit([1-9])$/.exec(e.code);
            if (digit) pick(profiles[Number(digit[1]) - 1]);
            else if (e.key === "ArrowDown") setSelected((i) => Math.min(i + 1, profiles.length - 1));
            else if (e.key === "ArrowUp") setSelected((i) => Math.max(i - 1, 0));
            else if (e.key === "Enter") pick(profiles[selected]);
            else if (e.key === "Escape") onClose();
            else return;
            e.preventDefault();
            e.stopPropagation();
          }}
        >
          {profiles.map((profile, i) => (
            <li
              key={profile.id}
              id={`shell-${i}`}
              role="option"
              aria-selected={i === selected}
              onMouseMove={() => setSelected(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(profile);
              }}
            >
              <span className="palette-label">
                {profile.icon && <span aria-hidden="true">{profile.icon} </span>}
                {profile.name}
                {profile.id === current && <span className="settings-hint"> (this pane)</span>}
              </span>
              {i < 9 && <kbd>{i + 1}</kbd>}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
