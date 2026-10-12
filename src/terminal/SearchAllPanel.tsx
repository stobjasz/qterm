import { useEffect, useRef, useState } from "react";

import type { PaneId } from "../workspace/workspace";
import { excerpt, SEARCH_ALL_LIMIT, type SearchHit, type SearchOptions } from "./searchAll";

interface Props {
  search(query: string, options: SearchOptions): SearchHit[];
  /** Where a pane is, e.g. "2 · PowerShell". */
  paneLabel(paneId: PaneId): string;
  onPick(hit: SearchHit, query: string, options: SearchOptions): void;
  onClose(): void;
}

/** Search every pane's output (restored output too), then jump to a match. */
export function SearchAllPanel({ search, paneLabel, onPick, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<SearchOptions>({ caseSensitive: false, regex: false });
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [selected, setSelected] = useState(0);
  const list = useRef<HTMLUListElement>(null);

  // Typing is debounced: every pane's buffer is read on each search.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setHits(search(query, options));
      setSelected(0);
    }, 150);
    return () => window.clearTimeout(timer);
  }, [query, options, search]);
  useEffect(() => {
    list.current?.children[selected]?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const pick = (hit: SearchHit | undefined) => {
    if (!hit) return;
    onClose();
    onPick(hit, query, options);
  };
  const toggle = (key: keyof SearchOptions) => setOptions((o) => ({ ...o, [key]: !o[key] }));

  return (
    <div className="palette-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="palette search-all"
        role="dialog"
        aria-label="Search all panes"
        onKeyDown={(e) => {
          if (e.key !== "Escape") return;
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }}
      >
        <div className="search-all-input">
          <input
            autoFocus
            role="combobox"
            aria-expanded="true"
            aria-controls="search-all-list"
            aria-activedescendant={hits[selected] ? `search-all-${selected}` : undefined}
            aria-label="Search all panes"
            placeholder="Search the output of every pane"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") setSelected((i) => Math.min(i + 1, hits.length - 1));
              else if (e.key === "ArrowUp") setSelected((i) => Math.max(i - 1, 0));
              else if (e.key === "Enter") pick(hits[selected]);
              else return;
              e.preventDefault();
              e.stopPropagation();
            }}
          />
          <button
            className={`search-toggle${options.caseSensitive ? " on" : ""}`}
            aria-pressed={options.caseSensitive}
            title="Match case"
            onMouseDown={(e) => e.preventDefault()} // keep typing in the box
            onClick={() => toggle("caseSensitive")}
          >
            Aa
          </button>
          <button
            className={`search-toggle${options.regex ? " on" : ""}`}
            aria-pressed={options.regex}
            title="Regular expression"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => toggle("regex")}
          >
            .*
          </button>
        </div>
        <ul id="search-all-list" role="listbox" aria-label="Matches" ref={list}>
          {query && hits.length === 0 && <li className="palette-empty">No pane shows “{query}”.</li>}
          {hits.map((hit, i) => {
            const cut = excerpt(hit.text, hit);
            return (
              <li
                key={`${hit.paneId}:${hit.index}`}
                id={`search-all-${i}`}
                role="option"
                aria-selected={i === selected}
                onMouseMove={() => setSelected(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(hit);
                }}
              >
                <span className="palette-group">{paneLabel(hit.paneId)}</span>
                <span className="palette-label search-all-line">
                  {cut.before}
                  <mark>{cut.hit}</mark>
                  {cut.after}
                </span>
              </li>
            );
          })}
          {hits.length >= SEARCH_ALL_LIMIT && <li className="palette-empty">Showing the first {SEARCH_ALL_LIMIT} matches.</li>}
        </ul>
      </div>
    </div>
  );
}
