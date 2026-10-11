import { useEffect, useRef, useState } from "react";

export interface SearchOptions {
  caseSensitive: boolean;
  regex: boolean;
}

interface Props {
  /** -1 index: more matches than xterm counts, or none selected yet. */
  results?: { index: number; count: number };
  onSearch(query: string, options: SearchOptions, backwards: boolean): void;
  onClose(): void;
}

/** Find in the focused pane's scrollback. Enter: next, Shift+Enter: previous, Esc: close. */
export function SearchBar({ results, onSearch, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<SearchOptions>({ caseSensitive: false, regex: false });
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => input.current?.focus(), []);

  const search = (backwards = false, q = query, opts = options) => onSearch(q, opts, backwards);
  const toggle = (key: keyof SearchOptions) => {
    const next = { ...options, [key]: !options[key] };
    setOptions(next);
    search(false, query, next);
    input.current?.focus();
  };

  let status = "";
  if (query && results) {
    if (results.count === 0) status = "No results";
    else if (results.index < 0) status = `${results.count}+ matches`;
    else status = `${results.index + 1} of ${results.count}`;
  }

  return (
    <div className="search-bar" role="search" onMouseDown={(e) => e.target !== input.current && e.preventDefault()}>
      <input
        ref={input}
        aria-label="Find in terminal"
        placeholder="Find"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          search(false, e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") search(e.shiftKey);
          if (e.key === "Escape") onClose();
        }}
      />
      <span className="search-status" aria-live="polite">
        {status}
      </span>
      <button aria-label="Match case" title="Match case" aria-pressed={options.caseSensitive} onClick={() => toggle("caseSensitive")}>
        Aa
      </button>
      <button aria-label="Regular expression" title="Regular expression" aria-pressed={options.regex} onClick={() => toggle("regex")}>
        .*
      </button>
      <button aria-label="Previous match" title="Previous (Shift+Enter)" onClick={() => search(true)}>
        ↑
      </button>
      <button aria-label="Next match" title="Next (Enter)" onClick={() => search(false)}>
        ↓
      </button>
      <button aria-label="Close search" title="Close (Esc)" onClick={onClose}>
        ×
      </button>
    </div>
  );
}
