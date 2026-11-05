"""Internal transport for qterm's bundled data helper, never caller-supplied code."""
import json
import sys

raw = sys.stdin.buffer.read(2_097_153)
if len(raw) > 2_097_152:
    raise ValueError("WSL helper envelope exceeds 2 MiB")
payload = json.loads(raw)
exec(compile(payload["source"], "<qterm-wsl-data>", "exec"),
     {"__name__": "__main__", "QTERM_REQUEST": payload["request"]})
