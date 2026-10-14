import { describe, expect, it } from "vitest";

import { IDENTIFIER, manifests } from "./winget-manifests.mjs";

describe("winget manifests", () => {
  const files = manifests({ version: "0.2.1", sha256: "ab12", releaseDate: "2026-10-14" });

  it("has the version, installer and default locale manifests", () => {
    expect(Object.keys(files).sort()).toEqual([`${IDENTIFIER}.installer.yaml`, `${IDENTIFIER}.locale.en-US.yaml`, `${IDENTIFIER}.yaml`]);
    for (const text of Object.values(files)) {
      expect(text).toContain(`PackageIdentifier: ${IDENTIFIER}\nPackageVersion: 0.2.1\n`);
      expect(text).toMatch(/ManifestVersion: \d+\.\d+\.\d+\n$/);
    }
  });

  it("points at the per-user NSIS installer of that release", () => {
    const installer = files[`${IDENTIFIER}.installer.yaml`];
    expect(installer).toContain("InstallerType: nullsoft\nScope: user\n");
    expect(installer).toContain("InstallerUrl: https://github.com/stobjasz/qterm/releases/download/v0.2.1/qterm_0.2.1_x64-setup.exe\n");
    expect(installer).toContain("InstallerSha256: AB12\n");
    expect(installer).toContain("ReleaseDate: 2026-10-14\n");
  });
});
