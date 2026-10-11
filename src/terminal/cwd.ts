// Shells can announce their working directory with escape sequences; qterm's
// shell integration (Rust, pty/profiles.rs) makes PowerShell and cmd send OSC 9;9.

/** OSC 7: `file://host/path`. Windows drive paths come back with backslashes. */
export function parseOsc7(data: string): string | undefined {
  let url: URL;
  try {
    url = new URL(data);
  } catch {
    return undefined;
  }
  if (url.protocol !== "file:") return undefined;
  const path = decodeURIComponent(url.pathname);
  const drive = /^\/([A-Za-z]:)(\/.*)?$/.exec(path);
  return drive ? drive[1] + (drive[2] ?? "\\").replace(/\//g, "\\") : path;
}

/** OSC 9;9 (Windows Terminal): `9;"C:\path"` or `9;C:\path`. Other OSC 9 uses are ignored. */
export function parseOsc9(data: string): string | undefined {
  if (!data.startsWith("9;")) return undefined;
  const path = data.slice(2).replace(/^"(.*)"$/, "$1");
  return path || undefined;
}
