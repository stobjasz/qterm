// Drives the real qterm app (Tauri + WebView2) from Playwright: a debug build with its
// own identifier (dev.qterm.e2e: own settings, data and single-instance key, so it
// never touches an installed qterm) loads the UI from the Vite dev server, and
// WebView2's remote debugging port lets Playwright attach over CDP.
//
// Every test gets a fresh instance: state is wiped, settings written, the app
// started, and at the end stopped together with every shell it ran.
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium, expect, test as base, type Browser, type Locator, type Page } from "@playwright/test";

export const IDENTIFIER = "dev.qterm.e2e";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const EXE = path.join(ROOT, "src-tauri", "target", "e2e", "debug", "qterm.exe");
const CDP_PORT = 9333;
/** The app's own output (stdout and stderr), kept with the test results. */
const APP_LOG = path.join(ROOT, "test-results", "qterm-app.log");
const CONFIG_DIR = path.join(process.env.APPDATA ?? "", IDENTIFIER);
const LOCAL_DIR = path.join(process.env.LOCALAPPDATA ?? "", IDENTIFIER);
const DEFAULT_SETTINGS = fs.readFileSync(path.join(ROOT, "src-tauri", "src", "config", "default.toml"), "utf8");

/** Top-level settings to change (TOML values, e.g. `"1"` or `'"mica"'`) and extra tables to add. */
export interface Settings {
  values?: Record<string, string>;
  extra?: string;
}

/** The app's dev-only test hook (src/App.tsx): the live workspace and terminals. */
interface Hook {
  workspace(): {
    activeTab?: string;
    tabs: { id: string; focusedPane: string; root: unknown }[];
    panes: Record<string, { id: string; cwd?: string; profileId: string }>;
  };
  registry: {
    entries: Map<
      string,
      {
        term: {
          options: { fontSize?: number };
          buffer: { normal: { length: number; getLine(y: number): { translateToString(trim: boolean): string } | undefined } };
        };
      }
    >;
  };
}
declare global {
  interface Window {
    __qterm?: Hook;
  }
}

export class Qterm {
  private process?: ChildProcess;
  private browser?: Browser;
  page!: Page;

  /** Starts with a clean slate: no saved tabs, output or remembered sessions. */
  static async launch(settings: Settings = {}): Promise<Qterm> {
    wipeState();
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(path.join(CONFIG_DIR, "config.toml"), settingsFile(settings));
    const qterm = new Qterm();
    await qterm.start();
    return qterm;
  }

  /** Starts the app (keeping whatever it saved before) and waits until its UI is up. */
  async start(): Promise<void> {
    fs.mkdirSync(path.dirname(APP_LOG), { recursive: true });
    const logFd = fs.openSync(APP_LOG, "a");
    fs.writeSync(logFd, `\n--- qterm started ${new Date().toISOString()}\n`);
    const child = spawn(EXE, [], {
      env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${CDP_PORT}` },
      stdio: ["ignore", logFd, logFd],
    });
    fs.closeSync(logFd);
    this.process = child;
    // Up within a minute, or a clear reason: an app that quit says so at once.
    const deadline = Date.now() + 60_000;
    while (!(await cdpReady())) {
      if (child.exitCode !== null) throw new Error(`qterm quit during start-up (exit code ${child.exitCode}); its output is in ${APP_LOG}`);
      if (Date.now() > deadline) throw new Error(`qterm's WebView2 debugging port didn't open within a minute; its output is in ${APP_LOG}`);
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    log("debugging port open");
    this.browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`);
    const context = this.browser.contexts()[0];
    const appPage = () => context.pages().find((p) => p.url().startsWith("http://localhost:1420"));
    await expect.poll(() => Boolean(appPage()), { timeout: 60_000, message: "qterm's page" }).toBe(true);
    this.page = appPage()!;
    log("page found");
    await this.page.waitForFunction(() => (window.__qterm?.workspace().tabs.length ?? 0) > 0, null, { timeout: 60_000 });
    log("workspace ready");
    await expect(this.page.getByRole("tablist", { name: "Terminal tabs" })).toBeVisible();
  }

  /** Quits the way Tray → Quit does: the UI saves tabs and output first. */
  async quit(): Promise<void> {
    const exited = new Promise<void>((resolve) => this.process?.once("exit", () => resolve()));
    await this.invoke("plugin:event|emit_to", { target: { kind: "Webview", label: "quake" }, event: "quit-requested", payload: null });
    await exited;
    await this.browser?.close().catch(() => {});
    this.process = undefined;
    await expect.poll(cdpReady, { message: "the debugging port to close" }).toBe(false);
  }

  /** Quit and start again: what a user's restart looks like. */
  async restart(): Promise<void> {
    await this.quit();
    await this.start();
  }

  /** Ends the app and every shell under it, whatever state it is in. */
  async stop(): Promise<void> {
    await this.browser?.close().catch(() => {});
    if (this.process?.pid && this.process.exitCode === null) {
      try {
        execFileSync("taskkill", ["/PID", String(this.process.pid), "/T", "/F"], { stdio: "ignore" });
      } catch {
        // Already gone.
      }
    }
    this.process = undefined;
    await expect.poll(cdpReady, { message: "the debugging port to close" }).toBe(false);
  }

  invoke<T = unknown>(command: string, args?: Record<string, unknown>): Promise<T> {
    return this.page.evaluate(
      ([command, args]) => (window as unknown as { __TAURI_INTERNALS__: { invoke(c: string, a?: unknown): Promise<unknown> } }).__TAURI_INTERNALS__.invoke(command, args),
      [command, args] as const,
    ) as Promise<T>;
  }

  /** The focused pane of the active tab. */
  activePane(): Promise<string> {
    return this.page.evaluate(() => {
      const ws = window.__qterm!.workspace();
      return ws.tabs.find((t) => t.id === ws.activeTab)!.focusedPane;
    });
  }

  workspace(): Promise<ReturnType<Hook["workspace"]>> {
    return this.page.evaluate(() => window.__qterm!.workspace());
  }

  /** A pane on screen. */
  pane(paneId: string): Locator {
    return this.page.getByTestId(paneId);
  }

  /**
   * Everything the pane's terminal shows, scrollback included. The renderer draws
   * on a canvas, so the text is read from the terminal itself (dev-only hook).
   */
  terminalText(paneId: string): Promise<string> {
    return this.page.evaluate((paneId) => {
      const buffer = window.__qterm!.registry.entries.get(paneId)?.term.buffer.normal;
      if (!buffer) return "";
      const lines: string[] = [];
      for (let y = 0; y < buffer.length; y++) lines.push(buffer.getLine(y)?.translateToString(true) ?? "");
      return lines.join("\n");
    }, paneId);
  }

  /** The font size the pane's terminal draws with. */
  fontSize(paneId: string): Promise<number | undefined> {
    return this.page.evaluate((paneId) => window.__qterm!.registry.entries.get(paneId)?.term.options.fontSize, paneId);
  }

  /** Waits until the pane's shell shows a prompt (PowerShell, the default shell here). */
  async waitForPrompt(paneId: string): Promise<void> {
    await expect.poll(() => this.terminalText(paneId), { timeout: 30_000, message: `a prompt in ${paneId}` }).toMatch(/PS [^\n]*>/);
  }

  /** Types a command into the pane, as a user would, and presses Enter. */
  async run(paneId: string, command: string): Promise<void> {
    await this.pane(paneId).getByRole("textbox", { name: "Terminal input" }).focus();
    await this.page.keyboard.insertText(command);
    await this.page.keyboard.press("Enter");
  }

  /** The settings file as the app has it on disk. */
  settingsOnDisk(): string {
    return fs.readFileSync(path.join(CONFIG_DIR, "config.toml"), "utf8");
  }
}

/** The documented defaults, with the given top-level values changed and tables added. */
function settingsFile({ values = {}, extra = "" }: Settings): string {
  let text = DEFAULT_SETTINGS;
  for (const [key, value] of Object.entries(values)) {
    const line = new RegExp(`^${key} = .*$`, "m");
    if (!line.test(text)) throw new Error(`no top-level setting "${key}" in default.toml`);
    text = text.replace(line, `${key} = ${value}`);
  }
  return `${text}\n${extra}\n`;
}

/** Removes what an earlier run saved; WebView2's cache and the extracted ConPTY stay. */
function wipeState(): void {
  fs.rmSync(CONFIG_DIR, { recursive: true, force: true });
  for (const dir of ["scrollback", "alerts"]) fs.rmSync(path.join(LOCAL_DIR, dir), { recursive: true, force: true });
}

/** Startup steps, with QTERM_E2E_DEBUG=1. */
function log(step: string): void {
  if (process.env.QTERM_E2E_DEBUG) console.log(`[qterm] ${step}`);
}

async function cdpReady(): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`, { signal: AbortSignal.timeout(1000) });
    return response.ok;
  } catch {
    return false;
  }
}

export const test = base.extend<{ settings: Settings; qterm: Qterm }>({
  settings: [{}, { option: true }],
  qterm: async ({ settings }, use) => {
    const qterm = await Qterm.launch(settings);
    try {
      await use(qterm);
    } finally {
      await qterm.stop();
      wipeState();
    }
  },
});

export { expect };
