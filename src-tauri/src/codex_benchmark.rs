//! Opt-in measurements against generated history, never the user's CODEX_HOME.
use crate::codex::Index;
use serde_json::json;
use std::{fs, io::Write, path::PathBuf, time::Instant};

struct Fixture {
    root: PathBuf,
    parent: PathBuf,
    ids: Vec<String>,
    paths: Vec<PathBuf>,
    bytes: u64,
}

impl Fixture {
    fn new(files: usize, tool_records: usize) -> Self {
        let parent = std::env::temp_dir().canonicalize().unwrap();
        let root = parent.join(format!(
            "qterm-codex-bench-{}-{}",
            std::process::id(),
            crate::agent_pipe::random().unwrap()
        ));
        fs::create_dir(&root).unwrap();
        let mut fixture = Self {
            root,
            parent,
            ids: vec![],
            paths: vec![],
            bytes: 0,
        };
        let ignored = json!({"type":"response_item","payload":{"type":"function_call_output","output":"x".repeat(4096)}}).to_string();
        for i in 0..files {
            let id = format!("{i:08x}-0000-4000-8000-000000000000");
            let dir = fixture
                .root
                .join("sessions")
                .join(format!("day-{}", i / 50));
            fs::create_dir_all(&dir).unwrap();
            let path = dir.join(format!("rollout-{id}.jsonl"));
            let mut out = std::io::BufWriter::new(fs::File::create(&path).unwrap());
            for record in [
                json!({"type":"session_meta","payload":{"id":id,"cwd":"C:/isolated-benchmark"}}),
                json!({"type":"event_msg","payload":{"type":"user_message","message":"Measure generated history"}}),
                json!({"type":"event_msg","payload":{"type":"token_count","info":{"last_token_usage":{"total_tokens":i+1}}}}),
            ] {
                writeln!(out, "{record}").unwrap();
            }
            for _ in 0..tool_records {
                writeln!(out, "{ignored}").unwrap();
            }
            out.flush().unwrap();
            fixture.bytes += fs::metadata(&path).unwrap().len();
            fixture.ids.push(id);
            fixture.paths.push(path);
        }
        fixture
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        // Refuse recursive cleanup if an owned root has been retargeted.
        if let Ok(actual) = self.root.canonicalize()
            && actual.parent() == Some(self.parent.as_path())
            && actual
                .file_name()
                .is_some_and(|name| name.to_string_lossy().starts_with("qterm-codex-bench-"))
            && actual == self.root
        {
            let _ = fs::remove_dir_all(actual);
        }
    }
}

fn timings(mut action: impl FnMut()) -> serde_json::Value {
    let mut values = Vec::new();
    for _ in 0..11 {
        let started = Instant::now();
        action();
        values.push(started.elapsed().as_secs_f64() * 1000.0);
    }
    values.sort_by(f64::total_cmp);
    json!({"medianMs":values[5],"p95Ms":values[10],"samples":values.len()})
}

#[test]
#[ignore = "opt-in generated-history performance measurement; run without concurrent desktop tests"]
fn generated_history_index_measurements() {
    for (files, tool_records) in [(100, 16), (1000, 16), (100, 256)] {
        let fixture = Fixture::new(files, tool_records);
        let index = Index::default();
        let started = Instant::now();
        let cold = index.scan_with_diagnostics(&fixture.root);
        let cold_ms = started.elapsed().as_secs_f64() * 1000.0;
        assert_eq!(cold.sessions.len(), files);
        assert_eq!(cold.diagnostics.files_scanned, files);
        assert!(cold.diagnostics.errors.is_empty());
        let ids = &fixture.ids[..16];
        let warm_scan = timings(|| assert_eq!(index.scan(&fixture.root).len(), files));
        let batch = timings(|| assert_eq!(index.usage_many(&fixture.root, ids).len(), ids.len()));
        let singles = timings(|| {
            for id in ids {
                assert!(index.usage(&fixture.root, id).is_some());
            }
        });
        let mut changed = fs::OpenOptions::new()
            .append(true)
            .open(&fixture.paths[0])
            .unwrap();
        writeln!(changed,"{}",json!({"type":"event_msg","payload":{"type":"token_count","info":{"last_token_usage":{"total_tokens":9999}}}})).unwrap();
        changed.flush().unwrap();
        let started = Instant::now();
        let updated = index.usage_many(&fixture.root, ids);
        let append_ms = started.elapsed().as_secs_f64() * 1000.0;
        assert_eq!(
            updated
                .iter()
                .find(|usage| usage.session_id == ids[0])
                .unwrap()
                .context_tokens,
            9999
        );
        drop(changed);
        fs::remove_file(&fixture.paths[0]).unwrap();
        assert_eq!(index.scan(&fixture.root).len(), files - 1);
        assert!(index.usage(&fixture.root, &ids[0]).is_none());
        println!(
            "QTERM_INDEX_MEASUREMENT {}",
            json!({"files":files,"bytes":fixture.bytes,"build":if cfg!(debug_assertions){"debug"}else{"release"},"coldIndexMs":cold_ms,"warmScan":warm_scan,"batch16":batch,"single16":singles,"appendOneMs":append_ms,"cache":"new application index; OS file cache not flushed"})
        );
    }
}
