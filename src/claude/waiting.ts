// Panes where Claude Code waits for you, in the order they appear (tab by tab, pane
// by pane), and the next one to jump to.

/**
 * The waiting pane after `current` in `order`, wrapping around; the first one when
 * `current` isn't given or isn't in `order`. Undefined when nothing waits.
 */
export function nextWaiting(order: readonly string[], waiting: ReadonlySet<string>, current?: string): string | undefined {
  const inOrder = order.filter((id) => waiting.has(id));
  if (inOrder.length === 0) return undefined;
  const at = current === undefined ? -1 : order.indexOf(current);
  return inOrder.find((id) => order.indexOf(id) > at) ?? inOrder[0];
}

/**
 * Whether a tab alert is Claude Code's (waiting for you, or stopped on an error) rather
 * than a long command's end or a trigger, which share the tab marker.
 */
export function isClaudeAlert(kind: string | null | undefined): boolean {
  return !kind?.startsWith("command_") && kind !== "trigger";
}
