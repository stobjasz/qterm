# qterm's portable-pty patch

Source: crates.io portable-pty 0.9.0, copied from the existing Cargo cache.
The upstream MIT license is retained in LICENSE.md. Dependencies and version are
unchanged; qterm's workspace lockfile still controls dependency resolution.

This directory is committed source, required by the path dependency in
`src-tauri/Cargo.toml`. Keep its manifest, license, examples and all platform
sources in Git. The sibling `vendor/conpty` directory contains downloaded binaries
and remains ignored; `scripts/fetch-conpty.ps1` fetches those during build setup.

Only three upstream source files change:

- CommandBuilder carries an optional Windows job handle, excluded from serde.
  The caller retains ownership through process creation.
- ProcThreadAttributeList can attach the Windows job-list creation attribute.
- ConPTY process creation adds that attribute alongside the existing pseudoconsole
  attribute. The handle array outlives the attribute list, including error paths,
  as required by UpdateProcThreadAttribute.

API reference: [UpdateProcThreadAttribute](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-updateprocthreadattribute).

No Windows launcher/helper or after-start PID assignment is used. Builders without
a job retain the upstream creation path. Review these small additions when updating
portable-pty, and remove the local dependency once equivalent upstream support is used.
