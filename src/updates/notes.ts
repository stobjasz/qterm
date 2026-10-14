// Release notes (GitHub Markdown) for the "What's new" panel: headings, list items
// and paragraphs, with **bold**, `code` and [links](https://…). Anything fancier
// shows as plain text; nothing becomes HTML.

export type Inline = { kind: "text" | "bold" | "code"; text: string } | { kind: "link"; text: string; url: string };

export type Block = { kind: "heading"; inlines: Inline[] } | { kind: "item"; inlines: Inline[] } | { kind: "paragraph"; inlines: Inline[] };

const INLINE = /\*\*(.+?)\*\*|`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let at = 0;
  for (const m of text.matchAll(INLINE)) {
    if (m.index > at) out.push({ kind: "text", text: text.slice(at, m.index) });
    if (m[1] !== undefined) out.push({ kind: "bold", text: m[1] });
    else if (m[2] !== undefined) out.push({ kind: "code", text: m[2] });
    else out.push({ kind: "link", text: m[3], url: m[4] });
    at = m.index + m[0].length;
  }
  if (at < text.length) out.push({ kind: "text", text: text.slice(at) });
  return out;
}

export function parseNotes(markdown: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  const endParagraph = () => {
    if (paragraph.length) blocks.push({ kind: "paragraph", inlines: parseInline(paragraph.join(" ")) });
    paragraph = [];
  };
  for (const raw of markdown.replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.trim();
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    const item = /^[-*]\s+(.*)$/.exec(line);
    if (!line) endParagraph();
    else if (heading) {
      endParagraph();
      blocks.push({ kind: "heading", inlines: parseInline(heading[1]) });
    } else if (item) {
      endParagraph();
      blocks.push({ kind: "item", inlines: parseInline(item[1]) });
    } else if (blocks.length && blocks[blocks.length - 1].kind === "item" && raw.startsWith("  ") && !paragraph.length) {
      // A list item's continuation line.
      const last = blocks[blocks.length - 1];
      last.inlines = [...last.inlines, { kind: "text", text: " " }, ...parseInline(line)];
    } else paragraph.push(line);
  }
  endParagraph();
  return blocks;
}

export const RELEASES_URL = "https://github.com/stobjasz/qterm/releases";

/** The release's notes from GitHub (public API, no sign-in); undefined if unavailable. */
export async function fetchNotes(version: string): Promise<string | undefined> {
  try {
    const response = await fetch(`https://api.github.com/repos/stobjasz/qterm/releases/tags/v${version}`, {
      headers: { Accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return undefined;
    const body = (await response.json()) as { body?: unknown };
    return typeof body.body === "string" && body.body.trim() ? body.body : undefined;
  } catch {
    return undefined;
  }
}
