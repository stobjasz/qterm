import { describe, expect, it } from "vitest";

import { manifest } from "./release-manifest.mjs";

describe("release manifest", () => {
  const release = {
    version: "0.2.0",
    repo: "stobjasz/qterm",
    pubDate: "2026-10-12T10:00:00Z",
    setup: { name: "qterm_0.2.0_x64-setup.exe", signature: "c2V0dXA=\n" },
    portable: { name: "qterm-0.2.0-portable-x64.exe", signature: "cG9ydGFibGU=\n" },
  };

  it("points installed copies at the installer and portable exes at the exe", () => {
    const json = manifest(release);
    expect(json.version).toBe("0.2.0");
    expect(json.platforms["windows-x86_64-nsis"]).toEqual({
      signature: "c2V0dXA=",
      url: "https://github.com/stobjasz/qterm/releases/download/v0.2.0/qterm_0.2.0_x64-setup.exe",
    });
    expect(json.platforms["windows-x86_64"]).toEqual(json.platforms["windows-x86_64-nsis"]);
    expect(json.platforms["windows-x86_64-portable"]).toEqual({
      signature: "cG9ydGFibGU=",
      url: "https://github.com/stobjasz/qterm/releases/download/v0.2.0/qterm-0.2.0-portable-x64.exe",
    });
  });

  it("links the release page when there are no notes, with an RFC 3339 date", () => {
    const json = manifest({ ...release, pubDate: undefined });
    expect(json.notes).toBe("https://github.com/stobjasz/qterm/releases/tag/v0.2.0");
    expect(json.pub_date).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });
});
