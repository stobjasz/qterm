// Risk R33 (e2e/README.md): the palette names the process listening on a port and the
// pane it runs in, and ending it frees the port while the pane's shell stays (Rust reads
// the TCP table and the process tree → palette → dialog → the process ends).
import net from "node:net";

import { expect, test } from "./qterm";

/** Whether something accepts connections on the port. */
function listening(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: "127.0.0.1" });
    socket.once("connect", () => (socket.destroy(), resolve(true)));
    socket.once("error", () => resolve(false));
  });
}

test("the palette names who listens on a port, in which pane, and can end it", async ({ qterm }) => {
  const pane = await qterm.activePane();
  await qterm.waitForPrompt(pane);
  await qterm.run(pane, `node -e "const s = require('net').createServer().listen(0, '127.0.0.1', () => console.log('port=' + s.address().port))"`);
  await expect.poll(() => qterm.terminalText(pane)).toMatch(/^port=\d+$/m);
  const port = Number(/^port=(\d+)$/m.exec(await qterm.terminalText(pane))![1]);
  expect(await listening(port)).toBe(true);

  await qterm.page.keyboard.press("Control+Shift+P");
  const palette = qterm.page.getByRole("dialog", { name: "Command palette" });
  await palette.getByRole("combobox", { name: "Command" }).fill(`port ${port}`);
  await palette.getByRole("option", { name: new RegExp(`^Port\\s*${port} node\\s*1 · `) }).click();

  const dialog = qterm.page.getByRole("alertdialog", { name: `Port ${port}` });
  await expect(dialog).toContainText(`node (process`);
  await expect(dialog).toContainText(`in the pane 1 · `);
  await dialog.getByRole("button", { name: "End node" }).click();
  await expect(dialog).toBeHidden();

  // The port is free and the shell is back at its prompt, ready for the next command.
  await expect.poll(() => listening(port)).toBe(false);
  const marker = Date.now() % 100_000;
  await qterm.run(pane, `Write-Output "still-$(${marker} + 1)"`);
  await expect.poll(() => qterm.terminalText(pane)).toContain(`still-${marker + 1}`);
});
