# Codex index measurement

The opt-in `codex_benchmark::generated_history_index_measurements` test measures
the real native `Index` against generated histories. It never reads `CODEX_HOME`,
changes a provider configuration or calls a model. Its unique temporary directory
is checked against its canonical parent before recursive cleanup.

Run without concurrent desktop suites or other indexing benchmarks:

```powershell
cd src-tauri
cargo test --locked codex_benchmark::generated_history_index_measurements -- --ignored --nocapture
```

Use `--release` before the test name for a separate optimized-build measurement.
Each JSON result identifies its build. This is a fresh application index over
recently generated files; the OS file cache is **not** flushed. Do not describe
the first scan as a cold disk measurement or extrapolate debug timings to release.

Three datasets cover 100 and 1,000 smaller transcripts (16 tool-result records
each) and 100 larger transcripts (256 tool-result records each). Each tool result
contains 4 KiB of generated text, alongside valid session, prompt and usage records.
The result reports actual bytes, initial indexing time, cached scan time, a batch
of 16 requested usages, 16 separate usage calls and one appended-record refresh.
Cached operations have 11 samples, reporting median and nearest-rank p95 (the
maximum at this sample count). Timings have no flaky pass/fail threshold.

Correctness assertions require all generated sessions and requested usages to be
found, appended token usage to update and a deleted rollout to disappear from
both history and usage. Dataset creation and cleanup are outside timed sections.

## Results

Measured on Windows on 4 November 2026, with a debug build and no concurrent
qterm test suite. Raw transcript: `.tools.local/codex-index-debug.log`. All three
datasets passed the append/deletion correctness assertions; no benchmark fixture
directories remained afterward.

All timings below are milliseconds. Cached operations show their median; the
batch p95 is also retained. Initial indexing and append refresh are single samples.

| Transcripts | Total MiB | Initial index | Cached scan | Batch of 16 | Batch p95 | 16 separate calls | Append refresh |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 100 smaller | 6.40 | 328.66 | 2.51 | 2.46 | 3.34 | 36.96 | 23.75 |
| 1,000 smaller | 64.00 | 3,146.62 | 40.65 | 28.03 | 33.42 | 434.20 | 45.05 |
| 100 larger | 101.96 | 343.06 | 2.35 | 2.27 | 2.42 | 35.90 | 14.74 |

Batching was 15.04–15.84 times faster than separate usage calls on these workloads.
Keep the existing metadata cache and shared batched usage reads: the largest
measured cached batch p95 was 33.42 ms against a 2.5-second polling interval.
These results do not justify a more complex incremental/persistent index yet.

The 1,000-file initial scan took 3.15 seconds and still needs its background-worker
and loading/diagnostic UI. The much larger 100-file dataset indexed faster;
file count appears more influential than total bytes on this generated workload.
That is an inference from this run, not an isolated filesystem-cost measurement.
Release-build latency, much larger real histories, concurrent writers and WSL
source scanning are outside this baseline. Re-measure those cases before making
broader performance claims or changing the index architecture. This completes
the initial native indexing measurement requirement.
