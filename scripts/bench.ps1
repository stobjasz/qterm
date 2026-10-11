<#
.SYNOPSIS
  Output-throughput benchmark. Run it INSIDE a terminal to time how fast that
  terminal can take a flood of output, e.g. in qterm and then in Windows Terminal.

.EXAMPLE
  & C:\path\to\qterm\scripts\bench.ps1
  & C:\path\to\qterm\scripts\bench.ps1 -Lines 300000
#>
param([int]$Lines = 100000)

Clear-Host
$padding = 'x' * 60
$elapsed = Measure-Command {
    1..$Lines | ForEach-Object { "qterm throughput line $_ $padding" } | Out-Host
}
"ELAPSED $([math]::Round($elapsed.TotalSeconds, 2)) s for $Lines lines"
"Now press Ctrl+C during: 1..1e9 | % { `$_ }   -- the prompt should return immediately."
