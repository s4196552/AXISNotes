//! Local log of AI requests: metadata only (provider, model, task, token counts, timing,
//! outcome), never prompts or answers. JSON lines in the app data folder, trimmed when
//! it grows past ~1 MB.

use std::io::Write;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use super::registry::Task;

const MAX_BYTES: u64 = 1_000_000;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogEntry {
    /// Milliseconds since the Unix epoch.
    pub time: u64,
    pub task: Task,
    pub provider: String,
    pub model: String,
    /// The provider runs on this machine.
    pub local: bool,
    /// "ok" | "error" | "cancelled" | "blocked"
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    pub estimated_input_tokens: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub input_tokens: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output_tokens: Option<u32>,
    pub duration_ms: u64,
    /// How many notes' content the request included.
    pub sources: usize,
}

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

pub fn append(path: &Path, entry: &LogEntry) {
    let Ok(line) = serde_json::to_string(entry) else {
        return;
    };
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    if std::fs::metadata(path).is_ok_and(|m| m.len() > MAX_BYTES) {
        // Keep the newer half.
        if let Ok(text) = std::fs::read_to_string(path) {
            let lines: Vec<&str> = text.lines().collect();
            let keep = lines[lines.len() / 2..].join("\n") + "\n";
            let _ = std::fs::write(path, keep);
        }
    }
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
    {
        let _ = writeln!(f, "{line}");
    }
}

/// The most recent `limit` entries, newest first.
pub fn read(path: &Path, limit: usize) -> Vec<LogEntry> {
    let Ok(text) = std::fs::read_to_string(path) else {
        return Vec::new();
    };
    text.lines()
        .rev()
        .filter_map(|l| serde_json::from_str(l).ok())
        .take(limit)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn appends_and_reads_newest_first() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("log/ai-requests.jsonl");
        for i in 0..3 {
            append(
                &p,
                &LogEntry {
                    time: i,
                    task: Task::Chat,
                    provider: "openai".into(),
                    model: "gpt-6-sol".into(),
                    local: false,
                    status: "ok".into(),
                    error: None,
                    estimated_input_tokens: 10,
                    input_tokens: Some(12),
                    output_tokens: Some(3),
                    duration_ms: 5,
                    sources: 1,
                },
            );
        }
        let e = read(&p, 2);
        assert_eq!(e.iter().map(|e| e.time).collect::<Vec<_>>(), vec![2, 1]);
        assert!(!std::fs::read_to_string(&p).unwrap().contains("prompt"));
    }
}
