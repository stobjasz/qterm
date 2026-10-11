// Files dropped on a pane are typed at its prompt as paths the shell understands,
// quoted only when needed (a bare path can still be run as a command).
import type { ShellKind } from "../ipc";

/** Characters no shell treats specially, so a path made of them needs no quotes. */
const SAFE = /^[\p{L}\p{N}_\-.:\\/+]+$/u;

/** The text to type for these paths: shell paths, space-separated, with a trailing space. */
export function dropText(paths: string[], shell: ShellKind): string {
  return paths.map((path) => quote(shellPath(path, shell), shell)).join(" ") + " ";
}

/** A Windows path as this shell spells it. */
export function shellPath(path: string, shell: ShellKind): string {
  if (shell === "bash") {
    // Git Bash: C:\dir → /c/dir, \\server\share → //server/share.
    const drive = /^([A-Za-z]):[\\/]?(.*)$/.exec(path);
    if (drive) return `/${drive[1].toLowerCase()}/${slashes(drive[2])}`.replace(/\/$/, "") || "/";
    return slashes(path);
  }
  if (shell === "wsl") {
    const drive = /^([A-Za-z]):[\\/]?(.*)$/.exec(path);
    if (drive) return `/mnt/${drive[1].toLowerCase()}/${slashes(drive[2])}`.replace(/\/$/, "");
    // A file inside a distro, as Explorer shows it.
    const distro = /^\\\\wsl(?:\$|\.localhost)\\[^\\]+(\\.*)?$/i.exec(path);
    if (distro) return slashes(distro[1] ?? "") || "/";
  }
  return path;
}

function quote(path: string, shell: ShellKind): string {
  if (SAFE.test(path)) return path;
  switch (shell) {
    case "powershell":
      // Single quotes take everything literally; PowerShell also counts the curly ones.
      return `'${path.replace(/['‘’‚‛]/g, "$&$&")}'`;
    case "bash":
    case "wsl":
      return `'${path.replace(/'/g, `'\\''`)}'`;
    default:
      // cmd and anything else: Windows file names can't contain a double quote.
      return `"${path}"`;
  }
}

function slashes(path: string): string {
  return path.replace(/\\/g, "/");
}
