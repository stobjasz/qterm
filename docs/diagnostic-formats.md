# Diagnostic adapters

The Problems panel parses completed command output. It does not run a compiler,
change its flags, apply suggestions, or interpret every error-looking line as a
supported diagnostic. Command exit status and captured output remain visible.

| Tool | Supported output | Validation |
|---|---|---|
| TypeScript | `tsc` plain `file(line,column)` and pretty `file:line:column`, plus global TS-code errors | Real compiler through ConPTY and parser fixtures |
| Rust | Human headers with source arrows, short locations, rustc JSON and Cargo `compiler-message` JSON | Real compiler through ConPTY and parser fixtures |
| ESLint | Stylish file headings, JSON and json-with-metadata | Sanitized parser fixtures |
| Go | Source `.go:line:column` or `.go:line` diagnostics | Sanitized parser fixtures |
| pytest | Traceback exception locations and FAILED/ERROR short summaries | Sanitized parser fixtures |
| .NET | File/position and global CS, BC, FS, MSB, NETSDK and NU code messages | Sanitized parser fixtures |

Fixtures exercise Windows drive letters, spaces, missing positions, unknown JSON
fields and duplicate messages at distinct locations. A pytest summary does not
invent a line number or attach a test name to an unrelated traceback. Unknown
Rust/JSON levels remain unsupported.

References: [Rust diagnostic JSON](https://doc.rust-lang.org/rustc/json.html),
[ESLint formatters](https://eslint.org/docs/latest/use/formatters/),
[Go source positions](https://pkg.go.dev/go/token#Position.String),
[pytest output](https://docs.pytest.org/en/stable/how-to/output.html),
[C# compiler output examples](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/compiler-messages/preprocessor-errors).

Run capture keeps up to 128000 UTF-16 units without cutting a surrogate pair and
up to 500 diagnostics. Lost scrollback and truncated captures are labelled
incomplete. File opening resolves against the original command folder and checks
that the file still exists. WSL links use the captured distribution and Linux
folder, resolve the actual case-sensitive file and validate its Windows editor
transport. R69 covers the real boundary; see [WSL support](wsl-support.md).

The latest view groups by exact command, original folder and shell profile.
Superseded runs remain available in history; the current rolling limit is 100
saved completed commands across restarts, within a 32 MiB retention budget.
[Repository evidence](verification-records.md) is available for explicitly reviewed
new checks; ordinary command capture does not retroactively attest source state.
