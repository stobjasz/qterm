import { describe, expect, it } from "vitest";

import { findDevServerUrl } from "./devServer";

describe("findDevServerUrl", () => {
  it.each([
    ["  ➜  Local:   http://localhost:5173/", "http://localhost:5173/", 5173],
    ["   - Local:        http://localhost:3000", "http://localhost:3000/", 3000],
    ["Starting development server at http://127.0.0.1:8000/", "http://127.0.0.1:8000/", 8000],
    [" * Running on http://127.0.0.1:5000 (Press CTRL+C to quit)", "http://127.0.0.1:5000/", 5000],
    ["info: Now listening on: https://localhost:7001", "https://localhost:7001/", 7001],
    ["Server running at http://0.0.0.0:8080/app.", "http://localhost:8080/app", 8080],
    ["Loopback: http://[::1]:4200/", "http://[::1]:4200/", 4200],
    ["Open http://myapp.localhost:1355/ in a browser", "http://myapp.localhost:1355/", 1355],
  ])("finds the address in %j", (line, url, port) => {
    expect(findDevServerUrl(line)).toEqual({ url, port });
  });

  it("ignores addresses on the network, addresses without a port and plain text", () => {
    expect(findDevServerUrl("   - Network:      http://192.168.1.20:3000")).toBeUndefined();
    expect(findDevServerUrl("Docs: https://vitejs.dev/config")).toBeUndefined();
    expect(findDevServerUrl("see http://localhost/ for details")).toBeUndefined();
    expect(findDevServerUrl("compiled in 320 ms")).toBeUndefined();
    expect(findDevServerUrl("http://localhost:99999")).toBeUndefined();
  });
});
