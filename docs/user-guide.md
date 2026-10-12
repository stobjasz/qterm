# qterm user guide

qterm is a drop-down terminal for Windows 11. Press **~** (the key left of 1) and a
translucent console slides down from the top of the screen; press it again and it slides
away. It runs PowerShell, Command Prompt, Git Bash and WSL in tabs and split panes, and
it has extras for working with Claude Code.

- [Getting started](#getting-started)
- [The console](#the-console)
- [Tabs and panes](#tabs-and-panes)
- [Working in the terminal](#working-in-the-terminal)
- [Command palette, snippets, layouts and profiles](#command-palette-snippets-layouts-and-profiles)
- [Picking up where you left off](#picking-up-where-you-left-off)
- [Notifications](#notifications)
- [Claude Code](#claude-code)
- [Administrator tabs](#administrator-tabs)
- [Settings](#settings)
- [Keyboard shortcuts](#keyboard-shortcuts)
- [Files qterm keeps](#files-qterm-keeps)
- [Troubleshooting](#troubleshooting)

## Getting started

1. Put `qterm-<version>-portable-x64.exe` in a folder of your choice and run it. Nothing
   needs installing; the console appears at the top of the screen.
2. Press **~** to hide it and **~** again to bring it back.
3. To have it ready after every sign-in, open the tray icon menu and tick **Start with
   Windows**. It then starts hidden and waits for the hotkey.

If you move the exe or replace it with a newer one, run the new one once: "Start with
Windows" follows the copy you ran last.

**The tray icon** (bottom right of the taskbar):

| Item | What it does |
|---|---|
| Left click | Shows or hides the console. |
| Show / Hide | The same, from the menu. |
| Hotkey ✓ | Switches the ~ hotkey off, for when you need to type ~ in another app. |
| Start with Windows ✓ | Starts qterm hidden when you sign in. |
| Settings… | Opens the console with the settings panel. |
| Quit qterm | Saves your tabs and their output, then closes qterm and every shell in it. |

When Claude Code is waiting for you, the tray tooltip says in how many panes.

## The console

- **Show and hide:** ~ (or the key you chose in Settings). If the console is open but
  another window has focus, the first press brings it to the front.
- **Height:** drag the console's bottom edge. Double-click the edge for half the screen.
  The height is remembered.
- **Width, monitor, transparency, animation:** in Settings → Console and Appearance.
- **Background effect** (Settings → Appearance): **Acrylic** blurs what's behind the
  console like frosted glass, **Mica** tints it with your wallpaper's colours. Lower the
  opacity to see more of it.
- **A background per shell:** give a shell its own `background` or `theme` in the
  settings file (see Profiles below) and its panes use that colour, at the same
  opacity as the rest of the console.
- **Hide when another window is clicked:** off by default. Turn it on if you want the
  console to get out of the way by itself.
- **Closing the last tab** hides the console; the next time it opens with a fresh tab.

## Tabs and panes

**Tabs**

- **New tab:** the **+** button or Ctrl+Shift+T opens your default shell. The **▾**
  button next to it lists every shell, your own profiles and saved layouts.
  Ctrl+Shift+1…9 opens the shell at that position in the list.
- **Switch:** click a tab, Ctrl+Tab / Ctrl+Shift+Tab, or Ctrl+Alt+1…9.
- **Rename:** double-click the tab title.
- **Reorder:** drag a tab.
- **Close:** the × on the tab, a middle click on the tab, or Ctrl+Shift+W for the current pane.
- **Colour and icon:** right-click a tab to give it one of eight colours and an icon
  (an emoji or a few letters). A shell can bring its own, see Profiles below.

**Split panes**

- **Split right:** Alt+Shift+= (or the button in the tab bar). **Split down:**
  Alt+Shift+-. The new pane runs the same shell in the same folder.
- **Move between panes:** Alt+arrow keys, or click.
- **Resize:** drag the gap between panes, or Alt+Shift+arrow keys. Alt+Shift+0 makes
  them equal again.
- **Zoom:** Alt+Shift+Z shows the current pane on its own; press it again to go back.
- **Swap** a pane with its neighbour: "Swap pane left/right/up/down" in the command
  palette (no shortcut until you set one).
- **Type into every pane of a tab at once:** Alt+Shift+B. The tab and its panes get a
  red outline while this is on.

**Tab markers**

| Marker | Meaning |
|---|---|
| Dot | A background tab printed something new. |
| Bell | A program in a background tab rang the bell. |
| ✳ (spinning / dim) | Claude Code runs in the tab: working / idle at its prompt. |
| 44% | How full Claude's context is in that tab (red from 80%). Hover for details. |
| ✳ (pulsing) | Claude Code is waiting for you there. |
| ✓ / ✗ | A long command finished there, successfully / with an error. |
| ADMIN | A pane in the tab runs as administrator. |
| Coloured edge, icon | The colour and icon you gave the tab, or its shell's. |

Markers disappear when you look at the tab.

## Working in the terminal

**Copy and paste**

- Ctrl+Shift+C copies the selection; Ctrl+Shift+V pastes.
- Right-click copies the selection, or pastes when nothing is selected.
- "Copy selected text automatically" (Settings → Terminal) copies as soon as you select.

**Links and files**

- **Ctrl+click** a web address to open it in your browser.
- **Ctrl+click** a file reference such as `src/app.ts:42` or `C:\work\notes.md` to open
  it in your editor at that line. VS Code is used by default; change the command in
  Settings → Terminal → "Open files with".

**Finding text**

- **In one pane:** Ctrl+Shift+F. Enter / Shift+Enter go to the next / previous match;
  Aa matches case, `.*` uses a regular expression; Esc closes the bar.
- **In every pane:** Alt+Shift+F searches the output of all panes at once, including
  output restored from before a restart. Pick a result to jump to it.

**Command marks** (PowerShell, Command Prompt and Git Bash)

Each command you run gets a thin bar at the left edge of its prompt: green when it
succeeded, red when it failed (hover for the command and exit code), grey when the shell
can't tell (Command Prompt).

- **Ctrl+↑ / Ctrl+↓** scroll to the previous / next command.
- **"Copy last command's output"** in the command palette copies what the last command
  printed.

**Dropping files**

Drag files from Explorer onto a pane: their paths are typed at the prompt, quoted the way
that shell needs (and translated to `/c/...` for Git Bash and `/mnt/c/...` for WSL).
Enter is not pressed, so you can finish the command first.

**Pictures and ligatures**

- Programs that print pictures as sixel, iTerm or Kitty graphics (for example `chafa`,
  `img2sixel` or `timg`) show them inline. Switch this off in Settings → Terminal.
- Programming ligatures (`=>` drawn as ⇒, `!=` as ≠ …) are off by default. Turn them on
  in Settings → Appearance and choose a font that has them, such as Cascadia Code or
  Fira Code (Cascadia Mono has none).

## Command palette, snippets, layouts and profiles

**Command palette:** Ctrl+Shift+P lists everything qterm can do, plus your tabs,
shells, themes, layouts, snippets and Claude sessions. Type a few letters of anything
("spl r" finds Split right), then Enter.

**Snippets** are commands you use often, typed into the current pane from the palette.
Add them in the settings file (Settings → "Open settings file"):

```toml
[[snippets]]
name = "Git log graph"
command = "git log --oneline --graph -20"
run = true        # press Enter too; leave it out to edit the command first
```

**Layouts** open a whole arrangement of panes as one tab, for example a server, a client
and a spare shell side by side. The easiest way to make one: arrange a tab the way you
like it, then **▾ → Save this tab as a layout**. Open it later from **▾ → Layouts** or the
palette. In the settings file a layout can also start commands:

```toml
[[layouts]]
name = "dev"
split = "row"            # side by side ("column" = stacked)
panes = [
  { profile = "API server" },
  { cwd = "C:/work/web", command = "npm start" },
]
```

**Profiles** add your own shells next to the detected ones: an SSH host, a shell that
starts in a project folder, or one with its own colours:

```toml
[[profiles]]
name = "Build box"
command = "ssh me@build-box"
theme = "dracula"        # optional: its own colours, background included
font_size = 13
tab_color = "green"      # red, orange, yellow, green, teal, blue, purple, pink
icon = "🛠"
background = "#1e1e2e"   # its panes' background (instead of the theme's)
```

To restyle a detected shell, give the profile its `id` (`pwsh`, `cmd`, `git-bash`,
`wsl:<distro>`, `ssh:<host>`).

**SSH hosts:** every `Host` in your `~/.ssh/config` shows up as a shell named
"SSH <host>" (wildcard patterns don't). Switch this off in Settings → Terminal.

## Picking up where you left off

With **Reopen tabs and layout on start** (on by default), qterm brings back your tabs,
splits and the folder each pane was in.

With **Keep each pane's output across restarts** (on by default), each pane also shows
what it printed before, above a dim "restored" line, with the new prompt right
below. You can switch this per shell (Settings → Scrollback → Per shell) and choose how
many lines to keep.

- A pane where you never ran anything isn't kept.
- **"Clear pane history"** (command palette) wipes the current pane's history and its
  saved copy.
- **Settings → Scrollback → Clear all saved output…** wipes everything saved, and the
  history of the open panes too.

## Notifications

qterm can tell you when something needs you while the console is hidden or you're
looking at another tab: the tab gets a marker, and if you're in another app, a Windows
notification appears. Clicking the notification opens the console on that pane.

- **Long commands:** a command that ran at least 30 seconds and finished while you
  weren't looking gets ✓ or ✗ on its tab and a notification. Change the time in
  Settings → Terminal → "Notify when a long command finishes" (0 switches it off).
- **Claude Code waiting for you:** see below.

## Claude Code

Set these up in **Settings → Claude Code**.

**Alerts and session tracking.** Click **Set up Claude Code alerts** once. qterm then
learns from Claude Code when it is waiting for you (a permission question, or your next
message after it has been idle for a minute) and which session runs in which pane. This
only affects Claude Code running inside qterm. If qterm says **Update** there, click it:
a newer qterm listens to more of Claude Code's events. Claude sessions started afterwards
use the new setup.

**Status per tab.** A tab running Claude Code shows ✳ (spinning while it works) and how
full its context is, e.g. **44%**. Hover for the model, context size, number of requests
and an estimated cost. The cost uses Anthropic's API prices; with a Claude subscription
you aren't billed per token, so treat it as a measure of how much the session has done.

**Back after a restart.** With **Resume Claude Code sessions on start** on (off by
default), the Claude sessions that were running when qterm closed come back too: each
restored pane gets `claude --resume <id>` typed for it. It needs "Reopen tabs and
layout on start", and works best with the hook set up, which says exactly which session
ran where.

**The ✳ menu** in the tab bar:

- **Running now:** the Claude sessions in your panes, with context and cost. Click one
  to go to its pane.
- **Remembered:** with "Remember Claude Code sessions" on, every time a terminal prints
  `claude --resume <id>` (as Claude Code does when you quit it), qterm keeps that session
  with its folder. Click it later to reopen it in a new tab, in the right folder, or
  click **here** on its row to reopen it in the tab you're in (the tab goes to the
  session's folder first). If that tab is busy, a new tab is used instead.
- **All on this PC:** every Claude Code session on this computer, grouped by folder,
  with a **+** per folder to start a new session there.

## Administrator tabs

"New admin tab: <shell>" in the command palette runs a shell as administrator inside
qterm, after Windows' administrator (UAC) prompt. qterm uses Windows' own **sudo** for
this, and only when sudo is set to **Inline**:

1. Open Settings → **Administrator tabs** → **Open Windows sudo settings** (or Windows
   Settings → System → Advanced).
2. Turn **Enable sudo** on and set **Configure how sudo runs applications** to
   **Inline**.

Microsoft's warning applies: in Inline mode, other programs running under your account
can type into an elevated window. If sudo is off or set differently, qterm opens the
shell as administrator in a window of its own instead.

Admin tabs are marked **ADMIN**. After a restart they come back as normal tabs, so
qterm never asks for administrator rights on its own.

## Settings

Open the settings with the ⚙ button, Ctrl+, or the tray menu. Changes apply when you
click **Save**; Esc or Cancel discards them. At the bottom:

- **Open settings file** opens `config.toml` for options the panel doesn't show
  (profiles, layouts, snippets). Saving the file applies it immediately; a mistake is
  shown at the top of the console and the previous settings stay in effect.
- **Export…** saves your settings to a file, e.g. to move them to another PC.
- **Import…** replaces your settings with such a file. Your current ones are kept as
  `config.toml.bak` next to the settings file.

| Group | Setting | Default |
|---|---|---|
| Console | Hotkey: ~, Scroll Lock, Pause, Insert or F13–F24 | ~ |
| | Height, width (share of the screen) | 50%, 100% |
| | Monitor: where the mouse is / primary | where the mouse is |
| | Slide animation | 150 ms |
| | Hide when another window is clicked | off |
| | Start with Windows | off |
| Appearance | Theme (nine built in) | qterm |
| | Background opacity | 82% |
| | Background effect: none / acrylic / mica | none |
| | Font, font size | Cascadia Mono, 14 |
| | Font ligatures | off |
| Terminal | Shell for new tabs | first found (PowerShell 7 if installed) |
| | Copy selected text automatically | off |
| | Right-click copies, or pastes when nothing is selected | on |
| | Show inline images | on |
| | SSH hosts as shells | on |
| | Reopen tabs and layout on start | on |
| | Shell integration (folder tracking, command marks) | on |
| | Notify when a long command finishes (seconds, 0 = off) | 30 |
| | Open files with (editor command) | `code --goto {file}:{line}:{col}` |
| Scrollback | Keep each pane's output across restarts | on |
| | Lines kept per pane | 1000 |
| | Per shell | follows the setting above |
| | Saved output: size, Clear all saved output… | |
| Administrator tabs | Windows sudo status and settings link | |
| Claude Code | Remember Claude Code sessions | off |
| | Alert me when Claude is waiting | on |
| | Resume Claude Code sessions on start | off |
| | Notification hook: set up / update / remove | |
| Keyboard shortcuts | Every shortcut below; empty switches one off | |

## Keyboard shortcuts

All of these can be changed in Settings → Keyboard shortcuts.

| Action | Shortcut |
|---|---|
| Show / hide the console | ~ |
| Command palette | Ctrl+Shift+P |
| Settings | Ctrl+, |
| New tab (default shell) | Ctrl+Shift+T |
| New tab with shell 1…9 | Ctrl+Shift+1…9 |
| Next / previous tab | Ctrl+Tab / Ctrl+Shift+Tab |
| Go to tab 1…9 | Ctrl+Alt+1…9 |
| Close pane | Ctrl+Shift+W |
| Split right / down | Alt+Shift+= / Alt+Shift+- |
| Move to the pane left/right/up/down | Alt+arrow keys |
| Resize the pane | Alt+Shift+arrow keys |
| Make panes equal | Alt+Shift+0 |
| Zoom the pane | Alt+Shift+Z |
| Type into every pane of the tab | Alt+Shift+B |
| Copy / paste | Ctrl+Shift+C / Ctrl+Shift+V |
| Find in the pane | Ctrl+Shift+F |
| Search all panes | Alt+Shift+F |
| Previous / next command | Ctrl+↑ / Ctrl+↓ |
| Swap panes, clear pane history, copy last command's output | (palette; no shortcut by default) |

Ctrl+Shift+1…9 and Ctrl+Alt+1…9 are fixed. On keyboards where Ctrl+Alt (AltGr) types
characters, qterm leaves AltGr combinations to the shell.

## Files qterm keeps

| What | Where |
|---|---|
| Settings | `%APPDATA%\dev.qterm.app\config.toml` |
| Open tabs and layout | `%APPDATA%\dev.qterm.app\session.json` |
| Remembered Claude sessions | `%APPDATA%\dev.qterm.app\claude-sessions.json` |
| Saved pane output | `%LOCALAPPDATA%\dev.qterm.app\scrollback\` |
| Console host and browser data | `%LOCALAPPDATA%\dev.qterm.app\` |

The portable exe writes nothing next to itself. To remove qterm completely: untick
**Start with Windows**, remove the Claude Code hook (Settings → Claude Code → Remove)
if you set it up, quit qterm, then delete the exe and the two `dev.qterm.app` folders.

## Troubleshooting

**The ~ key types ~ instead of showing the console.** Another app holds that key, or the
hotkey is switched off in the tray menu. The tray tooltip says which. Choose another
key in Settings → Console → Hotkey.

**I need to type ~ in another app.** Untick **Hotkey** in the tray menu while you do, or
pick a key you never type (Scroll Lock, Pause, F13–F24).

**Restored panes look empty.** The earlier output is above the "restored" line; scroll
up. A pane where you never ran anything isn't kept on purpose.

**No Claude alerts.** Check Settings → Claude Code: the hook should say "✓ Set up" (click
**Update** if offered), and Claude sessions started before that don't use it. Claude
Code only asks for attention after about a minute of idling, or when it needs a
permission. With auto mode on, the permission case rarely happens. qterm also stays
quiet when you are already looking at that pane.

**Context and cost don't show for a Claude tab.** They appear a few seconds after Claude
Code starts. Until the hook is updated, qterm guesses the session from the pane's folder,
which can pick the wrong one when several sessions share a folder.

**"New admin tab" opens a separate window.** Windows' sudo isn't set to Inline; see
[Administrator tabs](#administrator-tabs).

**Command marks or ✓/✗ alerts don't appear.** They need Settings → Terminal → Shell
integration (on by default) and a tab opened after it was switched on. WSL tabs and
custom profiles running other programs (ssh, python) don't report commands.

**A settings change didn't apply.** If the settings file has a mistake, qterm shows it at
the top of the console and keeps the previous settings until it is fixed.
