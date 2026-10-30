import { expect, it } from "vitest";
import type { ClaudeAlert } from "../ipc";
import { AlertNotifications } from "./notifications";
const alert: ClaudeAlert = { paneId: "pane", sessionId: "session", kind: "codex:reply", title: "Codex turn completed", message: "Finished the check." };
it("never turns unconfirmed Codex approval routing into a desktop question", () => {
  const gate = new AlertNotifications();
  expect(gate.allow({ ...alert, kind: "codex:approval" })).toBe(false);
  expect(gate.allow({ ...alert, kind: "codex:permission" })).toBe(false);
  expect(gate.allow({ ...alert, message: "  " })).toBe(false);
  expect(gate.allow({ ...alert, kind: "permission_prompt", title: "Claude permission" })).toBe(true);
});
it("deduplicates equivalent alerts while allowing changed messages, sessions and later turns", () => {
  const gate = new AlertNotifications();
  expect(gate.allow(alert, 1000)).toBe(true);
  expect(gate.allow(alert, 1001)).toBe(false);
  expect(gate.allow({ ...alert, message: "Different result" }, 1002)).toBe(true);
  expect(gate.allow({ ...alert, sessionId: "other" }, 1003)).toBe(true);
  expect(gate.allow(alert, 31000)).toBe(true);
});
