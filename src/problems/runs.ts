import { parseDiagnostics, MAX_DIAGNOSTIC_OUTPUT, type Diagnostics } from "./diagnostics";
import { limitText } from "../text";
import type { RecordedCommandRun, VerificationEvidence, ShellKind, AgentRequester } from "../ipc";

export interface CommandRun {
  environment?: string | null;
  requester?: AgentRequester | null;
  id: string;
  paneId: string;
  profileId?: string;
  shellKind?: ShellKind | null;
  appRunId?: string | null;
  cwd?: string;
  command: string;
  commandTruncated?: boolean;
  exitCode?: number;
  startedAt: number;
  finishedAt: number;
  output: string;
  outputTruncated: boolean;
  diagnostics: Diagnostics;
  verification?: VerificationEvidence | null;
  verificationPending?: boolean;
}
export type RunInput = Omit<CommandRun, "id" | "diagnostics" | "outputTruncated"> & { outputTruncated?: boolean };
export function commandRun(input: RunInput): CommandRun {
  const command = limitText(input.command, 16_000);
  const output = limitText(input.output, MAX_DIAGNOSTIC_OUTPUT);
  const diagnostics = parseDiagnostics(output, input.command);
  const outputTruncated = !!input.outputTruncated || input.output.length > output.length;
  return { ...input, command, commandTruncated: !!input.commandTruncated || command.length !== input.command.length, id: crypto.randomUUID(), output, outputTruncated, diagnostics: { ...diagnostics, truncated: diagnostics.truncated || outputTruncated } };
}
export const MAX_RUNS = 100;
export function restoreRun(record: RecordedCommandRun): CommandRun {
  const diagnostics = parseDiagnostics(record.output, record.command);
  return { ...record, cwd: record.cwd ?? undefined, profileId: record.profileId ?? undefined, exitCode: record.exitCode ?? undefined, diagnostics: { ...diagnostics, truncated: record.outputTruncated || diagnostics.truncated } };
}
export function addRun(runs: readonly CommandRun[], run: CommandRun): CommandRun[] { return [run, ...runs.filter((old) => old.id !== run.id)].slice(0, MAX_RUNS); }
/** Latest per exact command, folder and shell. Older results stay available in history. */
export function latestRuns(runs: readonly CommandRun[]): CommandRun[] {
  const seen = new Set<string>();
  return runs.filter((run) => {
    const key = JSON.stringify(run.commandTruncated ? [run.id] : [run.command, run.cwd, run.profileId]);
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
}
