use std::fs;
use std::io::Cursor;

use serde_json::{json, Value};

use super::tools::{format_date, parse_date};
use super::{Server, ACTIVITY_LOG};

const ON: &str = r#"{"claude":{"enabled":true}}"#;
const ON_RW: &str = r#"{"claude":{"enabled":true,"allowChanges":true},
  "ai":{"folders":{"Medical":"never","Journal":"local","Journal/Public":"any","Odd":"sometimes"}},
  "dailyNotes":{"folder":"Days","format":"YYYY/MM/DD dddd"}}"#;

struct Vault {
    dir: tempfile::TempDir,
    server: Server,
    next: u64,
}

impl Vault {
    fn new(config: &str) -> Self {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        for (p, text) in [
            (
                "School/Biology.md",
                "# Cells\nMitochondria are the powerhouse.\n- [ ] Read chapter 2 📅 2026-11-10\n",
            ),
            (
                "School/Chem.md",
                "Links to [[Biology]].\n- [x] Lab report\n",
            ),
            (
                "Medical/Scan.md",
                "Mitochondria results. Links to [[Biology]].\n- [ ] Book appointment\n",
            ),
            ("Journal/Day.md", "Private mitochondria thoughts\n"),
            ("Journal/Public/Post.md", "Public mitochondria post\n"),
            ("Odd/Thing.md", "mitochondria odd\n"),
        ] {
            let abs = root.join(p);
            fs::create_dir_all(abs.parent().unwrap()).unwrap();
            fs::write(abs, text).unwrap();
        }
        fs::create_dir_all(root.join(".axisnotes")).unwrap();
        fs::write(root.join(".axisnotes/config.json"), config).unwrap();
        let server = Server::open(root).unwrap();
        Self {
            dir,
            server,
            next: 0,
        }
    }

    fn config(&self, text: &str) {
        fs::write(self.dir.path().join(".axisnotes/config.json"), text).unwrap();
    }

    fn request(&mut self, method: &str, params: Value) -> Value {
        self.next += 1;
        let line = json!({ "jsonrpc": "2.0", "id": self.next, "method": method, "params": params });
        let reply = self.server.handle_line(&line.to_string()).expect("a reply");
        serde_json::from_str(&reply).unwrap()
    }

    /// (ok, text) of a tool call.
    fn call(&mut self, name: &str, args: Value) -> (bool, String) {
        let r = self.request("tools/call", json!({ "name": name, "arguments": args }));
        let result = &r["result"];
        let text = result["content"][0]["text"].as_str().unwrap().to_string();
        (result["isError"] == json!(false), text)
    }

    fn ok(&mut self, name: &str, args: Value) -> Value {
        let (ok, text) = self.call(name, args);
        assert!(ok, "{name} failed: {text}");
        serde_json::from_str(&text).unwrap()
    }

    fn err(&mut self, name: &str, args: Value) -> String {
        let (ok, text) = self.call(name, args);
        assert!(!ok, "{name} should fail but returned {text}");
        text
    }

    fn tool_names(&mut self) -> Vec<String> {
        let r = self.request("tools/list", json!({}));
        r["result"]["tools"]
            .as_array()
            .unwrap()
            .iter()
            .map(|t| t["name"].as_str().unwrap().to_string())
            .collect()
    }

    fn file(&self, rel: &str) -> String {
        fs::read_to_string(self.dir.path().join(rel)).unwrap()
    }
}

fn paths(v: &Value, list: &str, key: &str) -> Vec<String> {
    v[list]
        .as_array()
        .unwrap()
        .iter()
        .map(|x| x[key].as_str().unwrap().to_string())
        .collect()
}

#[test]
fn initialize_agrees_a_protocol_version() {
    let mut v = Vault::new(ON);
    let r = v.request("initialize", json!({ "protocolVersion": "2025-03-26", "capabilities": {}, "clientInfo": { "name": "t", "version": "1" } }));
    assert_eq!(r["result"]["protocolVersion"], "2025-03-26");
    assert_eq!(r["result"]["serverInfo"]["name"], "axisnotes");
    assert!(r["result"]["capabilities"]["tools"].is_object());
    let r = v.request("initialize", json!({ "protocolVersion": "1999-01-01" }));
    assert_eq!(r["result"]["protocolVersion"], "2025-06-18");
}

#[test]
fn notifications_get_no_reply_and_bad_messages_get_errors() {
    let mut v = Vault::new(ON);
    let s = &mut v.server;
    assert!(s
        .handle_line(r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#)
        .is_none());
    let r: Value = serde_json::from_str(&s.handle_line("{not json").unwrap()).unwrap();
    assert_eq!(r["error"]["code"], -32700);
    let r: Value = serde_json::from_str(
        &s.handle_line(r#"{"jsonrpc":"2.0","id":7,"method":"nope"}"#)
            .unwrap(),
    )
    .unwrap();
    assert_eq!(
        (r["id"].clone(), r["error"]["code"].clone()),
        (json!(7), json!(-32601))
    );
    let r: Value = serde_json::from_str(
        &s.handle_line(r#"{"jsonrpc":"2.0","id":"a","method":"ping"}"#)
            .unwrap(),
    )
    .unwrap();
    assert_eq!(r["result"], json!({}));
    let r = v.request("tools/call", json!({ "name": "rm_rf", "arguments": {} }));
    assert_eq!(r["error"]["code"], -32602);
}

#[test]
fn nothing_is_shared_until_access_is_on() {
    let mut v = Vault::new("{}");
    assert!(v.tool_names().is_empty());
    let e = v.err("read_note", json!({ "path": "School/Biology.md" }));
    assert!(e.contains("Settings → Claude"), "{e}");
    // An unreadable settings file refuses everything, even with access on before.
    v.config(ON);
    assert!(!v.tool_names().is_empty());
    v.config("{\"claude\":{\"enabled\":true},");
    assert!(v.tool_names().is_empty());
    let e = v.err("list_notes", json!({}));
    assert!(e.contains("isn't valid JSON"), "{e}");
    // Rules that aren't a folder map refuse everything too.
    v.config(r#"{"claude":{"enabled":true},"ai":{"folders":["Medical"]}}"#);
    v.err("list_notes", json!({}));
}

#[test]
fn write_tools_are_offered_and_allowed_only_with_changes_on() {
    let mut v = Vault::new(ON);
    let names = v.tool_names();
    assert!(names.contains(&"read_note".to_string()));
    assert!(!names.iter().any(|n| n == "create_note" || n == "edit_note"));
    let e = v.err("create_note", json!({ "path": "New.md", "content": "x" }));
    assert!(e.contains("read-only"), "{e}");
    assert!(!v.dir.path().join("New.md").exists());
    v.config(ON_RW);
    assert!(v.tool_names().contains(&"append_to_daily_note".to_string()));
}

#[test]
fn folders_kept_from_cloud_ai_are_never_shown() {
    let mut v = Vault::new(ON_RW);
    let listed = paths(&v.ok("list_notes", json!({})), "notes", "path");
    assert_eq!(
        listed,
        [
            "Journal/Public/Post.md",
            "School/Biology.md",
            "School/Chem.md"
        ]
    );
    let found = paths(
        &v.ok("search_notes", json!({ "query": "mitochondria" })),
        "results",
        "path",
    );
    assert_eq!(found.len(), 2, "{found:?}");
    assert!(found
        .iter()
        .all(|p| p == "School/Biology.md" || p == "Journal/Public/Post.md"));
    let tasks = paths(
        &v.ok("list_tasks", json!({ "includeDone": true })),
        "tasks",
        "path",
    );
    assert_eq!(tasks, ["School/Biology.md", "School/Chem.md"]);
    let back = paths(
        &v.ok("backlinks", json!({ "path": "Biology" })),
        "backlinks",
        "source",
    );
    assert_eq!(back, ["School/Chem.md"]);
    let info = v.ok("vault_info", json!({}));
    assert_eq!(info["notesClaudeCanSee"], 3);
    assert_eq!(info["foldersOrFilesKeptFromClaude"], 3);
    // Every spelling of a hidden note is refused with the same answer as a missing one.
    let missing = v.err("read_note", json!({ "path": "Nowhere.md" }));
    for p in [
        "Medical/Scan.md",
        "medical/scan.md",
        "MEDICAL/Scan",
        "Scan",
        "Journal/Day.md",
        "Odd/Thing.md",
        "School/../Medical/Scan.md",
        ".axisnotes/config.json",
        "Medical/Scan.md:stream",
        "Medical./Scan.md",
    ] {
        let e = v.err("read_note", json!({ "path": p }));
        assert!(
            e.starts_with("No note at") || e.contains("isn't a valid vault path"),
            "{p}: {e}"
        );
        if e.starts_with("No note at") {
            assert_eq!(e.replace(p, "X"), missing.replace("Nowhere.md", "X"));
        }
        if p != "Scan" {
            // (A bare "Scan" would be a new note at the top of the vault.)
            v.err("append_to_note", json!({ "path": p, "text": "leak" }));
        }
    }
    assert_eq!(
        v.file("Medical/Scan.md"),
        "Mitochondria results. Links to [[Biology]].\n- [ ] Book appointment\n"
    );
    v.err(
        "create_note",
        json!({ "path": "Medical/New.md", "content": "x" }),
    );
    v.err(
        "create_note",
        json!({ "path": "medical/New.md", "content": "x" }),
    );
    assert!(!v.dir.path().join("Medical/New.md").exists());
}

#[cfg(windows)]
#[test]
fn short_8_3_names_cannot_reach_a_hidden_folder() {
    let mut v = Vault::new(ON_RW);
    fs::create_dir_all(v.dir.path().join("Medical Records")).unwrap();
    fs::write(v.dir.path().join("Medical Records/x.md"), "secret").unwrap();
    v.config(r#"{"claude":{"enabled":true,"allowChanges":true},"ai":{"folders":{"Medical Records":"never"}}}"#);
    for p in ["MEDICA~1/x.md", "medica~1/x.md"] {
        // Whether or not the drive keeps short names, the folder must stay hidden.
        v.err("read_note", json!({ "path": p }));
        v.err("append_to_note", json!({ "path": p, "text": "leak" }));
    }
    assert_eq!(v.file("Medical Records/x.md"), "secret");
}

#[test]
fn reads_by_path_or_name_and_writes_on_disk_spelling() {
    let mut v = Vault::new(ON_RW);
    let note = v.ok("read_note", json!({ "path": "school/biology" }));
    assert_eq!(note["path"], "School/Biology.md");
    assert!(note["content"].as_str().unwrap().starts_with("# Cells"));
    assert_eq!(
        v.ok("read_note", json!({ "path": "Chem" }))["path"],
        "School/Chem.md"
    );
    let r = v.ok(
        "append_to_note",
        json!({ "path": "school/chem", "text": "More." }),
    );
    assert_eq!(r["appendedTo"], "School/Chem.md");
    assert_eq!(
        v.file("School/Chem.md"),
        "Links to [[Biology]].\n- [x] Lab report\nMore.\n"
    );
}

#[test]
fn creates_edits_and_refuses_stale_or_ambiguous_changes() {
    let mut v = Vault::new(ON_RW);
    let r = v.ok(
        "create_note",
        json!({ "path": "Ideas/Plan", "content": "# Plan\n- [ ] Start\n" }),
    );
    assert_eq!(r["created"], "Ideas/Plan.md");
    let e = v.err(
        "create_note",
        json!({ "path": "Ideas/Plan.md", "content": "again" }),
    );
    assert!(e.contains("already exists"), "{e}");
    // Only Markdown: any other extension gets ".md" added.
    v.ok(
        "create_note",
        json!({ "path": "Ideas/Plan.txt.html", "content": "x" }),
    );
    assert!(v.dir.path().join("Ideas/Plan.txt.html.md").exists());
    // The new note is searchable at once.
    let found = paths(
        &v.ok("search_notes", json!({ "query": "path:Ideas" })),
        "results",
        "path",
    );
    assert!(found.contains(&"Ideas/Plan.md".to_string()), "{found:?}");

    let read = v.ok("read_note", json!({ "path": "Ideas/Plan.md" }));
    let stamp = read["modifiedMs"].as_u64().unwrap();
    let e = v.err(
        "edit_note",
        json!({ "path": "Ideas/Plan.md", "content": "new", "expectedModifiedMs": stamp + 1 }),
    );
    assert!(e.contains("changed since"), "{e}");
    v.ok("edit_note", json!({ "path": "Ideas/Plan.md", "content": "# Plan\n- [ ] Start\n- [ ] Start\n", "expectedModifiedMs": stamp }));
    let e = v.err(
        "replace_in_note",
        json!({ "path": "Ideas/Plan.md", "oldText": "- [ ] Start", "newText": "- [x] Start" }),
    );
    assert!(e.contains("appears 2 times"), "{e}");
    v.err(
        "replace_in_note",
        json!({ "path": "Ideas/Plan.md", "oldText": "absent", "newText": "x" }),
    );
    v.ok("replace_in_note", json!({ "path": "Ideas/Plan.md", "oldText": "Start\n- [ ] Start", "newText": "Start\n- [x] Done" }));
    assert_eq!(v.file("Ideas/Plan.md"), "# Plan\n- [ ] Start\n- [x] Done\n");
    v.err(
        "edit_note",
        json!({ "path": "Ideas/Missing.md", "content": "x", "expectedModifiedMs": 1 }),
    );
}

#[test]
fn replace_keeps_windows_line_endings() {
    let mut v = Vault::new(ON_RW);
    fs::write(v.dir.path().join("School/Win.md"), "one\r\ntwo\r\n").unwrap();
    v.ok(
        "replace_in_note",
        json!({ "path": "School/Win.md", "oldText": "one\ntwo", "newText": "1\n2" }),
    );
    assert_eq!(v.file("School/Win.md"), "1\r\n2\r\n");
    v.ok(
        "append_to_note",
        json!({ "path": "School/Win.md", "text": "3\n4" }),
    );
    assert_eq!(v.file("School/Win.md"), "1\r\n2\r\n3\r\n4\r\n");
}

#[test]
fn daily_notes_use_the_vaults_folder_and_format() {
    let mut v = Vault::new(ON_RW);
    let r = v.ok(
        "append_to_daily_note",
        json!({ "date": "2026-11-08", "text": "- Met Sam" }),
    );
    assert_eq!(r["created"], "Days/2026/11/08 Sunday.md");
    v.ok(
        "append_to_daily_note",
        json!({ "date": "2026-11-08", "text": "- Gym" }),
    );
    assert_eq!(v.file("Days/2026/11/08 Sunday.md"), "- Met Sam\n- Gym\n");
    v.err(
        "append_to_daily_note",
        json!({ "date": "2026-02-30", "text": "x" }),
    );
    v.err(
        "append_to_daily_note",
        json!({ "date": "tomorrow", "text": "x" }),
    );
}

#[test]
fn formats_dates_like_the_app() {
    let d = parse_date("2024-02-29").unwrap();
    assert_eq!(format_date(d, "YYYY-MM-DD"), "2024-02-29");
    assert_eq!(
        format_date(d, "dddd, MMMM D, YYYY"),
        "Thursday, February 29, 2024"
    );
    assert_eq!(
        format_date(d, "ddd D MMM YY [week] M"),
        "Thu 29 Feb 24 week 2"
    );
    assert_eq!(format_date((2026, 1, 4), "dddd"), "Sunday");
    assert_eq!(format_date((2000, 12, 31), "dddd HH:mm"), "Sunday 00:00");
    assert!(parse_date("2023-02-29").is_err());
    assert!(parse_date("2026-13-01").is_err());
}

#[test]
fn tool_calls_are_logged_without_content() {
    let mut v = Vault::new(ON_RW);
    v.ok(
        "append_to_note",
        json!({ "path": "School/Biology.md", "text": "SECRET TEXT" }),
    );
    v.err("read_note", json!({ "path": "Medical/Scan.md" }));
    let log = v.file(&format!(".axisnotes/{ACTIVITY_LOG}"));
    let lines: Vec<Value> = log
        .lines()
        .map(|l| serde_json::from_str(l).unwrap())
        .collect();
    assert_eq!(lines.len(), 2);
    assert_eq!(lines[0]["tool"], "append_to_note");
    assert_eq!(lines[0]["target"], "School/Biology.md");
    assert_eq!(lines[1]["ok"], false);
    assert!(!log.contains("SECRET"));
}

#[test]
fn serves_a_session_over_a_stream() {
    let mut v = Vault::new(ON);
    let input = [
        r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}"#,
        r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#,
        "",
        r#"{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"read_note","arguments":{"path":"Biology"}}}"#,
    ]
    .join("\n");
    let mut out = Vec::new();
    v.server.serve(Cursor::new(input), &mut out);
    let lines: Vec<Value> = String::from_utf8(out)
        .unwrap()
        .lines()
        .map(|l| serde_json::from_str(l).unwrap())
        .collect();
    assert_eq!(lines.len(), 2);
    assert_eq!(lines[1]["id"], 2);
    assert!(lines[1]["result"]["content"][0]["text"]
        .as_str()
        .unwrap()
        .contains("powerhouse"));
}
