<#
.SYNOPSIS
  Builds the portable qterm: one self-contained exe in dist-portable/.

  Inside the exe: the UI and the newer ConPTY (extracted to
  %LOCALAPPDATA%\dev.qterm.app\conpty\<version>\ on first run). Taken from Windows:
  the WebView2 runtime, which ships with Windows 11. Settings live in
  %APPDATA%\dev.qterm.app\config.toml.

.EXAMPLE
  pnpm build:portable
#>
$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent

if (-not (Test-Path (Join-Path $repo 'src-tauri/vendor/conpty/x64/conpty.dll'))) {
    & (Join-Path $PSScriptRoot 'fetch-conpty.ps1')
}

Push-Location $repo
try {
    # --no-bundle: just the release exe, no MSI/NSIS installer.
    pnpm tauri build --no-bundle
    if ($LASTEXITCODE) { throw "tauri build failed ($LASTEXITCODE)" }

    $version = (Get-Content 'src-tauri/tauri.conf.json' -Raw | ConvertFrom-Json).version
    $out = New-Item -ItemType Directory -Force 'dist-portable'
    $exe = Join-Path $out "qterm-$version-portable-x64.exe"
    Copy-Item 'src-tauri/target/release/qterm.exe' $exe -Force

    $item = Get-Item $exe
    $hash = (Get-FileHash $exe -Algorithm SHA256).Hash
    Write-Host ""
    Write-Host "Portable build: $($item.FullName)"
    Write-Host ("  {0:N1} MB  sha256 {1}" -f ($item.Length / 1MB), $hash)
}
finally {
    Pop-Location
}
