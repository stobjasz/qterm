// Risk R32 (e2e/README.md): a dev server's "Local: http://localhost:<port>/" line gives
// its tab an Open button, which goes away once the server stops listening (output line
// check → tab; Rust reads the TCP table to see the port is still in use).
import { expect, test } from "./qterm";

test("a dev server's address becomes an Open button on its tab while it listens", async ({ qterm }) => {
  const pane = await qterm.activePane();
  await qterm.waitForPrompt(pane);
  // A real server on a free port, announcing itself the way Vite does.
  await qterm.run(
    pane,
    `node -e "const s = require('http').createServer((q, r) => r.end('ok')).listen(0, '127.0.0.1', () => console.log('  Local:   http://localhost:' + s.address().port + '/'))"`,
  );
  await expect.poll(() => qterm.terminalText(pane)).toMatch(/Local: {3}http:\/\/localhost:\d+\//);
  const port = /Local: {3}http:\/\/localhost:(\d+)\//.exec(await qterm.terminalText(pane))![1];

  const tab = qterm.page.getByRole("tab").first();
  const open = tab.getByRole("button", { name: `Open http://localhost:${port}/` });
  await expect(open).toBeVisible();

  // Ctrl+C stops it: the button goes with it.
  await qterm.pane(pane).getByRole("textbox", { name: "Terminal input" }).focus();
  await qterm.page.keyboard.press("Control+C");
  // Right away, not at the next check of the ports.
  await expect(open).toBeHidden({ timeout: 5000 });
});
