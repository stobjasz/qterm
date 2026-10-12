//! Token use of a Claude Code session, read from its transcript
//! (`<claude home>/projects/<encoded folder>/<session id>.jsonl`): how full the
//! context is, and what the session would cost at API prices. Transcripts only
//! grow, so each is read incrementally from where the last read stopped.

use std::collections::HashMap;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::Serialize;
use serde_json::Value;

/// Per million tokens, in US dollars.
#[derive(Clone, Copy, Debug, PartialEq)]
struct Price {
    input: f64,
    output: f64,
    cache_read: f64,
}

/// Anthropic API list prices (Claude API, as of 2026-10). Most specific id first:
/// "claude-opus-5" would otherwise also match "claude-opus-5-5".
const PRICES: &[(&str, Price)] = &[
    ("claude-fable-5-1", Price { input: 10.0, output: 50.0, cache_read: 0.25 }),
    ("claude-mythos-5-1", Price { input: 10.0, output: 50.0, cache_read: 0.25 }),
    ("claude-fable-5", Price { input: 10.0, output: 50.0, cache_read: 1.0 }),
    ("claude-mythos-5", Price { input: 10.0, output: 50.0, cache_read: 1.0 }),
    ("claude-opus-5-5", Price { input: 4.0, output: 20.0, cache_read: 0.20 }),
    ("claude-opus-5", Price { input: 5.0, output: 25.0, cache_read: 0.50 }),
    ("claude-opus-4-8", Price { input: 5.0, output: 25.0, cache_read: 0.50 }),
    ("claude-opus-4-7", Price { input: 5.0, output: 25.0, cache_read: 0.50 }),
    ("claude-opus-4-6", Price { input: 5.0, output: 25.0, cache_read: 0.50 }),
    ("claude-sonnet-5-5", Price { input: 2.0, output: 10.0, cache_read: 0.20 }),
    ("claude-sonnet-5", Price { input: 2.0, output: 10.0, cache_read: 0.20 }),
    ("claude-sonnet-4-6", Price { input: 3.0, output: 15.0, cache_read: 0.30 }),
    ("claude-haiku-5-5", Price { input: 0.10, output: 0.50, cache_read: 0.01 }),
    ("claude-haiku-4-5", Price { input: 1.0, output: 5.0, cache_read: 0.10 }),
];

/// Cache writes cost this much more than plain input: 5-minute and 1-hour entries.
const CACHE_WRITE_5M: f64 = 1.25;
const CACHE_WRITE_1H: f64 = 2.0;
/// Claude Haiku 5.5 costs 5x more per token for prompts above 100K tokens.
const HAIKU_5_5_TIER: u64 = 100_000;

fn price(model: &str) -> Option<Price> {
    PRICES.iter().find(|(id, _)| model.starts_with(id)).map(|(_, p)| *p)
}

/// The context window: 1M tokens on every current model but Haiku 4.5.
fn context_limit(model: &str) -> Option<u64> {
    if model.starts_with("claude-haiku-4-5") {
        Some(200_000)
    } else {
        price(model).map(|_| 1_000_000)
    }
}

#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeUsage {
    pub session_id: String,
    pub model: Option<String>,
    /// Tokens the latest request sent: what the context holds now.
    pub context_tokens: u64,
    pub context_limit: Option<u64>,
    /// At API list prices; None until a request of a known model was seen.
    pub cost_usd: Option<f64>,
    /// False when some requests were of a model without a known price.
    pub cost_complete: bool,
    pub output_tokens: u64,
    pub requests: usize,
}

/// One API request's share of the totals. A request appears on several lines
/// (one per content block), so the latest line's figures replace earlier ones.
#[derive(Clone, Copy, Default)]
struct Share {
    cost: Option<f64>,
    output: u64,
}

#[derive(Default)]
struct Tally {
    /// Bytes read so far (always just after a complete line).
    offset: u64,
    shares: HashMap<String, Share>,
    model: Option<String>,
    context: u64,
}

#[derive(Default)]
pub struct UsageIndex(Mutex<HashMap<PathBuf, Tally>>);

impl UsageIndex {
    pub fn usage(&self, transcript: &Path) -> Result<ClaudeUsage, String> {
        let mut file = std::fs::File::open(transcript).map_err(|e| format!("could not open {}: {e}", transcript.display()))?;
        let len = file.metadata().map_err(|e| e.to_string())?.len();
        let mut all = self.0.lock().unwrap();
        let tally = all.entry(transcript.to_path_buf()).or_default();
        if len < tally.offset {
            *tally = Tally::default(); // rewritten, not appended to
        }
        if len > tally.offset {
            file.seek(SeekFrom::Start(tally.offset)).map_err(|e| e.to_string())?;
            let mut bytes = Vec::with_capacity((len - tally.offset) as usize);
            file.read_to_end(&mut bytes).map_err(|e| e.to_string())?;
            // Only whole lines: the writer may be mid-line.
            if let Some(end) = bytes.iter().rposition(|&b| b == b'\n') {
                for line in bytes[..end].split(|&b| b == b'\n') {
                    tally.add_line(line);
                }
                tally.offset += end as u64 + 1;
            }
        }
        Ok(tally.summary(transcript))
    }
}

impl Tally {
    fn add_line(&mut self, line: &[u8]) {
        // Most lines are user turns and tool output; skip them unparsed.
        if !contains(line, b"\"assistant\"") || !contains(line, b"\"usage\"") {
            return;
        }
        let Ok(entry) = serde_json::from_slice::<Value>(line) else { return };
        if entry.get("type").and_then(Value::as_str) != Some("assistant") {
            return;
        }
        let Some(message) = entry.get("message") else { return };
        let Some(usage) = message.get("usage") else { return };
        let model = message.get("model").and_then(Value::as_str).unwrap_or_default();
        if model.is_empty() || model.starts_with('<') {
            return; // "<synthetic>": written by Claude Code itself, no request behind it
        }
        let id = message
            .get("id")
            .and_then(Value::as_str)
            .or_else(|| entry.get("requestId").and_then(Value::as_str))
            .unwrap_or_default()
            .to_string();
        let tokens = |key: &str| usage.get(key).and_then(Value::as_u64).unwrap_or(0);
        let (input, output) = (tokens("input_tokens"), tokens("output_tokens"));
        let (cache_read, cache_write) = (tokens("cache_read_input_tokens"), tokens("cache_creation_input_tokens"));
        let write_1h = usage.pointer("/cache_creation/ephemeral_1h_input_tokens").and_then(Value::as_u64).unwrap_or(0).min(cache_write);
        let prompt = input + cache_read + cache_write;

        let cost = price(model).map(|p| {
            let tier = if model.starts_with("claude-haiku-5-5") && prompt > HAIKU_5_5_TIER { 5.0 } else { 1.0 };
            let speed = if usage.get("speed").and_then(Value::as_str) == Some("fast") { 2.0 } else { 1.0 };
            let dollars = input as f64 * p.input
                + output as f64 * p.output
                + cache_read as f64 * p.cache_read
                + (cache_write - write_1h) as f64 * p.input * CACHE_WRITE_5M
                + write_1h as f64 * p.input * CACHE_WRITE_1H;
            dollars * tier * speed / 1_000_000.0
        });
        self.shares.insert(id, Share { cost, output });

        // The context is what the main conversation sends; subagents have their own.
        if entry.get("isSidechain").and_then(Value::as_bool) != Some(true) {
            self.context = prompt;
            self.model = Some(model.to_string());
        }
    }

    fn summary(&self, transcript: &Path) -> ClaudeUsage {
        let priced: Vec<f64> = self.shares.values().filter_map(|s| s.cost).collect();
        ClaudeUsage {
            session_id: transcript.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default(),
            context_limit: self.model.as_deref().and_then(context_limit),
            model: self.model.clone(),
            context_tokens: self.context,
            cost_usd: (!priced.is_empty()).then(|| priced.iter().sum()),
            cost_complete: priced.len() == self.shares.len(),
            output_tokens: self.shares.values().map(|s| s.output).sum(),
            requests: self.shares.len(),
        }
    }
}

fn contains(haystack: &[u8], needle: &[u8]) -> bool {
    haystack.windows(needle.len()).any(|w| w == needle)
}

/// Claude Code's folder name for a working directory: every character that isn't
/// an ASCII letter or digit becomes "-" (C:\work\app → C--work-app).
pub fn project_dir_name(cwd: &str) -> String {
    cwd.chars().map(|c| if c.is_ascii_alphanumeric() { c } else { '-' }).collect()
}

/// The most recently written transcript of a folder: the session most likely
/// running there when the hook hasn't said which one it is.
pub fn newest_transcript(claude_home: &Path, cwd: &str) -> Option<PathBuf> {
    std::fs::read_dir(claude_home.join("projects").join(project_dir_name(cwd)))
        .ok()?
        .flatten()
        .filter(|e| e.path().extension().is_some_and(|x| x == "jsonl"))
        .filter_map(|e| Some((e.metadata().ok()?.modified().ok()?, e.path())))
        .max_by_key(|(modified, _)| *modified)
        .map(|(_, path)| path)
}

/// A transcript path from the UI is only read if it is one of Claude Code's.
pub fn is_transcript(claude_home: &Path, path: &Path) -> bool {
    path.extension().is_some_and(|x| x == "jsonl")
        && path.starts_with(claude_home.join("projects"))
        && !path.components().any(|c| matches!(c, std::path::Component::ParentDir))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn line(id: &str, model: &str, usage: &str, sidechain: bool) -> String {
        format!(
            r#"{{"type":"assistant","isSidechain":{sidechain},"message":{{"id":"{id}","model":"{model}","usage":{usage}}}}}"#
        )
    }

    #[test]
    fn prices_requests_once_and_reads_the_context_of_the_main_thread() {
        let dir = std::env::temp_dir().join(format!("qterm-usage-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("abc.jsonl");
        let opus = "claude-opus-5-5";
        let lines = [
            r#"{"type":"user","message":{"role":"user","content":"hi"}}"#.to_string(),
            // The same request on two lines: the second (final) figures count, once.
            line("m1", opus, r#"{"input_tokens":10,"output_tokens":1,"cache_read_input_tokens":0,"cache_creation_input_tokens":1000}"#, false),
            line("m1", opus, r#"{"input_tokens":10,"output_tokens":500,"cache_read_input_tokens":0,"cache_creation_input_tokens":1000,"cache_creation":{"ephemeral_1h_input_tokens":1000,"ephemeral_5m_input_tokens":0}}"#, false),
            line("s1", "claude-haiku-5-5", r#"{"input_tokens":2000,"output_tokens":100}"#, true),
            line("syn", "<synthetic>", r#"{"input_tokens":0,"output_tokens":0}"#, false),
        ];
        std::fs::write(&path, lines.join("\n") + "\n").unwrap();
        let index = UsageIndex::default();
        let usage = index.usage(&path).unwrap();
        // m1: 10*4 + 500*20 + 1000*4*2 (1h write) = 18040 per M; s1: 2000*0.1 + 100*0.5 = 250 per M.
        assert!((usage.cost_usd.unwrap() - 0.01829).abs() < 1e-9, "{usage:?}");
        assert_eq!(usage.requests, 2);
        assert_eq!(usage.context_tokens, 1010, "the subagent's request isn't the context");
        assert_eq!(usage.model.as_deref(), Some(opus));
        assert_eq!(usage.context_limit, Some(1_000_000));
        assert!(usage.cost_complete);

        // Appended later, with a half-written line at the end: read incrementally.
        let more = line("m2", "claude-next-9", r#"{"input_tokens":5,"output_tokens":5,"cache_read_input_tokens":3000}"#, false);
        std::fs::OpenOptions::new().append(true).open(&path).unwrap().write_all(format!("{more}\n{{\"type\":\"assis").as_bytes()).unwrap();
        let usage = index.usage(&path).unwrap();
        assert_eq!(usage.requests, 3);
        assert_eq!(usage.context_tokens, 3005);
        assert!(!usage.cost_complete, "an unknown model makes the estimate partial");
        assert_eq!(usage.context_limit, None);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn haiku_long_prompts_and_fast_mode_cost_more() {
        let mut tally = Tally::default();
        tally.add_line(line("h", "claude-haiku-5-5", r#"{"input_tokens":200000,"output_tokens":0}"#, false).as_bytes());
        tally.add_line(line("f", "claude-opus-5-5", r#"{"input_tokens":1000000,"output_tokens":0,"speed":"fast"}"#, false).as_bytes());
        let cost = tally.summary(Path::new("x.jsonl")).cost_usd.unwrap();
        // 200K * $0.50 (long-prompt tier) = $0.10; 1M * $4 * 2 (fast) = $8.
        assert!((cost - 8.10).abs() < 1e-9, "{cost}");
    }

    #[test]
    fn finds_the_project_folder_and_rejects_other_files() {
        assert_eq!(project_dir_name(r"C:\Users\me\Dev\repos\qterm"), "C--Users-me-Dev-repos-qterm");
        let home = Path::new(r"C:\Users\me\.claude");
        assert!(is_transcript(home, Path::new(r"C:\Users\me\.claude\projects\C--x\a.jsonl")));
        assert!(!is_transcript(home, Path::new(r"C:\Users\me\.claude\projects\..\settings.jsonl")));
        assert!(!is_transcript(home, Path::new(r"C:\Users\me\.claude\settings.json")));
        assert!(!is_transcript(home, Path::new(r"C:\Windows\a.jsonl")));
    }

    use std::io::Write;
}
