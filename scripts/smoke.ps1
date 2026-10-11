<#
.SYNOPSIS
  Win32 smoke checks for the things a DOM test can't see: is the quake window
  on screen, where, and does the global hotkey (the bare ~ key) toggle it.

  Before pressing the key it checks that qterm owns it: if it didn't, a
  simulated key press would type into whatever window has focus.

.EXAMPLE
  pwsh scripts/smoke.ps1            # report state, then hide/show via the ~ key
  pwsh scripts/smoke.ps1 -StateOnly # just report
  pwsh scripts/smoke.ps1 -Show      # bring the console up (e.g. before a CDP check)
#>
param([switch]$StateOnly, [switch]$Show)

$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class QtermWin32 {
    delegate bool EnumProc(IntPtr hwnd, IntPtr lParam);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr l);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll")] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] static extern bool RegisterHotKey(IntPtr h, int id, uint mods, uint vk);
    [DllImport("user32.dll")] static extern bool UnregisterHotKey(IntPtr h, int id);

    const byte VK_OEM_3 = 0xC0, SC_OEM_3 = 0x29; const uint KEYUP = 2, MOD_NOREPEAT = 0x4000;

    // If we can register the bare ~ key ourselves, qterm does not own it.
    public static bool QtermOwnsTilde() {
        if (!RegisterHotKey(IntPtr.Zero, 0x5154, MOD_NOREPEAT, VK_OEM_3)) return true;
        UnregisterHotKey(IntPtr.Zero, 0x5154);
        return false;
    }

    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }

    public static IntPtr FindQuake(uint pid) {
        IntPtr found = IntPtr.Zero;
        EnumWindows((h, l) => {
            uint p; GetWindowThreadProcessId(h, out p);
            var title = new StringBuilder(64); GetWindowText(h, title, 64);
            if (p == pid && title.ToString() == "qterm") { found = h; return false; }
            return true;
        }, IntPtr.Zero);
        return found;
    }

    public static void PressTilde() {
        keybd_event(VK_OEM_3, SC_OEM_3, 0, UIntPtr.Zero);
        keybd_event(VK_OEM_3, SC_OEM_3, KEYUP, UIntPtr.Zero);
    }
}
'@

[QtermWin32]::SetProcessDPIAware() | Out-Null

function Get-QuakeState {
    $proc = Get-Process qterm -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $proc) { throw 'qterm is not running' }
    $hwnd = [QtermWin32]::FindQuake([uint32]$proc.Id)
    if ($hwnd -eq [IntPtr]::Zero) { throw 'qterm has no quake window' }
    $rect = New-Object QtermWin32+RECT
    [QtermWin32]::GetWindowRect($hwnd, [ref]$rect) | Out-Null
    [pscustomobject]@{
        Visible = [QtermWin32]::IsWindowVisible($hwnd)
        Focused = [QtermWin32]::GetForegroundWindow() -eq $hwnd
        Rect    = "($($rect.Left),$($rect.Top)) $($rect.Right - $rect.Left)x$($rect.Bottom - $rect.Top)"
    }
}

function Invoke-Hotkey {
    if (-not [QtermWin32]::QtermOwnsTilde()) {
        throw 'qterm does not own the ~ key (hotkey off, changed in config.toml, or taken); not pressing it'
    }
    [QtermWin32]::PressTilde()
    Start-Sleep -Milliseconds 400 # slide is 150 ms; leave room for the hide timer
    Get-QuakeState
}

$initial = Get-QuakeState
"initial:       $initial"
if ($StateOnly) { return }
if ($Show) {
    # Hotkey semantics need at most two presses: hidden -> shown, or behind -> focused.
    $s = $initial
    for ($i = 0; $i -lt 2 -and -not ($s.Visible -and $s.Focused); $i++) { $s = Invoke-Hotkey }
    "shown:         $s"
    if (-not $s.Visible) { exit 1 }
    return
}

$failures = 0
# Hotkey semantics: hidden -> show+focus; visible+unfocused -> focus; visible+focused -> hide.
if (-not ($initial.Visible -and $initial.Focused)) {
    $s = Invoke-Hotkey
    "after hotkey:  $s"
    if (-not ($s.Visible -and $s.Focused)) { 'FAIL: expected visible and focused'; $failures++ }
}
$s = Invoke-Hotkey
"after hotkey:  $s"
if ($s.Visible) { 'FAIL: expected hidden'; $failures++ }

$s = Invoke-Hotkey
"after hotkey:  $s"
if (-not ($s.Visible -and $s.Focused)) { 'FAIL: expected visible and focused'; $failures++ }

if ($failures) { "$failures check(s) failed"; exit 1 } else { 'all checks passed' }
