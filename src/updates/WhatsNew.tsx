import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useState, type ReactNode } from "react";

import { useEscape } from "../tabs/useDismiss";
import { fetchNotes, parseNotes, RELEASES_URL, type Inline } from "./notes";

interface Props {
  version: string;
  /** The version before the update, when this follows one. */
  from?: string;
  onClose(): void;
}

/** "What's new in qterm X": that release's notes from GitHub, once after an update. */
export function WhatsNew({ version, from, onClose }: Props) {
  const [notes, setNotes] = useState<string | null>();
  useEffect(() => void fetchNotes(version).then((text) => setNotes(text ?? null)), [version]);
  useEscape(onClose);
  const page = `${RELEASES_URL}/tag/v${version}`;

  return (
    <section className="settings-panel whats-new" role="dialog" aria-label="What's new" aria-modal="true">
      <header>
        <h2>What's new in qterm {version}</h2>
        <button className="icon-button" aria-label="Close what's new" title="Close (Esc)" onClick={onClose}>
          ×
        </button>
      </header>
      <div className="settings-body">
        {from && <p className="settings-hint">Updated from {from}.</p>}
        {notes === undefined && <p>Loading the release notes…</p>}
        {notes === null && <p>The release notes couldn't be loaded.</p>}
        {notes && <Notes markdown={notes} />}
      </div>
      <footer>
        <button className="link-button" onClick={() => void openUrl(page)}>
          Release page on GitHub
        </button>
        <button className="primary" onClick={onClose}>
          Close
        </button>
      </footer>
    </section>
  );
}

function Notes({ markdown }: { markdown: string }) {
  const out: ReactNode[] = [];
  let items: ReactNode[] = [];
  const endList = () => {
    if (items.length) out.push(<ul key={`list-${out.length}`}>{items}</ul>);
    items = [];
  };
  parseNotes(markdown).forEach((block, i) => {
    const content = <InlineText inlines={block.inlines} />;
    if (block.kind === "item") return items.push(<li key={i}>{content}</li>);
    endList();
    out.push(block.kind === "heading" ? <h3 key={i}>{content}</h3> : <p key={i}>{content}</p>);
  });
  endList();
  return <div className="whats-new-notes">{out}</div>;
}

function InlineText({ inlines }: { inlines: Inline[] }) {
  return (
    <>
      {inlines.map((inline, i) => {
        switch (inline.kind) {
          case "bold":
            return <strong key={i}>{inline.text}</strong>;
          case "code":
            return <code key={i}>{inline.text}</code>;
          case "link":
            return (
              <a
                key={i}
                href={inline.url}
                onClick={(e) => {
                  e.preventDefault();
                  void openUrl(inline.url);
                }}
              >
                {inline.text}
              </a>
            );
          default:
            return <span key={i}>{inline.text}</span>;
        }
      })}
    </>
  );
}
