// Writes latest.json, the feed qterm's updater reads from the newest GitHub release.
//
//   node scripts/release-manifest.mjs --version 0.2.0 --repo stobjasz/qterm \
//     --setup <qterm_0.2.0_x64-setup.exe> --portable <qterm-0.2.0-portable-x64.exe> --out latest.json
//
// Each file needs its minisign signature next to it (<file>.sig). Installed copies
// read the `windows-x86_64-nsis` entry (the installer), portable exes the
// `windows-x86_64-portable` entry (the bare exe they swap themselves for).
import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";

/**
 * @param {{ version: string; repo: string; notes?: string; pubDate?: string;
 *   setup: { name: string; signature: string }; portable: { name: string; signature: string } }} release
 */
export function manifest({ version, repo, notes, pubDate, setup, portable }) {
  const tag = `v${version}`;
  const url = (name) => `https://github.com/${repo}/releases/download/${tag}/${encodeURIComponent(name)}`;
  const installer = { signature: setup.signature.trim(), url: url(setup.name) };
  return {
    version,
    notes: notes ?? `https://github.com/${repo}/releases/tag/${tag}`,
    pub_date: pubDate ?? new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    platforms: {
      "windows-x86_64-nsis": installer,
      // Older updater lookups fall back to the bare os-arch key.
      "windows-x86_64": installer,
      "windows-x86_64-portable": { signature: portable.signature.trim(), url: url(portable.name) },
    },
  };
}

function main() {
  const { values } = parseArgs({
    options: {
      version: { type: "string" },
      repo: { type: "string" },
      notes: { type: "string" },
      setup: { type: "string" },
      portable: { type: "string" },
      out: { type: "string" },
    },
  });
  for (const name of ["version", "repo", "setup", "portable", "out"]) {
    if (!values[name]) throw new Error(`--${name} is required`);
  }
  const asset = (path) => ({ name: basename(path), signature: readFileSync(`${path}.sig`, "utf8") });
  const json = manifest({
    version: values.version,
    repo: values.repo,
    notes: values.notes,
    setup: asset(values.setup),
    portable: asset(values.portable),
  });
  writeFileSync(values.out, JSON.stringify(json, null, 2) + "\n");
  console.log(`wrote ${values.out} for ${values.version}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
