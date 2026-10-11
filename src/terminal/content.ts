// Whether a pane's output is worth keeping across a restart: not when it is only
// what every new shell shows (a banner, a bare prompt) or qterm's own markers.

/** Lines that carry nothing of the user's: matched against the trimmed line. */
const NOISE = [
  /^PS [^>]*>$/, // PowerShell prompt, nothing typed
  /^[A-Za-z]:\\[^>]*>$/, // cmd prompt, nothing typed
  /^\S+@\S+ MINGW(?:32|64)\b.*$/, // Git Bash prompt, first line
  /^[$#]$/, // Git Bash prompt, second line
  /^\S+@[\w.-]+:.*[$#]$/, // bash/WSL default prompt, nothing typed
  /^Microsoft Windows \[Version [\d.]+\]$/, // cmd banner
  /^\(c\) Microsoft Corporation\. All rights reserved\.$/,
  /^Loading personal and system profiles took \d+ms\.$/, // PowerShell
  /^──── restored .* ────$/, // qterm's divider
  /^\[process exited with code \d+\]$/, // qterm's exit note
];

/** True when some line is more than blank space, a bare prompt or a startup banner. */
export function hasContent(lines: Iterable<string>): boolean {
  for (const line of lines) {
    const text = line.trim();
    if (text && !NOISE.some((pattern) => pattern.test(text))) return true;
  }
  return false;
}

/** The text lines of serialized output (SerializeAddon): escape sequences removed. */
export function plainLines(serialized: string): string[] {
  return (
    serialized
      // Cursor-forward stands in for runs of blank cells.
      .replace(/\x1b\[(\d*)C/g, (_, n: string) => " ".repeat(Number(n || 1)))
      // OSC (titles, links) up to BEL or ST, then any other CSI or two-byte escape.
      .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
      .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
      .replace(/\x1b[@-_]/g, "")
      .split(/\r?\n/)
  );
}
