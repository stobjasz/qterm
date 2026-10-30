import type { ClaudeAlert } from "../ipc";

/** Approval-routing hooks do not prove that a human-facing prompt exists. */
export class AlertNotifications {
  private recent = new Map<string, number>();
  allow(alert: ClaudeAlert, now = Date.now()): boolean {
    if (alert.kind === "codex:approval" || alert.kind === "codex:permission") return false;
    if (alert.kind === "codex:reply" && !alert.message.trim()) return false;
    const key = JSON.stringify([alert.paneId, alert.sessionId, alert.kind, alert.title, alert.message]);
    const previous = this.recent.get(key);
    if (previous !== undefined && now - previous >= 0 && now - previous < 30_000) return false;
    for (const [old, at] of this.recent) if (now - at >= 30_000 || now < at) this.recent.delete(old);
    if (this.recent.size >= 256) this.recent.delete(this.recent.keys().next().value!);
    this.recent.set(key, now); return true;
  }
}
