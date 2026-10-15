// Risk R29 (e2e/README.md): pasting with an image on the clipboard types the path of a
// PNG file holding that image (Windows clipboard → Rust → PNG in the temp folder → the
// path at the prompt).
import { execFileSync } from "node:child_process";

import { expect, test } from "./qterm";

test("pasting a clipboard image types the path of a PNG holding it", async ({ qterm }) => {
  const marker = Date.now() % 100_000;
  // An image of a size no other test makes, on the clipboard as a screenshot tool puts it.
  const width = 3 + (marker % 7);
  execFileSync("pwsh", [
    "-NoProfile",
    "-STA",
    "-Command",
    `Add-Type -AssemblyName System.Windows.Forms, System.Drawing; $b = New-Object System.Drawing.Bitmap ${width}, 2; $b.SetPixel(0, 0, [System.Drawing.Color]::Red); [System.Windows.Forms.Clipboard]::SetImage($b)`,
  ]);

  const pane = await qterm.activePane();
  await qterm.waitForPrompt(pane);
  const input = qterm.pane(pane).getByRole("textbox", { name: "Terminal input" });
  await input.focus();

  // The pasted path goes inside a command that opens the file as an image and prints its size.
  await qterm.page.keyboard.insertText("Add-Type -AssemblyName System.Drawing; $i = [System.Drawing.Image]::FromFile((Resolve-Path ");
  await qterm.page.keyboard.press("Control+Shift+V");
  await expect.poll(() => qterm.terminalText(pane)).toMatch(/qterm-images\\pasted-\d+\.png/);
  await qterm.page.keyboard.insertText(`)); "image-$($i.Width)x$($i.Height)-${marker}"`);
  await qterm.page.keyboard.press("Enter");

  await expect.poll(() => qterm.terminalText(pane)).toContain(`image-${width}x2-${marker}`);
});
