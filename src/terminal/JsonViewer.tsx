import { useState } from "react";

import { useEscape } from "../tabs/useDismiss";
import { copyText, jsonPath, preview, type Json } from "./json";

/** Levels open at first; deeper ones open on a click. */
const OPEN_DEPTH = 2;
/** Items of a long list shown before "show all". */
const LIST_PAGE = 200;

interface Props {
  value: Json;
  /** Where it came from, e.g. "the selection" or "npm view react --json". */
  source: string;
  /** Puts the text on the clipboard. */
  onCopy(text: string): Promise<void>;
  onClose(): void;
}

/** JSON from the output, formatted and foldable; any value can be copied. */
export function JsonViewer({ value, source, onCopy, onClose }: Props) {
  useEscape(onClose);
  // Folds the user changed, by path; `all` when Expand all / Collapse all was used last.
  const [folds, setFolds] = useState<{ all?: boolean; open: ReadonlyMap<string, boolean> }>({ open: new Map() });
  const [copied, setCopied] = useState<string>();

  const isOpen = (key: string, depth: number) => folds.open.get(key) ?? folds.all ?? depth < OPEN_DEPTH;
  const toggle = (key: string, depth: number) =>
    setFolds((f) => ({ ...f, open: new Map(f.open).set(key, !(f.open.get(key) ?? f.all ?? depth < OPEN_DEPTH)) }));
  const copy = (path: (string | number)[], item: Json) =>
    void onCopy(copyText(item)).then(
      () => setCopied(`Copied ${jsonPath(path)}`),
      (e) => setCopied(`Could not copy: ${e}`),
    );

  return (
    <section className="settings-panel json-viewer" role="dialog" aria-label="JSON viewer" aria-modal="true">
      <header>
        <h2>JSON</h2>
        <span className="settings-hint json-source" title={source}>
          from {source}
        </span>
        <button className="icon-button" aria-label="Close the JSON viewer" title="Close (Esc)" onClick={onClose}>
          ×
        </button>
      </header>
      <div className="settings-body">
        <ul className="json-tree" role="tree" aria-label="JSON value">
          <JsonNode name={undefined} value={value} path={[]} depth={0} isOpen={isOpen} onToggle={toggle} onCopy={copy} />
        </ul>
      </div>
      <footer>
        <span className="settings-hint" role="status">
          {copied ?? "Click ▸ to open a level; Copy takes that value (a string as it is, the rest as JSON)."}
        </span>
        <button onClick={() => setFolds({ all: true, open: new Map() })}>Expand all</button>
        <button onClick={() => setFolds({ all: false, open: new Map() })}>Collapse all</button>
        <button onClick={() => copy([], value)}>Copy all</button>
        <button className="primary" onClick={onClose}>
          Close
        </button>
      </footer>
    </section>
  );
}

interface NodeProps {
  name: string | number | undefined;
  value: Json;
  path: (string | number)[];
  depth: number;
  isOpen(key: string, depth: number): boolean;
  onToggle(key: string, depth: number): void;
  onCopy(path: (string | number)[], value: Json): void;
}

function JsonNode({ name, value, path, depth, isOpen, onToggle, onCopy }: NodeProps) {
  const [showAll, setShowAll] = useState(false);
  const key = jsonPath(path);
  const container = value !== null && typeof value === "object";
  const open = container && isOpen(key, depth);
  const entries: [string | number, Json][] = !container
    ? []
    : Array.isArray(value)
      ? value.map((item, i) => [i, item])
      : Object.entries(value);
  const shown = showAll ? entries : entries.slice(0, LIST_PAGE);
  const label = name === undefined ? "" : typeof name === "number" ? `${name}` : name;

  return (
    <li role="treeitem" aria-expanded={container ? open : undefined} aria-label={label || "value"}>
      <div className="json-row" title={key}>
        {container ? (
          <button className="json-toggle" aria-label={open ? `Collapse ${key}` : `Expand ${key}`} onClick={() => onToggle(key, depth)}>
            {open ? "▾" : "▸"}
          </button>
        ) : (
          <span className="json-toggle" aria-hidden="true" />
        )}
        {name !== undefined && <span className={typeof name === "number" ? "json-index" : "json-key"}>{label}</span>}
        <span className={`json-value json-${value === null ? "null" : Array.isArray(value) ? "array" : typeof value}`}>
          {container ? (open ? (Array.isArray(value) ? `[${entries.length}]` : `{${entries.length}}`) : preview(value)) : JSON.stringify(value)}
        </span>
        <button className="json-copy" aria-label={`Copy ${key}`} onClick={() => onCopy(path, value)}>
          Copy
        </button>
      </div>
      {open && entries.length > 0 && (
        <ul role="group">
          {shown.map(([childName, child]) => (
            <JsonNode
              key={String(childName)}
              name={childName}
              value={child}
              path={[...path, childName]}
              depth={depth + 1}
              isOpen={isOpen}
              onToggle={onToggle}
              onCopy={onCopy}
            />
          ))}
          {shown.length < entries.length && (
            <li>
              <button className="link-button" onClick={() => setShowAll(true)}>
                Show all {entries.length}
              </button>
            </li>
          )}
        </ul>
      )}
    </li>
  );
}
