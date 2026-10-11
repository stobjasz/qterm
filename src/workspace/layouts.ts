// Named layouts ([[layouts]] in config.toml) ⇄ tabs. Pure functions.
import type { LayoutNode, PaneId, SplitDir } from "./layout";
import type { Pane, ProfileRef, Tab, Workspace } from "./workspace";

/** One pane, or (with `panes`) a split. Mirrors the TOML; null and absent mean the same. */
export interface LayoutPane {
  profile?: string | null;
  cwd?: string | null;
  command?: string | null;
  split?: SplitDir | null;
  panes?: LayoutPane[];
}

export interface LayoutDef extends LayoutPane {
  name: string;
}

export interface BuiltLayout {
  root: LayoutNode;
  panes: Pane[];
  /** Typed into each pane's shell once it starts. */
  commands: Map<PaneId, string>;
  /** Profile references that matched nothing (the default profile was used). */
  unknownProfiles: string[];
}

/** Profile by id, else by name (case-insensitive). */
export function findProfile<P extends ProfileRef>(profiles: P[], reference: string): P | undefined {
  const lower = reference.toLowerCase();
  return profiles.find((p) => p.id === reference) ?? profiles.find((p) => p.name.toLowerCase() === lower);
}

export function buildLayout(
  def: LayoutDef,
  profiles: ProfileRef[],
  fallback: ProfileRef,
  nextId: () => PaneId,
): BuiltLayout {
  const panes: Pane[] = [];
  const commands = new Map<PaneId, string>();
  const unknownProfiles: string[] = [];

  const build = (node: LayoutPane): LayoutNode => {
    const children = node.panes ?? [];
    if (children.length > 1 && node.split) {
      const kids = children.map(build);
      return { kind: "split", dir: node.split, children: kids, sizes: kids.map(() => 1 / kids.length) };
    }
    if (children.length === 1) return build(children[0]);

    const id = nextId();
    let profile = fallback;
    if (node.profile) {
      const found = findProfile(profiles, node.profile);
      if (found) profile = found;
      else unknownProfiles.push(node.profile);
    }
    panes.push({ id, profileId: profile.id, profileName: profile.name, title: "", cwd: node.cwd ?? undefined });
    if (node.command) commands.set(id, node.command);
    return { kind: "leaf", pane: id };
  };

  return { root: build(def), panes, commands, unknownProfiles };
}

/** The tab as a layout: splits, profiles and folders. Sizes and commands aren't kept. */
export function layoutFromTab(ws: Workspace, tab: Tab, name: string): LayoutDef {
  const describe = (node: LayoutNode): LayoutPane => {
    if (node.kind === "split") return { split: node.dir, panes: node.children.map(describe) };
    const pane = ws.panes[node.pane];
    return { profile: pane.profileId, ...(pane.cwd ? { cwd: pane.cwd } : {}) };
  };
  return { name, ...describe(tab.root) };
}
