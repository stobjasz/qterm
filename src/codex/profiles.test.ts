import { expect, it } from "vitest";
import type { Profile } from "../ipc";
import { sessionProfile } from "./profiles";
const native: Profile = { id: "ps", name: "PowerShell", kind: "powershell" };
const wsl: Profile = { id: "wsl:ubuntu", name: "Ubuntu", kind: "wsl" };
const custom: Profile = { id: "python", name: "Python", kind: "other" };

it("selects a compatible shell for native, UNC and WSL session folders", () => {
  const profiles = [custom, wsl, native];
  expect(sessionProfile(profiles, wsl, "C:\\work", wsl.id)).toBe(native);
  expect(sessionProfile(profiles, native, "/home/me/app", native.id)).toBe(wsl);
  expect(sessionProfile(profiles, wsl, "\\\\server\\share")).toBe(native);
  expect(sessionProfile([custom, wsl], wsl, "C:\\work")).toBeUndefined();
});
