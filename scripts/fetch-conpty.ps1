<#
.SYNOPSIS
  Downloads the pinned Microsoft.Windows.Console.ConPTY package and puts the x64
  conpty.dll + OpenConsole.exe into src-tauri/vendor/conpty, where build.rs embeds them.

  The package hash is pinned and both binaries must carry a valid Microsoft
  Authenticode signature, or nothing is copied. To upgrade: change $Version and
  $PackageSha256 together, after checking the new release.

.EXAMPLE
  pwsh scripts/fetch-conpty.ps1
#>
$ErrorActionPreference = 'Stop'

$Version = '1.25.260930003'
$PackageSha256 = '02B07B349AF66D801159BDF9E440D4A1CE78BB951F37FC8609731665AFDAE7EE'
$Files = @{
    'conpty.dll'      = 'runtimes/win-x64/native/conpty.dll'
    'OpenConsole.exe' = 'build/native/runtimes/x64/OpenConsole.exe'
}

$repo = Split-Path $PSScriptRoot -Parent
$target = Join-Path $repo 'src-tauri/vendor/conpty/x64'
$work = Join-Path ([IO.Path]::GetTempPath()) "qterm-conpty-$Version-$PID"

try {
    New-Item -ItemType Directory -Force $work | Out-Null
    $nupkg = Join-Path $work 'conpty.nupkg'
    $url = "https://api.nuget.org/v3-flatcontainer/microsoft.windows.console.conpty/$Version/microsoft.windows.console.conpty.$Version.nupkg"
    Write-Host "Downloading ConPTY $Version"
    Invoke-WebRequest -Uri $url -OutFile $nupkg -UseBasicParsing

    $hash = (Get-FileHash $nupkg -Algorithm SHA256).Hash
    if ($hash -ne $PackageSha256) { throw "package hash mismatch: expected $PackageSha256, got $hash" }

    $extracted = Join-Path $work 'pkg'
    Expand-Archive -Path $nupkg -DestinationPath $extracted

    foreach ($name in $Files.Keys) {
        $file = Join-Path $extracted $Files[$name]
        $signature = Get-AuthenticodeSignature $file
        if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notlike 'CN=Microsoft Corporation,*') {
            throw "$name is not validly signed by Microsoft ($($signature.Status))"
        }
    }

    New-Item -ItemType Directory -Force $target | Out-Null
    foreach ($name in $Files.Keys) {
        Copy-Item (Join-Path $extracted $Files[$name]) (Join-Path $target $name) -Force
    }
    # build.rs reads this to name the extraction folder, so versions never collide.
    Set-Content -Path (Join-Path $target 'VERSION') -Value $Version -NoNewline
    Write-Host "ConPTY $Version ready in $target"
}
finally {
    Remove-Item -Recurse -Force $work -ErrorAction SilentlyContinue
}
