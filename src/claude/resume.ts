// Resuming a Claude Code session in the pane you're in: go to its folder, then
// `claude --resume <id>`, spelled for that pane's shell.
import type { ShellKind } from "../ipc";
import { shellPath, shellQuote } from "../terminal/drop";

/**
 * What to type (without Enter), or undefined when this shell can't do it: a custom
 * program (ssh, python), or a folder on the other side of WSL.
 */
export function resumeHereCommand(sessionId: string, cwd: string | null, shell: ShellKind): string | undefined {
  const resume = `claude --resume ${sessionId}`;
  if (shell === "other") return undefined;
  if (!cwd) return resume;
  // A session started in WSL lives in WSL's Claude Code, and the other way round.
  const windowsFolder = /^[A-Za-z]:[\\/]/.test(cwd);
  if (windowsFolder === (shell === "wsl")) return undefined;
  const folder = shellQuote(shellPath(cwd, shell), shell);
  switch (shell) {
    case "powershell":
      return `cd ${folder}; ${resume}`;
    case "cmd":
      return `cd /d ${folder} && ${resume}`;
    default:
      return `cd ${folder} && ${resume}`;
  }
}
