<#
.SYNOPSIS
  Starts a release: sets the version everywhere, commits and tags it.

  Pushing the tag runs .github/workflows/release.yml, which builds, signs and
  publishes the installer, the portable exe and latest.json (the updater's feed).
  Nothing is pushed here; the script prints the command.

.EXAMPLE
  ./scripts/release.ps1 0.2.0
  git push origin master v0.2.0
#>
param([Parameter(Mandatory)][ValidatePattern('^\d+\.\d+\.\d+$')][string]$Version)
$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
Push-Location $repo
try {
    if (git status --porcelain) { throw 'commit or stash your changes first' }
    if ((git branch --show-current) -ne 'master') { throw 'release from master' }
    if (git tag --list "v$Version") { throw "v$Version is already tagged" }

    # Plain text replacements keep each file's formatting and line endings.
    function Set-Version($path, $pattern, $replacement) {
        $text = [IO.File]::ReadAllText((Join-Path $repo $path))
        $regex = [regex]::new($pattern, 'Multiline')
        if (-not $regex.IsMatch($text)) { throw "no version found in $path" }
        [IO.File]::WriteAllText((Join-Path $repo $path), $regex.Replace($text, $replacement, 1))
    }
    Set-Version 'package.json' '^(  "version": )"[^"]+"' "`${1}`"$Version`""
    Set-Version 'src-tauri/tauri.conf.json' '^(  "version": )"[^"]+"' "`${1}`"$Version`""
    Set-Version 'src-tauri/Cargo.toml' '^(version = )"[^"]+"' "`${1}`"$Version`""
    # Cargo.lock follows Cargo.toml.
    cargo update --manifest-path src-tauri/Cargo.toml --package qterm --offline --quiet
    if ($LASTEXITCODE) { throw 'cargo update failed' }

    git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml src-tauri/Cargo.lock
    git commit -m "release: v$Version"
    git tag -a "v$Version" -m "qterm $Version"
    Write-Host ""
    Write-Host "Tagged v$Version. Publish it with:"
    Write-Host "  git push origin master v$Version"
}
finally {
    Pop-Location
}
