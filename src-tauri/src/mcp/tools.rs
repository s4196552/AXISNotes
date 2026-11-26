//! The tools Claude can call. Reads are always offered once access is on; the tools that
//! change notes are listed only while "Allow changes" is on, and every call checks again.

use std::collections::HashMap;

use serde_json::{json, Value};

use super::access::{not_shared, real_path, Access};
use super::{canvas, Server};
use crate::ai::privacy::{self, AiRule};
use crate::error::AppError;
use crate::index::{is_canvas, is_indexed, is_note};

const MAX_NOTE_BYTES: usize = 1_000_000;

struct Tool {
    name: &'static str,
    title: &'static str,
    description: &'static str,
    write: bool,
    /// Replaces text (as opposed to only adding it).
    destructive: bool,
    schema: fn() -> Value,
}

/// The most index hits one search reads while looking for notes Claude may see.
const MAX_SEARCH_HITS: usize = 32_000;

fn path_prop() -> Value {
    json!({ "type": "string", "description": "Vault-relative path with forward slashes, e.g. \"School/Biology.md\". read_note and backlinks also take a note name." })
}

const TOOLS: &[Tool] = &[
    Tool {
        name: "vault_info",
        title: "About this vault",
        description: "The vault's name, whether Claude may change notes, where daily notes go and how many notes Claude can see. Call this first.",
        write: false,
        destructive: false,
        schema: || json!({ "type": "object", "properties": {} }),
    },
    Tool {
        name: "list_notes",
        title: "List notes",
        description: "Notes Claude can see (Markdown notes, grids and canvases), by path, optionally only those inside one folder.",
        write: false,
        destructive: false,
        schema: || json!({ "type": "object", "properties": {
            "folder": { "type": "string", "description": "Only notes inside this folder (vault-relative)." },
            "limit": { "type": "integer", "minimum": 1, "maximum": 2000, "description": "Most notes to return (default 200)." }
        } }),
    },
    Tool {
        name: "search_notes",
        title: "Search notes",
        description: "Full-text search over note titles and text. Words match prefixes; \"quoted phrases\" match exactly; -word excludes. Filters: tag:name (includes nested tags), path:part, file:name, prop:key or prop:key=value. Matches in snippets are wrapped in **.",
        write: false,
        destructive: false,
        schema: || json!({ "type": "object", "required": ["query"], "properties": {
            "query": { "type": "string" },
            "limit": { "type": "integer", "minimum": 1, "maximum": 100, "description": "Most results (default 20)." }
        } }),
    },
    Tool {
        name: "read_note",
        title: "Read a note",
        description: "A note's full text and its modifiedMs (pass that to edit_note). Takes a path or a note name as written in a [[wikilink]].",
        write: false,
        destructive: false,
        schema: || json!({ "type": "object", "required": ["path"], "properties": { "path": path_prop() } }),
    },
    Tool {
        name: "backlinks",
        title: "Backlinks",
        description: "Notes that link to this note, with the line of each link.",
        write: false,
        destructive: false,
        schema: || json!({ "type": "object", "required": ["path"], "properties": { "path": path_prop() } }),
    },
    Tool {
        name: "list_tasks",
        title: "List tasks",
        description: "Markdown tasks (- [ ] lines) across the vault: open ones first, by due date and priority (3 = high). Each has its note path and 1-based line.",
        write: false,
        destructive: false,
        schema: || json!({ "type": "object", "properties": {
            "includeDone": { "type": "boolean", "description": "Also list finished tasks (default false)." },
            "limit": { "type": "integer", "minimum": 1, "maximum": 2000, "description": "Most tasks (default 200)." }
        } }),
    },
    Tool {
        name: "create_note",
        title: "Create a note",
        description: "Create a new Markdown note (folders are created as needed). Fails if the note already exists. \".md\" is added unless the path ends with it.",
        write: true,
        destructive: false,
        schema: || json!({ "type": "object", "required": ["path", "content"], "properties": {
            "path": path_prop(), "content": { "type": "string" }
        } }),
    },
    Tool {
        name: "edit_note",
        title: "Replace a note's text",
        description: "Replace a Markdown note's whole text. Pass expectedModifiedMs from read_note: if the note changed since, nothing is written. Prefer replace_in_note for small changes.",
        write: true,
        destructive: true,
        schema: || json!({ "type": "object", "required": ["path", "content", "expectedModifiedMs"], "properties": {
            "path": path_prop(), "content": { "type": "string" },
            "expectedModifiedMs": { "type": "integer", "description": "modifiedMs from read_note." }
        } }),
    },
    Tool {
        name: "replace_in_note",
        title: "Change part of a note",
        description: "Replace one exact piece of a Markdown note's text with new text. oldText must appear exactly once (include surrounding words to make it unique). Use it to tick a task: \"- [ ] Buy milk\" → \"- [x] Buy milk\".",
        write: true,
        destructive: true,
        schema: || json!({ "type": "object", "required": ["path", "oldText", "newText"], "properties": {
            "path": path_prop(), "oldText": { "type": "string" }, "newText": { "type": "string" }
        } }),
    },
    Tool {
        name: "append_to_note",
        title: "Add to a note",
        description: "Add text at the end of a Markdown note on a new line, creating the note if it doesn't exist.",
        write: true,
        destructive: false,
        schema: || json!({ "type": "object", "required": ["path", "text"], "properties": {
            "path": path_prop(), "text": { "type": "string" }
        } }),
    },
    Tool {
        name: "append_to_daily_note",
        title: "Add to a daily note",
        description: "Add text at the end of the daily note for a date (the user's local date, YYYY-MM-DD), in the vault's daily-notes folder and file-name format. A daily note that doesn't exist yet is created with just this text (AXISNotes' daily template isn't applied).",
        write: true,
        destructive: false,
        schema: || json!({ "type": "object", "required": ["date", "text"], "properties": {
            "date": { "type": "string", "description": "YYYY-MM-DD" }, "text": { "type": "string" }
        } }),
    },
    Tool {
        name: "read_canvas",
        title: "Read a canvas",
        description: "What is on a canvas (.axcanvas, an infinite whiteboard): each shape, text, note card and arrow with its id, type, position (x, y = top-left; y grows downward), size, text or label, colors, and for arrows the ids they connect. Call it before changing a canvas. If the user has the canvas open, they see changes as soon as they are made.",
        write: false,
        destructive: false,
        schema: || json!({ "type": "object", "required": ["path"], "properties": { "path": canvas_path_prop() } }),
    },
    Tool {
        name: "create_canvas",
        title: "Create a canvas",
        description: "Create a new canvas (\".axcanvas\" is added unless the path ends with it), optionally drawing shapes and arrows on it at once (same format as add_to_canvas). Fails if it already exists.",
        write: true,
        destructive: false,
        schema: || json!({ "type": "object", "required": ["path"], "properties": {
            "path": canvas_path_prop(), "shapes": shapes_prop(), "arrows": arrows_prop()
        } }),
    },
    Tool {
        name: "add_to_canvas",
        title: "Draw on a canvas",
        description: "Add shapes (labelled boxes, ellipses, diamonds), free text, note cards (live previews of a note) and arrows between shapes to a canvas. Give shapes your own short ids to connect them with arrows in the same call; arrows may also connect to ids already on the canvas. Shapes without x and y are placed in a tidy grid to the right of what is there; for a diagram, give positions (about 80 px apart). Sizes fit the label when left out. Returns the new ids.",
        write: true,
        destructive: false,
        schema: || json!({ "type": "object", "required": ["path"], "properties": {
            "path": canvas_path_prop(), "shapes": shapes_prop(), "arrows": arrows_prop()
        } }),
    },
    Tool {
        name: "change_canvas",
        title: "Change a canvas",
        description: "Move, resize, relabel or recolor elements on a canvas by id (from read_canvas), and delete others. Arrows follow the shapes they connect. Deleting a shape also deletes its label and the arrows connected to it. An empty \"text\" removes a shape's or arrow's label.",
        write: true,
        destructive: true,
        schema: || json!({ "type": "object", "required": ["path"], "properties": {
            "path": canvas_path_prop(),
            "changes": { "type": "array", "items": { "type": "object", "required": ["id"], "properties": {
                "id": { "type": "string" },
                "x": { "type": "number" }, "y": { "type": "number" },
                "width": { "type": "number" }, "height": { "type": "number" },
                "text": { "type": "string", "description": "New text or label." },
                "fontSize": { "type": "number", "description": "Free text only." },
                "strokeColor": { "type": "string" }, "backgroundColor": { "type": "string" }
            } } },
            "delete": { "type": "array", "items": { "type": "string" }, "description": "Ids to delete." }
        } }),
    },
];

fn canvas_path_prop() -> Value {
    json!({ "type": "string", "description": "Vault-relative path of the canvas, e.g. \"School/Mitosis.axcanvas\"." })
}

fn shapes_prop() -> Value {
    json!({ "type": "array", "items": { "type": "object", "properties": {
        "type": { "type": "string", "enum": ["rectangle", "ellipse", "diamond", "text", "noteCard"], "description": "Default rectangle." },
        "id": { "type": "string", "description": "Optional id of your choosing (letters, digits, - _ . :), unique on the canvas, for arrows and later changes." },
        "text": { "type": "string", "description": "The label inside a shape, or the words of a text element (\\n for new lines)." },
        "note": { "type": "string", "description": "noteCard only: the note's path." },
        "x": { "type": "number" }, "y": { "type": "number" },
        "width": { "type": "number" }, "height": { "type": "number" },
        "fontSize": { "type": "number", "description": "Default 16 in shapes, 20 for text." },
        "strokeColor": { "type": "string", "description": "Outline and text color, e.g. \"#1971c2\"." },
        "backgroundColor": { "type": "string", "description": "Fill, e.g. \"#a5d8ff\" (default transparent)." }
    } } })
}

fn arrows_prop() -> Value {
    json!({ "type": "array", "items": { "type": "object", "required": ["from", "to"], "properties": {
        "from": { "type": "string", "description": "Id of the shape it starts at." },
        "to": { "type": "string", "description": "Id of the shape it points to." },
        "label": { "type": "string" },
        "id": { "type": "string" },
        "strokeColor": { "type": "string" }
    } } })
}

fn array_arg(args: &Value, key: &str) -> Result<Vec<Value>, String> {
    match args.get(key) {
        None | Some(Value::Null) => Ok(Vec::new()),
        Some(Value::Array(a)) => Ok(a.clone()),
        Some(_) => Err(format!("\"{key}\" must be a list.")),
    }
}

pub fn exists(name: &str) -> bool {
    TOOLS.iter().any(|t| t.name == name)
}

/// The tools to offer now: none while access is off, reads only while read-only.
pub fn list(access: &Result<Access, String>) -> Vec<Value> {
    let Ok(a) = access else { return Vec::new() };
    if !a.enabled {
        return Vec::new();
    }
    TOOLS
        .iter()
        .filter(|t| a.write || !t.write)
        .map(|t| {
            json!({
                "name": t.name,
                "title": t.title,
                "description": t.description,
                "inputSchema": (t.schema)(),
                "annotations": {
                    "title": t.title,
                    "readOnlyHint": !t.write,
                    "destructiveHint": t.destructive,
                    "openWorldHint": false,
                },
            })
        })
        .collect()
}

fn text_arg<'a>(args: &'a Value, key: &str) -> Result<&'a str, String> {
    args.get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| format!("\"{key}\" (text) is required."))
}

fn limit_arg(args: &Value, def: usize, max: usize) -> usize {
    args.get("limit")
        .and_then(Value::as_u64)
        .map_or(def, |n| (n as usize).clamp(1, max))
}

fn app(e: AppError) -> String {
    e.to_string()
}

impl Server {
    pub(super) fn run_tool(&mut self, name: &str, args: &Value) -> Result<Value, String> {
        let mut access = Access::load(&self.vault)?;
        access.require_on()?;
        access.marks = self.index()?.ai_marks().map_err(app)?;
        match name {
            "vault_info" => self.vault_info(&access),
            "list_notes" => self.list_notes(&access, args),
            "search_notes" => self.search_notes(&access, args),
            "read_note" => self.read_note(&access, args),
            "backlinks" => self.backlinks(&access, args),
            "list_tasks" => self.list_tasks(&access, args),
            "read_canvas" => self.read_canvas(&access, args),
            _ => {
                access.require_write()?;
                match name {
                    "create_note" => self.create_note(&access, args),
                    "edit_note" => self.edit_note(&access, args),
                    "replace_in_note" => self.replace_in_note(&access, args),
                    "append_to_note" => {
                        let path = self.writable(&access, text_arg(args, "path")?)?;
                        self.append(&path, text_arg(args, "text")?)
                    }
                    "append_to_daily_note" => self.append_to_daily(&access, args),
                    "create_canvas" => self.create_canvas(&access, args),
                    "add_to_canvas" => self.add_to_canvas(&access, args),
                    "change_canvas" => self.change_canvas(&access, args),
                    _ => Err(format!("Unknown tool: {name}")),
                }
            }
        }
    }

    fn vault_info(&mut self, a: &Access) -> Result<Value, String> {
        let visible = self
            .index()?
            .list_notes()
            .map_err(app)?
            .iter()
            .filter(|n| a.can_see(&n.path))
            .count();
        Ok(json!({
            "vault": self.vault.info().name,
            "canMakeChanges": a.write,
            "notesClaudeCanSee": visible,
            "foldersOrFilesKeptFromClaude": a.hidden_rules(),
            "dailyNotes": { "folder": a.daily_folder, "fileNameFormat": a.daily_format },
            "paths": "Vault-relative with forward slashes. Links between notes are [[Note name]] wikilinks.",
        }))
    }

    fn list_notes(&mut self, a: &Access, args: &Value) -> Result<Value, String> {
        let folder = args
            .get("folder")
            .and_then(Value::as_str)
            .map(|f| f.trim().replace('\\', "/").trim_matches('/').to_lowercase())
            .filter(|f| !f.is_empty());
        let limit = limit_arg(args, 200, 2000);
        let notes: Vec<Value> = self
            .index()?
            .list_notes()
            .map_err(app)?
            .into_iter()
            .filter(|n| a.can_see(&n.path))
            .filter(|n| {
                folder
                    .as_ref()
                    .is_none_or(|f| n.path.to_lowercase().starts_with(&format!("{f}/")))
            })
            .map(|n| json!({ "path": n.path, "title": n.title }))
            .collect();
        let total = notes.len();
        Ok(json!({
            "total": total,
            "notes": notes.into_iter().take(limit).collect::<Vec<_>>(),
            "truncated": total > limit,
        }))
    }

    fn search_notes(&mut self, a: &Access, args: &Value) -> Result<Value, String> {
        let query = text_arg(args, "query")?;
        let limit = limit_arg(args, 20, 100);
        // Hidden notes are dropped after the search, so ask for more until there are
        // enough visible ones or the index has no more matches.
        let mut fetch = 500;
        let visible = loop {
            let hits = self.index()?.search_up_to(query, fetch).map_err(app)?;
            let exhausted = hits.len() < fetch;
            let visible: Vec<_> = hits.into_iter().filter(|h| a.can_see(&h.path)).collect();
            if visible.len() >= limit || exhausted || fetch >= MAX_SEARCH_HITS {
                break visible;
            }
            fetch = (fetch * 4).min(MAX_SEARCH_HITS);
        };
        let results: Vec<Value> = visible
            .into_iter()
            .take(limit)
            .map(|h| {
                json!({
                    "path": h.path,
                    "title": h.title,
                    "heading": h.heading,
                    "snippet": h.snippet.replace(['\u{1}', '\u{2}'], "**"),
                })
            })
            .collect();
        Ok(json!({ "results": results }))
    }

    /// A note Claude may read, found by path (with or without `.md`) or by wikilink name.
    fn readable(&mut self, a: &Access, asked: &str) -> Result<String, String> {
        let mut tries = vec![asked.to_string()];
        if !is_indexed(asked.rsplit('/').next().unwrap_or(asked)) {
            tries.push(format!("{}.md", asked.trim_end_matches('/')));
        }
        for t in &tries {
            if let Ok(p) = real_path(&self.vault, t) {
                if self.vault.resolve(&p).is_ok_and(|abs| abs.is_file()) {
                    return self.shared_note(a, &p, asked);
                }
            }
        }
        let resolved = self.index()?.resolve(asked, "").map_err(app)?;
        match resolved {
            Some(p) => self.shared_note(a, &p, asked),
            None => Err(not_shared(asked)),
        }
    }

    fn shared_note(&self, a: &Access, path: &str, asked: &str) -> Result<String, String> {
        let name = path.rsplit('/').next().unwrap_or(path);
        if is_indexed(name) && a.can_see(path) && !self.marked(path) {
            Ok(path.to_string())
        } else {
            Err(not_shared(asked))
        }
    }

    fn read_note(&mut self, a: &Access, args: &Value) -> Result<Value, String> {
        let path = self.readable(a, text_arg(args, "path")?)?;
        let file = self.vault.read_file(&path).map_err(app)?;
        let truncated = file.content.len() > MAX_NOTE_BYTES;
        let mut content = file.content;
        if truncated {
            let mut end = MAX_NOTE_BYTES;
            while !content.is_char_boundary(end) {
                end -= 1;
            }
            content.truncate(end);
        }
        Ok(json!({
            "path": path,
            "modifiedMs": file.modified_ms,
            "truncated": truncated,
            "content": content,
        }))
    }

    fn backlinks(&mut self, a: &Access, args: &Value) -> Result<Value, String> {
        let path = self.readable(a, text_arg(args, "path")?)?;
        let links: Vec<Value> = self
            .index()?
            .backlinks(&path)
            .map_err(app)?
            .into_iter()
            .filter(|b| a.can_see(&b.source))
            .map(|b| {
                json!({
                    "source": b.source,
                    "links": b.links.iter().map(|l| json!({ "line": l.line, "text": l.context, "embed": l.embed })).collect::<Vec<_>>(),
                })
            })
            .collect();
        Ok(json!({ "path": path, "backlinks": links }))
    }

    fn list_tasks(&mut self, a: &Access, args: &Value) -> Result<Value, String> {
        let done = args
            .get("includeDone")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let limit = limit_arg(args, 200, 2000);
        let tasks: Vec<Value> = self
            .index()?
            .tasks()
            .map_err(app)?
            .into_iter()
            .filter(|t| (done || !t.done) && a.can_see(&t.path))
            .take(limit)
            .map(|t| {
                json!({
                    "path": t.path, "line": t.line, "text": t.text, "done": t.done,
                    "due": t.due, "priority": t.priority, "raw": t.raw,
                })
            })
            .collect();
        Ok(json!({ "tasks": tasks }))
    }

    /// A Markdown path Claude may write: `.md` added unless it's there, spelled
    /// as on disk, and shared with cloud AI.
    fn writable(&self, a: &Access, asked: &str) -> Result<String, String> {
        let trimmed = asked.trim().trim_end_matches('/');
        let with_ext = if trimmed.to_lowercase().ends_with(".md") {
            trimmed.to_string()
        } else {
            format!("{trimmed}.md")
        };
        let path = real_path(&self.vault, &with_ext)?;
        if !is_note(path.rsplit('/').next().unwrap_or(&path)) {
            return Err(format!(
                "Claude can only write Markdown notes (.md), not \"{asked}\"."
            ));
        }
        if !a.can_see(&path) || self.marked(&path) {
            return Err(format!(
                "\"{asked}\" is in a folder AXISNotes keeps from cloud AI, so Claude can't write there."
            ));
        }
        Ok(path)
    }

    /// The file on disk carries an AI mark stricter than "any" (read now, not from the
    /// index, so a mark added a moment ago counts; an unreadable file counts as marked).
    fn marked(&self, path: &str) -> bool {
        match self.vault.read_file(path) {
            Ok(f) => privacy::note_mark(path, &f.content).is_some_and(|r| r != AiRule::Any),
            Err(AppError::NotFound(_)) => false,
            Err(_) => true,
        }
    }

    fn after_write(&mut self, path: &str) {
        let vault = self.vault.clone();
        if let Ok(index) = self.index() {
            let _ = index.update_path(&vault, path);
        }
    }

    fn create_note(&mut self, a: &Access, args: &Value) -> Result<Value, String> {
        let path = self.writable(a, text_arg(args, "path")?)?;
        let content = text_arg(args, "content")?;
        match self.vault.create_file(&path, content) {
            Ok(_) => {}
            Err(AppError::AlreadyExists(_)) => {
                return Err(format!(
                    "\"{path}\" already exists. Read it and use edit_note, replace_in_note or append_to_note."
                ))
            }
            Err(e) => return Err(app(e)),
        }
        self.after_write(&path);
        let modified = self.vault.read_file(&path).map_err(app)?.modified_ms;
        Ok(json!({ "created": path, "modifiedMs": modified }))
    }

    fn existing(&self, path: &str) -> Result<crate::vault::FileContent, String> {
        self.vault.read_file(path).map_err(|e| match e {
            AppError::NotFound(_) => format!("\"{path}\" doesn't exist; use create_note."),
            e => app(e),
        })
    }

    fn save(&mut self, path: &str, content: &str, expected: u64) -> Result<u64, String> {
        let written = self
            .vault
            .write_file(path, content, Some(expected))
            .map_err(|e| match e {
                AppError::Conflict(_) => format!(
                    "\"{path}\" changed since it was read, so nothing was written. Read it again and retry."
                ),
                e => app(e),
            })?;
        self.after_write(path);
        Ok(written.modified_ms)
    }

    fn edit_note(&mut self, a: &Access, args: &Value) -> Result<Value, String> {
        let path = self.writable(a, text_arg(args, "path")?)?;
        let content = text_arg(args, "content")?;
        let expected = args
            .get("expectedModifiedMs")
            .and_then(Value::as_u64)
            .ok_or("\"expectedModifiedMs\" (from read_note) is required.")?;
        self.existing(&path)?;
        let modified = self.save(&path, content, expected)?;
        Ok(json!({ "saved": path, "modifiedMs": modified }))
    }

    fn replace_in_note(&mut self, a: &Access, args: &Value) -> Result<Value, String> {
        let path = self.writable(a, text_arg(args, "path")?)?;
        let old = text_arg(args, "oldText")?;
        let new = text_arg(args, "newText")?;
        if old.is_empty() {
            return Err("\"oldText\" can't be empty.".into());
        }
        let file = self.existing(&path)?;
        // Notes saved on Windows may use CRLF; match either way.
        let (text, crlf) = if file.content.contains("\r\n") {
            (file.content.replace("\r\n", "\n"), true)
        } else {
            (file.content.clone(), false)
        };
        let old_n = old.replace("\r\n", "\n");
        let count = text.matches(&old_n).count();
        if count == 0 {
            return Err(format!(
                "\"oldText\" isn't in \"{path}\". Read the note and copy the text exactly."
            ));
        }
        if count > 1 {
            return Err(format!(
                "\"oldText\" appears {count} times in \"{path}\". Include more of the surrounding text so it matches once."
            ));
        }
        let mut out = text.replacen(&old_n, &new.replace("\r\n", "\n"), 1);
        if crlf {
            out = out.replace('\n', "\r\n");
        }
        let modified = self.save(&path, &out, file.modified_ms)?;
        Ok(json!({ "saved": path, "modifiedMs": modified }))
    }

    fn append(&mut self, path: &str, text: &str) -> Result<Value, String> {
        let mut add = text.trim_end_matches(['\r', '\n']).to_string();
        add.push('\n');
        match self.vault.read_file(path) {
            Ok(file) => {
                let nl = if file.content.contains("\r\n") {
                    "\r\n"
                } else {
                    "\n"
                };
                let mut out = file.content.clone();
                if !out.is_empty() && !out.ends_with('\n') {
                    out.push_str(nl);
                }
                out.push_str(&if nl == "\r\n" {
                    add.replace('\n', "\r\n")
                } else {
                    add
                });
                let modified = self.save(path, &out, file.modified_ms)?;
                Ok(json!({ "appendedTo": path, "modifiedMs": modified }))
            }
            Err(AppError::NotFound(_)) => {
                self.vault.create_file(path, &add).map_err(app)?;
                self.after_write(path);
                let modified = self.vault.read_file(path).map_err(app)?.modified_ms;
                Ok(json!({ "created": path, "modifiedMs": modified }))
            }
            Err(e) => Err(app(e)),
        }
    }

    fn append_to_daily(&mut self, a: &Access, args: &Value) -> Result<Value, String> {
        let date = parse_date(text_arg(args, "date")?)?;
        let name = format_date(date, &a.daily_format);
        let rel = if a.daily_folder.is_empty() {
            name
        } else {
            format!("{}/{name}", a.daily_folder)
        };
        let path = self.writable(a, &format!("{rel}.md"))?;
        self.append(&path, text_arg(args, "text")?)
    }

    // ---- Canvases ----

    /// A canvas path as asked (".axcanvas" optional), spelled as on disk.
    fn canvas_path(&self, asked: &str) -> Result<String, String> {
        let trimmed = asked.trim().trim_end_matches('/');
        let with_ext = if trimmed.to_lowercase().ends_with(".axcanvas") {
            trimmed.to_string()
        } else {
            format!("{trimmed}.axcanvas")
        };
        real_path(&self.vault, &with_ext)
    }

    /// An existing canvas Claude may see (the same answer for missing and kept-away ones).
    fn readable_canvas(&self, a: &Access, asked: &str) -> Result<String, String> {
        let missing = || {
            format!("No canvas at \"{asked}\" that Claude can open (it doesn't exist, or AXISNotes keeps it from cloud AI).")
        };
        let path = self.canvas_path(asked).map_err(|_| missing())?;
        let exists = self.vault.resolve(&path).is_ok_and(|abs| abs.is_file());
        if exists && is_canvas(&path) && a.can_see(&path) && !self.marked(&path) {
            Ok(path)
        } else {
            Err(missing())
        }
    }

    /// A canvas Claude may write.
    fn writable_canvas(&self, a: &Access, asked: &str) -> Result<String, String> {
        let path = self.canvas_path(asked)?;
        if !a.can_see(&path) || self.marked(&path) {
            return Err(format!(
                "\"{asked}\" is in a folder AXISNotes keeps from cloud AI, so Claude can't write there."
            ));
        }
        Ok(path)
    }

    /// The note a card may show: an existing Markdown note shared with Claude.
    fn card_note(&self, a: &Access, asked: &str) -> Result<String, String> {
        let trimmed = asked.trim();
        let mut tries = vec![trimmed.to_string()];
        if !trimmed.to_lowercase().ends_with(".md") {
            tries.push(format!("{trimmed}.md"));
        }
        for t in &tries {
            if let Ok(p) = real_path(&self.vault, t) {
                if is_note(&p) && self.vault.resolve(&p).is_ok_and(|abs| abs.is_file()) {
                    return self.shared_note(a, &p, asked);
                }
            }
        }
        Err(format!(
            "{} Note cards need the path of an existing note, like \"School/Biology.md\".",
            not_shared(asked)
        ))
    }

    fn read_canvas(&mut self, a: &Access, args: &Value) -> Result<Value, String> {
        let path = self.readable_canvas(a, text_arg(args, "path")?)?;
        let file = self.vault.read_file(&path).map_err(app)?;
        let scene = canvas::parse(&file.content)?;
        let (elements, truncated) = canvas::summary(&scene);
        Ok(json!({
            "path": path,
            "modifiedMs": file.modified_ms,
            "coordinates": "Canvas pixels; x, y is an element's top-left corner and y grows downward.",
            "elements": elements,
            "truncated": truncated,
        }))
    }

    /// Note cards' notes, checked before the canvas is read and changed.
    fn card_notes(&self, a: &Access, shapes: &[Value]) -> Result<HashMap<String, String>, String> {
        let mut out = HashMap::new();
        for sh in shapes {
            if sh.get("type").and_then(Value::as_str) == Some("noteCard") {
                if let Some(asked) = sh.get("note").and_then(Value::as_str) {
                    out.insert(asked.to_string(), self.card_note(a, asked)?);
                }
            }
        }
        Ok(out)
    }

    /// Read the canvas, apply `edit`, and write it back if nobody wrote in between (a write
    /// in between is retried on the new version, since edits are by id).
    fn edit_canvas(
        &mut self,
        path: &str,
        create: bool,
        edit: impl Fn(&mut Value, &canvas::Rng) -> Result<Value, String>,
    ) -> Result<Value, String> {
        let rng = canvas::Rng::new();
        for attempt in 0..3 {
            let (mut scene, expected) = match self.vault.read_file(path) {
                Ok(_) if create => {
                    return Err(format!("\"{path}\" already exists. Use read_canvas and add_to_canvas."))
                }
                Ok(file) => (canvas::parse(&file.content)?, Some(file.modified_ms)),
                Err(AppError::NotFound(_)) if create => (canvas::empty(), None),
                Err(AppError::NotFound(_)) => {
                    return Err(format!("\"{path}\" doesn't exist; use create_canvas."))
                }
                Err(e) => return Err(app(e)),
            };
            let mut report = edit(&mut scene, &rng)?;
            let text = canvas::serialize(&scene);
            let written = match expected {
                None => self.vault.create_file(path, &text).map(|_| ()),
                Some(m) => self.vault.write_file(path, &text, Some(m)).map(|_| ()),
            };
            match written {
                Ok(()) => {
                    self.after_write(path);
                    let modified = self.vault.read_file(path).map_err(app)?.modified_ms;
                    report["path"] = json!(path);
                    report["modifiedMs"] = json!(modified);
                    return Ok(report);
                }
                Err(AppError::Conflict(_)) if attempt < 2 => continue,
                Err(AppError::Conflict(_)) => {
                    return Err(format!(
                        "\"{path}\" keeps changing (it is being edited), so nothing was written. Try again in a moment."
                    ))
                }
                Err(e) => return Err(app(e)),
            }
        }
        unreachable!("the last attempt returns")
    }

    fn draw(&mut self, a: &Access, args: &Value, create: bool) -> Result<Value, String> {
        let asked = text_arg(args, "path")?;
        let path = if create {
            self.writable_canvas(a, asked)?
        } else {
            let p = self.readable_canvas(a, asked)?;
            self.writable_canvas(a, &p)?
        };
        let shapes = array_arg(args, "shapes")?;
        let arrows = array_arg(args, "arrows")?;
        let notes = self.card_notes(a, &shapes)?;
        self.edit_canvas(&path, create, |scene, rng| {
            if create && shapes.is_empty() && arrows.is_empty() {
                return Ok(json!({ "added": { "shapes": [], "arrows": [] } }));
            }
            let note_ok = |asked: &str| {
                notes
                    .get(asked)
                    .cloned()
                    .ok_or_else(|| not_shared(asked))
            };
            let added = canvas::add(scene, &shapes, &arrows, &note_ok, rng)?;
            Ok(json!({ "added": { "shapes": added.shapes, "arrows": added.arrows } }))
        })
    }

    fn create_canvas(&mut self, a: &Access, args: &Value) -> Result<Value, String> {
        self.draw(a, args, true)
    }

    fn add_to_canvas(&mut self, a: &Access, args: &Value) -> Result<Value, String> {
        self.draw(a, args, false)
    }

    fn change_canvas(&mut self, a: &Access, args: &Value) -> Result<Value, String> {
        let p = self.readable_canvas(a, text_arg(args, "path")?)?;
        let path = self.writable_canvas(a, &p)?;
        let changes = array_arg(args, "changes")?;
        let delete: Vec<String> = array_arg(args, "delete")?
            .into_iter()
            .map(|v| v.as_str().map(str::to_string).ok_or("\"delete\" must list ids (text)."))
            .collect::<Result<_, _>>()?;
        self.edit_canvas(&path, false, |scene, rng| {
            let done = canvas::change(scene, &changes, &delete, rng)?;
            Ok(json!({ "changed": done.changed, "deleted": done.deleted }))
        })
    }
}

// ---- Dates (mirrors src/lib/dates.ts) ----

pub type Ymd = (i32, u32, u32);

pub fn parse_date(s: &str) -> Result<Ymd, String> {
    let bad = || format!("\"{s}\" isn't a date like 2026-11-08.");
    let parts: Vec<&str> = s.trim().split('-').collect();
    let [y, m, d] = parts.as_slice() else {
        return Err(bad());
    };
    if y.len() != 4 || m.len() != 2 || d.len() != 2 {
        return Err(bad());
    }
    let (y, m, d) = (
        y.parse::<i32>().map_err(|_| bad())?,
        m.parse::<u32>().map_err(|_| bad())?,
        d.parse::<u32>().map_err(|_| bad())?,
    );
    if !(1..=12).contains(&m) || d == 0 || d > days_in_month(y, m) {
        return Err(bad());
    }
    Ok((y, m, d))
}

fn days_in_month(y: i32, m: u32) -> u32 {
    match m {
        2 if (y % 4 == 0 && y % 100 != 0) || y % 400 == 0 => 29,
        2 => 28,
        4 | 6 | 9 | 11 => 30,
        _ => 31,
    }
}

/// 0 = Sunday (Sakamoto's method).
fn weekday((y, m, d): Ymd) -> usize {
    const T: [i32; 12] = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4];
    let y = if m < 3 { y - 1 } else { y };
    ((y + y / 4 - y / 100 + y / 400 + T[m as usize - 1] + d as i32) % 7) as usize
}

const MONTHS: [&str; 12] = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
];
const DAYS: [&str; 7] = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
];
/// Longest first, in the order `TOKEN_RE` in dates.ts tries them.
const TOKENS: [&str; 14] = [
    "YYYY", "YY", "MMMM", "MMM", "MM", "M", "DD", "D", "dddd", "ddd", "HH", "H", "mm", "ss",
];

pub fn format_date(date: Ymd, format: &str) -> String {
    let (y, m, d) = date;
    let mut out = String::new();
    let mut rest = format;
    while !rest.is_empty() {
        if let Some(inner) = rest.strip_prefix('[') {
            if let Some(end) = inner.find(']') {
                out.push_str(&inner[..end]);
                rest = &inner[end + 1..];
                continue;
            }
        }
        if let Some(tok) = TOKENS.iter().find(|t| rest.starts_with(**t)) {
            let month = MONTHS[m as usize - 1];
            let day = DAYS[weekday(date)];
            out.push_str(&match *tok {
                "YYYY" => y.to_string(),
                "YY" => format!("{:02}", y.rem_euclid(100)),
                "MMMM" => month.to_string(),
                "MMM" => month[..3].to_string(),
                "MM" => format!("{m:02}"),
                "M" => m.to_string(),
                "DD" => format!("{d:02}"),
                "D" => d.to_string(),
                "dddd" => day.to_string(),
                "ddd" => day[..3].to_string(),
                // A daily note is a whole day: times read as midnight.
                "HH" | "mm" | "ss" => "00".to_string(),
                _ => "0".to_string(),
            });
            rest = &rest[tok.len()..];
            continue;
        }
        let ch = rest.chars().next().unwrap();
        out.push(ch);
        rest = &rest[ch.len_utf8()..];
    }
    out
}
