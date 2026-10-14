// Writes the winget manifests for a release (winget/manifests/s/stobjasz/qterm/<version>/),
// laid out as microsoft/winget-pkgs expects. The installer's checksum comes from the
// release's SHA256SUMS.
//
//   node scripts/winget-manifests.mjs 0.2.1
//
// Later releases are submitted by the release workflow (winget-releaser), which
// copies these fields from the previous version; this script made the first one.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const IDENTIFIER = "stobjasz.qterm";
const REPO = "https://github.com/stobjasz/qterm";
const SCHEMA = "1.10.0";

/** The three manifests for `version`, keyed by file name. */
export function manifests({ version, sha256, releaseDate }) {
  const head = (type) =>
    `# yaml-language-server: $schema=https://aka.ms/winget-manifest.${type}.${SCHEMA}.schema.json\n\nPackageIdentifier: ${IDENTIFIER}\nPackageVersion: ${version}\n`;
  const tail = (type) => `ManifestType: ${type}\nManifestVersion: ${SCHEMA}\n`;
  const setup = `${REPO}/releases/download/v${version}/qterm_${version}_x64-setup.exe`;
  return {
    [`${IDENTIFIER}.yaml`]: `${head("version")}DefaultLocale: en-US\n${tail("version")}`,
    [`${IDENTIFIER}.installer.yaml`]:
      head("installer") +
      `InstallerLocale: en-US
InstallerType: nullsoft
Scope: user
InstallModes:
- interactive
- silent
- silentWithProgress
UpgradeBehavior: install
ReleaseDate: ${releaseDate}
AppsAndFeaturesEntries:
- DisplayName: qterm
  Publisher: Sebastian Tobjasz
Installers:
- Architecture: x64
  InstallerUrl: ${setup}
  InstallerSha256: ${sha256.toUpperCase()}
` +
      tail("installer"),
    [`${IDENTIFIER}.locale.en-US.yaml`]:
      head("defaultLocale") +
      `PackageLocale: en-US
Publisher: Sebastian Tobjasz
PublisherUrl: https://github.com/stobjasz
PublisherSupportUrl: ${REPO}/issues
PackageName: qterm
PackageUrl: ${REPO}
License: MIT
LicenseUrl: ${REPO}/blob/master/LICENSE
ShortDescription: A quake-style drop-down terminal for Windows
Description: |-
  qterm slides a translucent console down from the top of the screen when you press the
  key left of 1 (~). It runs PowerShell, Command Prompt, Git Bash, WSL and SSH hosts in tabs
  and split panes, reopens your tabs with their output after a restart, and has extras for
  Claude Code: session tracking, alerts when Claude waits for you, and context and cost per tab.
Moniker: qterm
Tags:
- claude-code
- conpty
- console
- drop-down
- quake
- terminal
ReleaseNotesUrl: ${REPO}/releases/tag/v${version}
` +
      tail("defaultLocale"),
  };
}

async function main() {
  const version = process.argv[2];
  if (!/^\d+\.\d+\.\d+$/.test(version ?? "")) throw new Error("usage: node scripts/winget-manifests.mjs <version>");
  const sums = await (await fetch(`${REPO}/releases/download/v${version}/SHA256SUMS`)).text();
  const sha256 = sums.split("\n").find((line) => line.trim().endsWith(`qterm_${version}_x64-setup.exe`))?.split(/\s+/)[0];
  if (!sha256) throw new Error(`no installer checksum in v${version}'s SHA256SUMS`);
  const release = await (await fetch(`https://api.github.com/repos/stobjasz/qterm/releases/tags/v${version}`)).json();
  const releaseDate = String(release.published_at ?? new Date().toISOString()).slice(0, 10);
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const dir = join(root, "winget", "manifests", "s", "stobjasz", "qterm", version);
  mkdirSync(dir, { recursive: true });
  for (const [name, text] of Object.entries(manifests({ version, sha256, releaseDate }))) writeFileSync(join(dir, name), text);
  console.log(dir);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
