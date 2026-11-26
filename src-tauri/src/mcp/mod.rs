//! AXISNotes as a local MCP server, so Claude Desktop or Claude Code (which run on the
//! user's own Claude plan) can read and edit a vault: `AXISNotes --mcp --vault <folder>`.
//!
//! Claude starts this process itself and talks JSON-RPC over stdin/stdout, one message
//! per line. Nothing listens on the network and AXISNotes never contacts Anthropic. Access
//! is off until the user turns it on in Settings → Claude, and folders whose AI rule isn't
//! "any" are never shown (see `access.rs`). Each tool call is logged, metadata only, to
//! `.axisnotes/claude-activity.jsonl`.

mod access;
mod canvas;
mod tools;

#[cfg(test)]
mod tests;

use std::fs::{self, OpenOptions};
use std::io::{BufRead, Write};
use std::path::Path;
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::{json, Value};

use crate::ai::log::now_ms;
use crate::error::{AppError, AppResult};
use crate::index::Index;
use crate::vault::{Vault, META_DIR};

/// Protocol revisions we speak; the first is offered when the client asks for another.
const PROTOCOL_VERSIONS: &[&str] = &["2025-06-18", "2025-11-25", "2025-03-26", "2024-11-05"];
pub const ACTIVITY_LOG: &str = "claude-activity.jsonl";
const ACTIVITY_MAX_BYTES: u64 = 256_000;
/// Re-check the files for changes made while the app is closed, at most this often.
const RESYNC_AFTER: Duration = Duration::from_secs(5);

const INSTRUCTIONS: &str = "AXISNotes is the user's local notes app. These tools read and edit one AXISNotes vault: a folder of Markdown notes linked with [[wikilinks]], #tags and YAML frontmatter, plus grids (.axgrid) and canvases (.axcanvas). Paths are vault-relative with forward slashes. Call vault_info first. Read a note before changing it, and prefer replace_in_note or append_to_note over rewriting whole notes. To draw (diagrams, mind maps, boards), use the canvas tools: read_canvas first, then add_to_canvas or change_canvas; an open canvas shows the change live, and for a step-by-step drawing make several small calls. Some folders are kept from cloud AI by the user and are never shown; don't try to reach them.";

/// Entry point for `--mcp`: returns the process exit code.
pub fn main(args: &[String]) -> i32 {
    let Some(vault) = arg_after(args, "--vault") else {
        eprintln!("AXISNotes MCP server: pass the vault folder with --vault <folder>.");
        return 2;
    };
    let mut server = match Server::open(Path::new(&vault)) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("AXISNotes MCP server: can't open the vault {vault}: {e}");
            return 1;
        }
    };
    let stdin = std::io::stdin();
    let stdout = std::io::stdout();
    server.serve(stdin.lock(), stdout.lock());
    0
}

fn arg_after(args: &[String], flag: &str) -> Option<String> {
    let at = args.iter().position(|a| a == flag)?;
    args.get(at + 1).filter(|v| !v.starts_with("--")).cloned()
}

pub struct Server {
    vault: Vault,
    index: Option<Index>,
    synced: Option<Instant>,
}

impl Server {
    pub fn open(path: &Path) -> AppResult<Self> {
        Ok(Self {
            vault: Vault::open(path)?,
            index: None,
            synced: None,
        })
    }

    /// The vault's index, caught up with the files (the app may be closed, so nothing
    /// else keeps it current).
    fn index(&mut self) -> Result<&mut Index, String> {
        if self.index.is_none() {
            self.index = Some(Index::open_unsynced(&self.vault).map_err(|e| e.to_string())?);
        }
        let index = self.index.as_mut().expect("just opened");
        if self.synced.is_none_or(|t| t.elapsed() >= RESYNC_AFTER) {
            index.sync(&self.vault).map_err(|e| e.to_string())?;
            self.synced = Some(Instant::now());
        }
        Ok(index)
    }

    /// Answer messages until the client closes stdin.
    pub fn serve(&mut self, input: impl BufRead, mut output: impl Write) {
        for line in input.lines() {
            let Ok(line) = line else { break };
            if line.trim().is_empty() {
                continue;
            }
            if let Some(reply) = self.handle_line(&line) {
                if writeln!(output, "{reply}")
                    .and_then(|_| output.flush())
                    .is_err()
                {
                    break;
                }
            }
        }
    }

    /// One line from the client: a message or a batch. `None` = nothing to send back.
    pub fn handle_line(&mut self, line: &str) -> Option<String> {
        let msg: Value = match serde_json::from_str(line) {
            Ok(v) => v,
            Err(_) => return Some(error_reply(Value::Null, -32700, "Parse error").to_string()),
        };
        match msg {
            Value::Array(items) => {
                let replies: Vec<Value> = items.iter().filter_map(|m| self.handle(m)).collect();
                (!replies.is_empty()).then(|| Value::Array(replies).to_string())
            }
            m => self.handle(&m).map(|v| v.to_string()),
        }
    }

    fn handle(&mut self, msg: &Value) -> Option<Value> {
        let id = msg.get("id").cloned().filter(|v| !v.is_null());
        let Some(method) = msg.get("method").and_then(Value::as_str) else {
            // A reply to us (we never ask anything) needs no answer; anything else is bad.
            let is_reply = msg.get("result").is_some() || msg.get("error").is_some();
            return (!is_reply)
                .then(|| error_reply(id.unwrap_or(Value::Null), -32600, "Invalid request"));
        };
        let id = id?; // Notifications (initialized, cancelled, …) get no reply.
        let params = msg.get("params").cloned().unwrap_or_else(|| json!({}));
        let result = match method {
            "initialize" => Ok(initialize(&params)),
            "ping" => Ok(json!({})),
            "tools/list" => Ok(json!({ "tools": tools::list(&access::Access::load(&self.vault)) })),
            "tools/call" => self.call(&params),
            _ => Err((-32601, format!("Method not found: {method}"))),
        };
        Some(match result {
            Ok(r) => json!({ "jsonrpc": "2.0", "id": id, "result": r }),
            Err((code, message)) => error_reply(id, code, &message),
        })
    }

    fn call(&mut self, params: &Value) -> Result<Value, (i64, String)> {
        let name = params
            .get("name")
            .and_then(Value::as_str)
            .ok_or((-32602, "Missing tool name".to_string()))?;
        if !tools::exists(name) {
            return Err((-32602, format!("Unknown tool: {name}")));
        }
        let args = params
            .get("arguments")
            .cloned()
            .unwrap_or_else(|| json!({}));
        let outcome = self.run_tool(name, &args);
        self.log(name, &args, &outcome);
        Ok(match outcome {
            Ok(v) => json!({
                "content": [{ "type": "text", "text": serde_json::to_string_pretty(&v).unwrap_or_default() }],
                "isError": false,
            }),
            Err(message) => json!({
                "content": [{ "type": "text", "text": message }],
                "isError": true,
            }),
        })
    }

    /// Metadata only: when, which tool, the path or date asked for, and whether it worked.
    fn log(&self, tool: &str, args: &Value, outcome: &Result<Value, String>) {
        let target = ["path", "date", "folder"]
            .iter()
            .find_map(|k| args.get(*k).and_then(Value::as_str))
            .map(|s| s.chars().take(300).collect::<String>());
        let entry = ActivityEntry {
            time: now_ms(),
            tool,
            target,
            ok: outcome.is_ok(),
            error: outcome
                .as_ref()
                .err()
                .map(|e| e.chars().take(300).collect()),
        };
        let path = self.vault.root().join(META_DIR).join(ACTIVITY_LOG);
        let _ = append_trimmed(&path, &entry);
    }
}

#[derive(Serialize)]
struct ActivityEntry<'a> {
    time: u64,
    tool: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    target: Option<String>,
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

fn append_trimmed(path: &Path, entry: &ActivityEntry) -> std::io::Result<()> {
    if fs::metadata(path).is_ok_and(|m| m.len() > ACTIVITY_MAX_BYTES) {
        // Keep the newer half, from a line start.
        let text = fs::read_to_string(path).unwrap_or_default();
        let half = text.len() / 2;
        let start = text[half..].find('\n').map_or(text.len(), |i| half + i + 1);
        fs::write(path, &text[start..])?;
    }
    let mut f = OpenOptions::new().create(true).append(true).open(path)?;
    writeln!(f, "{}", serde_json::to_string(entry).unwrap_or_default())
}

fn initialize(params: &Value) -> Value {
    let asked = params.get("protocolVersion").and_then(Value::as_str);
    let version = asked
        .filter(|v| PROTOCOL_VERSIONS.contains(v))
        .unwrap_or(PROTOCOL_VERSIONS[0]);
    json!({
        "protocolVersion": version,
        "capabilities": { "tools": { "listChanged": false } },
        "serverInfo": { "name": "axisnotes", "title": "AXISNotes", "version": env!("CARGO_PKG_VERSION") },
        "instructions": INSTRUCTIONS,
    })
}

fn error_reply(id: Value, code: i64, message: &str) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } })
}

/// What Settings → Claude needs to write the setup for Claude Desktop and Claude Code.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectorInfo {
    /// This program, which Claude starts with `--mcp --vault <folder>`.
    exe: String,
}

#[tauri::command]
pub fn claude_connector_info() -> AppResult<ConnectorInfo> {
    let exe = std::env::current_exe().map_err(|e| AppError::Io(e.to_string()))?;
    Ok(ConnectorInfo {
        exe: dunce::simplified(&exe).display().to_string(),
    })
}
