// Resuming a Claude Code session in the pane you're in: go to its folder, then
// `claude --resume <id>`, spelled for that pane's shell.
import type { ShellKind } from "../ipc";
import { shellPath, shellQuote } from "../terminal/drop";

/**
 * What to type (without Enter), or undefined when this shell can't do it: a custom
 * program (ssh, python), or a folder on the other side of WSL.
 */
export function resumeHereCommand(sessionId: string, cwd: string | null, shell: ShellKind, provider: "claude" | "codex" = "claude"): string | undefined {
  if (provider === "codex" && !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(sessionId)) return undefined;
  const resume = provider === "codex" ? `codex --no-daemon resume ${sessionId}` : `claude --resume ${sessionId}`;
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
