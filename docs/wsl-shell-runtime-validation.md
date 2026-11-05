# Real shared-executable shell validation

Checkpoint 39 extends checkpoint 22's synthetic invocation cases with actual
BusyBox processes. The official Ubuntu `busybox-static` package was downloaded
as UID 1000 through the existing configured apt repository, checked against its
indexed SHA-256 and extracted into ignored workspace storage. No package install,
root process, system shell registry edit or provider operation was performed.

Cached provenance: version `1:1.37.0-7ubuntu1`, package SHA-256
`fd605342f62268753076aa7d9321ff098b36ba53e47434145a9aedc28fd141a4`,
binary SHA-256
`df12634c17fcdca839ae5dc47d7627b7558511f7645de7c99ccf097a0f28ed5b`.
The package, binary, metadata and copyright are under
`.tools.local/busybox-runtime/`; they are test dependencies, not app assets.

## Evidence

`scripts/wsl-shell-runtime.integration.mjs` runs
`scripts/wsl-shell-runtime-tests.py` in the explicitly selected distro. Each
process is an unreaped direct child owned by the test; cleanup signals only that
child and waits for it. Child HOME/ENV/PATH are isolated. `/proc/PID/exe` and
`/proc/PID/cmdline` supply actual executable and invocation facts.

Three actual Linux tests pass, including twelve live invocation variants:

- Physical `sh`/`ash` aliases, direct BusyBox shell applets and login argv names
  remain identifiable as interactive against the fixture's real alias declarations.
- Command and script operands plus `sleep` and `yes` applets remain direct
  programs even though the kernel executable image is the same binary.
- The production `shell_leader` and `programs` probes conservatively reject
  shell-preserving Stop for this unregistered image. The interactive process
  stays alive and accepts real stdin; a direct `sleep` remains in process-tree
  evidence and also cannot claim a retained shell.

The positive alias map is the classifier's explicit input, built from actual
fixture filesystem aliases. Ubuntu's `/etc/shells` and account shell are unchanged;
these tests do not configure a BusyBox-default distribution. Actual Bash and
direct-program close/Stop behavior remains covered by the full desktop suite.

Removing applet-declaration checks and skipping invocation validation each fail
the real process tests. Exact ownership source restoration and the restored
three-test run pass. `.tools.local/check-checkpoint39.mjs` finds zero temporary
acquisition/runtime directories or BusyBox fixture processes.

## Reproduce

After obtaining the workspace-local verified package fixture:

```powershell
$env:QTERM_E2E_WSL_DISTRIBUTION = 'Ubuntu'
$env:QTERM_E2E_BUSYBOX_BINARY = Join-Path (Get-Location) '.tools.local/busybox-runtime/busybox'
& ./.tools.local/node-v26.13.0-win-x64/node.exe --test scripts/wsl-shell-runtime.integration.mjs
```

Without either explicit fixture setting the integration case skips; a skip is
not accepted runtime proof. Actual checkpoint logs:
`.tools.local/checkpoint39-{missing-applet-declaration,missing-invocation-guard,restored-runtime}.log`.
