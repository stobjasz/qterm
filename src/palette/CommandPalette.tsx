import { useEffect, useMemo, useRef, useState } from "react";

import { fuzzyMatch, rank } from "./fuzzy";
import { emptyQueryOrder, loadRecent, remember, saveRecent } from "./recent";

export interface PaletteItem {
  id: string;
  /** What kind of thing it is: "Action", "Tab", "Profile", "Theme", ... */
  group: string;
  label: string;
  /** Shown on the right, e.g. the shortcut. */
  hint?: string;
  run(): void;
}

interface Props {
  items: PaletteItem[];
  onClose(): void;
}

/** Ctrl+Shift+P: type to filter, ↑/↓ to choose, Enter to run, Esc to close. */
export function CommandPalette({ items, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const list = useRef<HTMLUListElement>(null);
  const [recent] = useState(loadRecent);
  // Nothing typed: what you ran lately first, without the long lists (emptyQueryOrder).
  const matches = useMemo(
    () => (query.trim() ? rank(items, (item) => `${item.group}: ${item.label}`, query) : emptyQueryOrder(items, recent)),
    [items, query, recent],
  );

  useEffect(() => setSelected(0), [query]);
  useEffect(() => {
    list.current?.children[selected]?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const run = (item: PaletteItem | undefined) => {
    if (!item) return;
    saveRecent(remember(recent, item.id));
    onClose();
    item.run();
  };

  return (
    <div className="palette-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="palette" role="dialog" aria-label="Command palette">
        <input
          autoFocus
          role="combobox"
          aria-expanded="true"
          aria-controls="palette-list"
          aria-activedescendant={matches[selected] ? `palette-${matches[selected].id}` : undefined}
          aria-label="Command"
          placeholder="Type a command, tab, profile, theme or Claude session"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") setSelected((i) => Math.min(i + 1, matches.length - 1));
            else if (e.key === "ArrowUp") setSelected((i) => Math.max(i - 1, 0));
            else if (e.key === "Enter") run(matches[selected]);
            else if (e.key === "Escape") onClose();
            else return;
            e.preventDefault();
            e.stopPropagation();
          }}
        />
        <ul id="palette-list" role="listbox" aria-label="Commands" ref={list}>
          {matches.length === 0 && <li className="palette-empty">Nothing matches “{query}”.</li>}
          {matches.map((item, i) => (
            <li
              key={item.id}
              id={`palette-${item.id}`}
              role="option"
              aria-selected={i === selected}
              onMouseMove={() => setSelected(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                run(item);
              }}
            >
              <span className="palette-group">{item.group}</span>
              <Highlighted text={item.label} query={query} />
              {item.hint && <kbd>{item.hint}</kbd>}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function Highlighted({ text, query }: { text: string; query: string }) {
  const hits = new Set(fuzzyMatch(query, text)?.indices ?? []);
  return (
    <span className="palette-label">
      {[...text].map((ch, i) => (hits.has(i) ? <mark key={i}>{ch}</mark> : ch))}
    </span>
  );
}
