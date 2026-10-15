// A pane's project (see src-tauri/src/project.rs): how its git status reads, and what
// its .qterm.toml changes about the tab.
import type { GitStatus, ProjectInfo } from "../ipc";
import { TAB_COLORS, type ProjectLook, type TabColor } from "../workspace/workspace";

/** "main · 3 changed, 1 new · ↑2 ↓1"; "main · clean" when nothing changed. */
export function gitSummary(git: GitStatus): string {
  const changes = [git.changed && `${git.changed} changed`, git.untracked && `${git.untracked} new`].filter(Boolean).join(", ");
  const sync = [git.ahead ? `↑${git.ahead}` : "", git.behind ? `↓${git.behind}` : ""].filter(Boolean).join(" ");
  return [git.branch, changes || "clean", sync].filter(Boolean).join(" · ");
}

/** The tab name, colour and icon a pane's project gives it, if any. */
export function projectLook(info: ProjectInfo | undefined): ProjectLook | undefined {
  const settings = info?.settings;
  if (!settings) return undefined;
  const look: ProjectLook = {};
  if (settings.name?.trim()) look.name = settings.name.trim();
  if (TAB_COLORS.includes(settings.tabColor as TabColor)) look.color = settings.tabColor as TabColor;
  if (settings.icon?.trim()) look.icon = settings.icon.trim();
  return Object.keys(look).length ? look : undefined;
}
