// Dev servers announce where they listen ("Local: http://localhost:5173/"): such a line
// gives the tab an Open button while the server runs.

export interface DevServerUrl {
  /** What to open: 0.0.0.0 and [::] mean "every address", opened as localhost. */
  url: string;
  port: number;
}

// A local address with a port: localhost (and *.localhost), the loopback addresses, or
// "every address" (0.0.0.0, [::]). Addresses on the network aren't dev servers of yours.
const LOCAL_URL = /\bhttps?:\/\/(localhost|[a-z0-9-]+\.localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\]):(\d{2,5})(\/[^\s'"<>`]*)?/i;

/** The local server address a line of output announces, if any. */
export function findDevServerUrl(line: string): DevServerUrl | undefined {
  const match = LOCAL_URL.exec(line);
  if (!match) return undefined;
  const port = Number(match[2]);
  if (port < 1 || port > 65_535) return undefined;
  const host = /^(0\.0\.0\.0|\[::\])$/.test(match[1]) ? "localhost" : match[1].toLowerCase();
  // Punctuation that ends a sentence isn't part of the address.
  const path = (match[3] ?? "/").replace(/[.,;:!?)\]]+$/, "") || "/";
  const scheme = match[0].slice(0, match[0].indexOf(":")).toLowerCase();
  return { url: `${scheme}://${host}:${port}${path}`, port };
}
