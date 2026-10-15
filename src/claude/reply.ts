// Claude's last reply in a pane (its Stop hook), as tooltips and the waiting list show it.

/** The start of a reply: at most `maxLines` lines and `maxChars` characters, Markdown marks left as they are. */
export function replyPreview(message: string, maxLines = 6, maxChars = 400): string {
  const lines = message
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line, i, all) => line !== "" || (i > 0 && all[i - 1] !== ""));
  let text = lines.slice(0, maxLines).join("\n");
  let cut = lines.length > maxLines;
  if (text.length > maxChars) {
    text = text.slice(0, maxChars).trimEnd();
    cut = true;
  }
  return cut ? `${text}…` : text;
}
