# E2E testing rules (qterm)

Read before writing or changing a spec. `seed.spec.ts` shows every rule in practice.

- **One risk per spec**, named after it: `test("a restart brings back the tab, its
  folder and its output", ...)`, not `test("restore works", ...)`. The risks are in
  `README.md`; add the risk there first.
- **Assert the user's outcome, and make it fail when the risk comes true.** Check with a
  deliberate break: break the behaviour the spec protects, see it go red, undo the break.
- **Locators:** `getByRole`, `getByLabel`, `getByText` first. `getByTestId` only where
  roles are ambiguous: each pane holds an identical "Terminal input" textbox, so a pane is
  `qterm.pane(id)` (its test id is the pane id). Never CSS selectors, XPath or DOM
  structure.
- **Terminal text** is drawn on a canvas, so read it with `qterm.terminalText(paneId)`
  (the dev-only hook) and wait with `expect.poll(...)`. Make the expected text something
  only the shell can produce (a computed value), so the echo of the typed command can't
  satisfy the check.
- **Never `page.waitForTimeout()` or sleeps.** Wait for state: `toBeVisible()`,
  `toHaveCount()`, `expect.poll(...)`, `qterm.waitForPrompt(...)`.
- **Independent tests.** The `qterm` fixture gives each test a fresh app with wiped
  state; set settings with `test.use({ settings: { values: { key: "value" } } })`.
  Anything a test creates outside the app (folders, files) gets a unique name
  (`Date.now()`) and is removed in a `finally` block.
- **Real boundaries.** UI, Rust, ConPTY, the shell and the files on disk are all real.
  Don't stub `invoke`; only use it to reach what a user would do through the OS (the
  tray, quitting), never to set up the state the test is about.
