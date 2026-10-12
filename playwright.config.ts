import { defineConfig } from "@playwright/test";

// End-to-end tests drive the real app (see e2e/qterm.ts and e2e/README.md).
export default defineConfig({
  testDir: "e2e",
  // One app instance at a time: a single debugging port, a single app identifier.
  workers: 1,
  fullyParallel: false,
  // Starting the app (WebView2 + shells) takes seconds; restarts happen inside tests.
  timeout: 120_000,
  expect: { timeout: 15_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  globalSetup: "./e2e/global-setup.ts",
  // The debug build loads its UI from the Vite dev server.
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:1420",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
