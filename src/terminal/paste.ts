// Pasting into a shell: several lines would run one by one, so qterm asks first.

/** The lines a paste holds; a single line break at the end doesn't make another. */
export function pastedLines(text: string): string[] {
  const lines = text.split(/\r\n|\r|\n/);
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** Whether pasting `text` would run more than one command in a shell. */
export function isMultiLine(text: string): boolean {
  return pastedLines(text).length > 1;
}
