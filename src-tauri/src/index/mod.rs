//! Rebuildable SQLite index of the vault's notes (`.axisnotes/index.db`): metadata, links,
//! tags, aliases and an FTS5 full-text table. Files stay the source of truth.

pub mod graph;
pub mod parse;
pub mod rename;
pub mod search;
pub mod tasks;
pub mod time;

use std::collections::{HashMap, HashSet};
use std::path::Path;

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

use crate::error::{AppError, AppResult};
use crate::vault::{modified_ms, Vault, Walk, META_DIR};

const SCHEMA_VERSION: i32 = 2;

const SCHEMA: &str = "
CREATE TABLE notes(
  id INTEGER PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,            -- lowercased basename without .md
  title TEXT,
  mtime INTEGER NOT NULL,
  fm_len INTEGER NOT NULL,       -- byte length of frontmatter (body offset)
  fm_lines INTEGER NOT NULL,     -- newlines in the frontmatter (body line offset)
  props TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX notes_name ON notes(name);
CREATE TABLE links(
  note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  target TEXT NOT NULL,
  target_name TEXT NOT NULL,     -- lowercased last path segment without .md
  heading TEXT, block TEXT, alias TEXT,
  embed INTEGER NOT NULL,
  start INTEGER NOT NULL, end INTEGER NOT NULL,
  target_start INTEGER NOT NULL, target_end INTEGER NOT NULL
);
CREATE INDEX links_target_name ON links(target_name);
CREATE INDEX links_note ON links(note_id);
CREATE TABLE tags(note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE, tag TEXT NOT NULL);
CREATE INDEX tags_tag ON tags(tag);
CREATE INDEX tags_note ON tags(note_id);
CREATE TABLE aliases(note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE, alias TEXT NOT NULL);
CREATE INDEX aliases_alias ON aliases(alias);
CREATE TABLE tasks(
  note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  line INTEGER NOT NULL, raw TEXT NOT NULL, text TEXT NOT NULL,
  done INTEGER NOT NULL, due TEXT, priority INTEGER NOT NULL
);
CREATE INDEX tasks_note ON tasks(note_id);
CREATE VIRTUAL TABLE fts USING fts5(title, body, tokenize = 'unicode61 remove_diacritics 2');
";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteRef {
    pub path: String,
    /// Basename without `.md`, original case.
    pub name: String,
    pub title: Option<String>,
    pub aliases: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkRef {
    /// 1-based line in the source note.
    pub line: usize,
    /// The full text of that line.
    pub context: String,
    pub embed: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Backlink {
    pub source: String,
    pub links: Vec<LinkRef>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Mention {
    pub source: String,
    pub line: usize,
    pub context: String,
    /// The matched text as written.
    pub text: String,
    /// UTF-16 offsets into the whole file (what JS string indices use).
    pub start: usize,
    pub end: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TagCount {
    pub tag: String,
    pub count: usize,
}

pub struct Index {
    conn: Connection,
}

pub(crate) fn db_err(e: rusqlite::Error) -> AppError {
    AppError::Io(format!("index: {e}"))
}

/// Lowercased last path segment without a `.md` extension.
pub fn note_name(path_or_target: &str) -> String {
    let last = path_or_target.rsplit(['/', '\\']).next().unwrap_or("");
    strip_md(last).to_lowercase()
}

pub(crate) fn strip_md(s: &str) -> &str {
    if s.len() >= 3 && s[s.len() - 3..].eq_ignore_ascii_case(".md") {
        &s[..s.len() - 3]
    } else {
        s
    }
}

fn has_ext(name: &str, ext: &str) -> bool {
    name.len() > ext.len() && name[name.len() - ext.len()..].eq_ignore_ascii_case(ext)
}

/// Markdown notes: parsed for links, tags and properties.
pub(crate) fn is_note(name: &str) -> bool {
    has_ext(name, ".md")
}

/// Grids (`.axgrid`): only their cell text is indexed, for search.
pub(crate) fn is_grid(name: &str) -> bool {
    has_ext(name, ".axgrid")
}

/// Canvases (`.axcanvas`): only their text elements are indexed, for search.
pub(crate) fn is_canvas(name: &str) -> bool {
    has_ext(name, ".axcanvas")
}

/// Files that get a row in the index.
pub(crate) fn is_indexed(name: &str) -> bool {
    is_note(name) || is_grid(name) || is_canvas(name)
}

/// Basename without its extension (for grid/canvas titles).
fn stem(path: &str) -> &str {
    let base = path.rsplit('/').next().unwrap_or(path);
    base.rfind('.').map_or(base, |i| &base[..i])
}

fn parent_dir(path: &str) -> &str {
    path.rfind('/').map_or("", |i| &path[..i])
}

fn utf16_len(s: &str) -> usize {
    s.encode_utf16().count()
}

/// (1-based line number, line text) containing byte offset `pos`.
fn line_at(text: &str, pos: usize) -> (usize, &str) {
    let pos = pos.min(text.len());
    let start = text[..pos].rfind('\n').map_or(0, |i| i + 1);
    let end = text[pos..].find('\n').map_or(text.len(), |i| pos + i);
    let line = text[..start].matches('\n').count() + 1;
    (line, text[start..end].trim_end_matches('\r'))
}

impl Index {
    /// Open (or create) the index for `vault` and bring it up to date with the files, all
    /// at once. (The app opens with `open_unsynced` and syncs in the background.)
    #[cfg(test)]
    pub fn open(vault: &Vault) -> AppResult<Self> {
        let mut index = Self::open_unsynced(vault)?;
        index.sync(vault)?;
        Ok(index)
    }

    /// Open (or create) the vault's index without bringing it up to date: opening a vault
    /// uses this, then catches the index up in the background with `sync_with_progress`.
    pub fn open_unsynced(vault: &Vault) -> AppResult<Self> {
        let path = vault.root().join(META_DIR).join("index.db");
        match Self::open_at(&path) {
            Ok(i) => Ok(i),
            Err(_) => {
                let _ = std::fs::remove_file(&path);
                Self::open_at(&path)
            }
        }
    }

    fn open_at(path: &Path) -> AppResult<Self> {
        let conn = Connection::open(path).map_err(db_err)?;
        Self::init(conn)
    }

    fn init(conn: Connection) -> AppResult<Self> {
        conn.execute_batch(
            // busy_timeout: the background sync and the app share the database file.
            "PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON;
             PRAGMA busy_timeout = 10000;",
        )
        .map_err(db_err)?;
        let version: i32 = conn
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .map_err(db_err)?;
        if version != SCHEMA_VERSION {
            conn.execute_batch(
                "DROP TABLE IF EXISTS links; DROP TABLE IF EXISTS tags; DROP TABLE IF EXISTS aliases; DROP TABLE IF EXISTS tasks;
                 DROP TABLE IF EXISTS notes; DROP TABLE IF EXISTS fts;",
            )
            .map_err(db_err)?;
            conn.execute_batch(SCHEMA).map_err(db_err)?;
            conn.execute_batch(&format!("PRAGMA user_version = {SCHEMA_VERSION}"))
                .map_err(db_err)?;
        }
        Ok(Self { conn })
    }

    /// Re-index every note whose mtime changed and drop notes that no longer exist.
    pub fn sync(&mut self, vault: &Vault) -> AppResult<()> {
        self.sync_with_progress(vault, &|| false, &mut |_, _| {})
    }

    /// `sync`, committing in batches so other connections see progress and aren't locked
    /// out for long. `progress(done, total)` is called after each batch (`total` = notes
    /// that need reading); `cancelled()` is checked between batches.
    pub fn sync_with_progress(
        &mut self,
        vault: &Vault,
        cancelled: &dyn Fn() -> bool,
        progress: &mut dyn FnMut(usize, usize),
    ) -> AppResult<()> {
        const BATCH: usize = 500;
        let mut on_disk: HashMap<String, u64> = HashMap::new();
        collect_notes(vault, vault.root(), &mut on_disk)?;
        let known: HashMap<String, u64> = {
            let mut stmt = self
                .conn
                .prepare("SELECT path, mtime FROM notes")
                .map_err(db_err)?;
            let rows = stmt
                .query_map([], |r| {
                    Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)? as u64))
                })
                .map_err(db_err)?;
            rows.collect::<Result<_, _>>().map_err(db_err)?
        };
        let gone: Vec<&String> = known.keys().filter(|p| !on_disk.contains_key(*p)).collect();
        let changed: Vec<(&String, &u64)> = on_disk
            .iter()
            .filter(|(p, m)| known.get(*p) != Some(*m))
            .collect();
        let total = changed.len();
        let tx = self.conn.transaction().map_err(db_err)?;
        for path in gone {
            remove_in(&tx, path)?;
        }
        tx.commit().map_err(db_err)?;
        progress(0, total);
        for (n, batch) in changed.chunks(BATCH).enumerate() {
            if cancelled() {
                return Ok(());
            }
            let tx = self.conn.transaction().map_err(db_err)?;
            for (path, mtime) in batch {
                if let Ok(text) = std::fs::read_to_string(vault.resolve(path)?) {
                    upsert_in(&tx, path, **mtime, &text)?;
                }
            }
            tx.commit().map_err(db_err)?;
            progress((n * BATCH + batch.len()).min(total), total);
        }
        Ok(())
    }

    /// Re-index one path after it changed on disk (removes it if it's gone or not a note).
    pub fn update_path(&mut self, vault: &Vault, rel: &str) -> AppResult<()> {
        let abs = vault.resolve(rel)?;
        if abs.is_dir() {
            return self.sync(vault);
        }
        if !is_indexed(rel) || !abs.is_file() {
            return self.remove_path(rel);
        }
        let text = std::fs::read_to_string(&abs)?;
        let mtime = std::fs::metadata(&abs).map(|m| modified_ms(&m))?;
        let tx = self.conn.transaction().map_err(db_err)?;
        upsert_in(&tx, rel, mtime, &text)?;
        tx.commit().map_err(db_err)
    }

    /// Remove a note, or every note under a folder.
    pub fn remove_path(&mut self, rel: &str) -> AppResult<()> {
        let tx = self.conn.transaction().map_err(db_err)?;
        remove_in(&tx, rel)?;
        let prefix = format!("{}/%", like_escape(rel));
        let inside: Vec<String> = {
            let mut stmt = tx
                .prepare("SELECT path FROM notes WHERE path LIKE ?1 ESCAPE '\\'")
                .map_err(db_err)?;
            let rows = stmt.query_map([prefix], |r| r.get(0)).map_err(db_err)?;
            rows.collect::<Result<_, _>>().map_err(db_err)?
        };
        for p in inside {
            remove_in(&tx, &p)?;
        }
        tx.commit().map_err(db_err)
    }

    pub fn note_paths_under(&self, dir: &str) -> AppResult<Vec<String>> {
        let prefix = format!("{}/%", like_escape(dir));
        let mut stmt = self
            .conn
            .prepare("SELECT path FROM notes WHERE path LIKE ?1 ESCAPE '\\' ORDER BY path")
            .map_err(db_err)?;
        let rows = stmt.query_map([prefix], |r| r.get(0)).map_err(db_err)?;
        rows.collect::<Result<_, _>>().map_err(db_err)
    }

    /// Every indexed canvas (`.axcanvas`), for rewriting note cards on rename.
    pub fn canvas_paths(&self) -> AppResult<Vec<String>> {
        let mut stmt = self
            .conn
            .prepare("SELECT path FROM notes WHERE path LIKE '%.axcanvas' ORDER BY path")
            .map_err(db_err)?;
        let rows = stmt.query_map([], |r| r.get(0)).map_err(db_err)?;
        rows.collect::<Result<_, _>>().map_err(db_err)
    }

    pub fn list_notes(&self) -> AppResult<Vec<NoteRef>> {
        let mut aliases: HashMap<i64, Vec<String>> = HashMap::new();
        {
            let mut stmt = self
                .conn
                .prepare("SELECT note_id, alias FROM aliases")
                .map_err(db_err)?;
            let rows = stmt
                .query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))
                .map_err(db_err)?;
            for row in rows {
                let (id, a) = row.map_err(db_err)?;
                aliases.entry(id).or_default().push(a);
            }
        }
        let mut stmt = self
            .conn
            .prepare("SELECT id, path, title FROM notes ORDER BY path")
            .map_err(db_err)?;
        let rows = stmt
            .query_map([], |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, Option<String>>(2)?,
                ))
            })
            .map_err(db_err)?;
        rows.map(|row| {
            let (id, path, title) = row.map_err(db_err)?;
            let name = strip_md(path.rsplit('/').next().unwrap_or("")).to_string();
            Ok(NoteRef {
                path,
                name,
                title,
                aliases: aliases.remove(&id).unwrap_or_default(),
            })
        })
        .collect()
    }

    /// Resolve a wikilink target written in `from` to a note path (Obsidian semantics:
    /// by name anywhere in the vault; paths narrow it; same folder, then shortest path wins).
    pub fn resolve(&self, target: &str, from: &str) -> AppResult<Option<String>> {
        let t = target.trim().replace('\\', "/");
        let t = strip_md(t.trim_start_matches('/'));
        if t.is_empty() {
            return Ok(Some(from.to_string())); // [[#Heading]] = this note
        }
        let name = note_name(t);
        let mut candidates: Vec<String> = {
            let mut stmt = self
                .conn
                .prepare_cached("SELECT path FROM notes WHERE name = ?1")
                .map_err(db_err)?;
            let rows = stmt.query_map([&name], |r| r.get(0)).map_err(db_err)?;
            rows.collect::<Result<_, _>>().map_err(db_err)?
        };
        if t.contains('/') {
            let want = t.to_lowercase();
            candidates.retain(|p| {
                let p = strip_md(p).to_lowercase();
                p == want || p.ends_with(&format!("/{want}"))
            });
        }
        if candidates.is_empty() && !t.contains('/') {
            let mut stmt = self
                .conn
                .prepare_cached("SELECT n.path FROM aliases a JOIN notes n ON n.id = a.note_id WHERE lower(a.alias) = ?1")
                .map_err(db_err)?;
            let rows = stmt
                .query_map([t.to_lowercase()], |r| r.get(0))
                .map_err(db_err)?;
            candidates = rows.collect::<Result<_, _>>().map_err(db_err)?;
        }
        let from_dir = parent_dir(from);
        candidates.sort_by(|a, b| {
            (parent_dir(a) != from_dir, a.len(), a.as_str()).cmp(&(
                parent_dir(b) != from_dir,
                b.len(),
                b.as_str(),
            ))
        });
        Ok(candidates.into_iter().next())
    }

    /// Raw links (with byte ranges) in other notes that resolve to `path`.
    fn incoming(&self, path: &str) -> AppResult<Vec<Incoming>> {
        let id: Option<i64> = self
            .conn
            .query_row("SELECT id FROM notes WHERE path = ?1", [path], |r| r.get(0))
            .optional()
            .map_err(db_err)?;
        let mut names: Vec<String> = vec![note_name(path)];
        if let Some(id) = id {
            let mut stmt = self
                .conn
                .prepare("SELECT alias FROM aliases WHERE note_id = ?1")
                .map_err(db_err)?;
            let rows = stmt
                .query_map([id], |r| r.get::<_, String>(0))
                .map_err(db_err)?;
            for a in rows {
                names.push(note_name(&a.map_err(db_err)?));
            }
        }
        let mut out = Vec::new();
        let mut stmt = self
            .conn
            .prepare_cached(
                "SELECT n.path, n.fm_len, l.target, l.embed, l.start, l.target_start, l.target_end, n.id, n.fm_lines
                 FROM links l JOIN notes n ON n.id = l.note_id WHERE l.target_name = ?1",
            )
            .map_err(db_err)?;
        let mut seen = HashSet::new();
        for name in names {
            let rows = stmt
                .query_map([&name], |r| {
                    Ok(Incoming {
                        source: r.get(0)?,
                        fm_len: r.get::<_, i64>(1)? as usize,
                        target: r.get(2)?,
                        embed: r.get::<_, i64>(3)? != 0,
                        start: r.get::<_, i64>(4)? as usize,
                        target_start: r.get::<_, i64>(5)? as usize,
                        target_end: r.get::<_, i64>(6)? as usize,
                        note_id: r.get(7)?,
                        fm_lines: r.get::<_, i64>(8)? as usize,
                    })
                })
                .map_err(db_err)?;
            for row in rows {
                let inc = row.map_err(db_err)?;
                if seen.insert((inc.source.clone(), inc.start))
                    && self.resolve(&inc.target, &inc.source)?.as_deref() == Some(path)
                {
                    out.push(inc);
                }
            }
        }
        Ok(out)
    }

    fn body_of(&self, note_id: i64) -> AppResult<String> {
        self.conn
            .query_row("SELECT body FROM fts WHERE rowid = ?1", [note_id], |r| {
                r.get(0)
            })
            .map_err(db_err)
    }

    pub fn backlinks(&self, path: &str) -> AppResult<Vec<Backlink>> {
        let mut grouped: Vec<Backlink> = Vec::new();
        let mut bodies: HashMap<i64, String> = HashMap::new();
        for inc in self.incoming(path)? {
            if inc.source == path {
                continue;
            }
            let body = match bodies.get(&inc.note_id) {
                Some(b) => b,
                None => bodies
                    .entry(inc.note_id)
                    .or_insert(self.body_of(inc.note_id)?),
            };
            let (line, context) = line_at(body, inc.start.saturating_sub(inc.fm_len));
            let link = LinkRef {
                line: line + inc.fm_lines,
                context: context.to_string(),
                embed: inc.embed,
            };
            match grouped.iter_mut().find(|b| b.source == inc.source) {
                Some(b) => b.links.push(link),
                None => grouped.push(Backlink {
                    source: inc.source.clone(),
                    links: vec![link],
                }),
            }
        }
        grouped.sort_by(|a, b| a.source.cmp(&b.source));
        for b in &mut grouped {
            b.links.sort_by_key(|l| l.line);
        }
        Ok(grouped)
    }

    /// Plain-text occurrences of this note's name/aliases in other notes that are not links.
    pub fn unlinked_mentions(&self, vault: &Vault, path: &str) -> AppResult<Vec<Mention>> {
        let mut terms: Vec<String> =
            vec![strip_md(path.rsplit('/').next().unwrap_or("")).to_string()];
        {
            let mut stmt = self
                .conn
                .prepare("SELECT a.alias FROM aliases a JOIN notes n ON n.id = a.note_id WHERE n.path = ?1")
                .map_err(db_err)?;
            let rows = stmt
                .query_map([path], |r| r.get::<_, String>(0))
                .map_err(db_err)?;
            for a in rows {
                terms.push(a.map_err(db_err)?);
            }
        }
        terms.retain(|t| t.chars().count() >= 2);
        let mut out = Vec::new();
        let mut candidates: HashSet<String> = HashSet::new();
        for term in &terms {
            let phrase = format!("\"{}\"", term.replace('"', "\"\""));
            let mut stmt = self
                .conn
                .prepare(
                    "SELECT n.path FROM fts JOIN notes n ON n.id = fts.rowid WHERE fts MATCH ?1",
                )
                .map_err(db_err)?;
            let rows = stmt
                .query_map([format!("body : {phrase}")], |r| r.get::<_, String>(0))
                .map_err(db_err)?;
            for p in rows {
                candidates.insert(p.map_err(db_err)?);
            }
        }
        candidates.remove(path);
        candidates.retain(|p| is_note(p)); // mentions are only linkable in Markdown
        let mut sources: Vec<String> = candidates.into_iter().collect();
        sources.sort();
        for source in sources {
            let Ok(text) = std::fs::read_to_string(vault.resolve(&source)?) else {
                continue;
            };
            let parsed = parse::parse(&text);
            let mut excluded: Vec<std::ops::Range<usize>> = parse::code_ranges(&text);
            excluded.extend(parsed.links.iter().map(|l| l.start..l.end));
            excluded.push(0..parsed.frontmatter_len);
            let lower = text.to_lowercase();
            // Lowercasing can change byte lengths for some scripts; only use it when it doesn't.
            let haystack = if lower.len() == text.len() {
                lower.as_str()
            } else {
                text.as_str()
            };
            for term in &terms {
                let needle = if haystack.len() == text.len() && lower.len() == text.len() {
                    term.to_lowercase()
                } else {
                    term.clone()
                };
                let mut from = 0;
                while let Some(i) = haystack[from..].find(&needle) {
                    let start = from + i;
                    let end = start + needle.len();
                    from = end;
                    let before = text[..start].chars().next_back();
                    let after = text[end..].chars().next();
                    let boundary = before.is_none_or(|c| !c.is_alphanumeric())
                        && after.is_none_or(|c| !c.is_alphanumeric());
                    if !boundary || excluded.iter().any(|r| r.start < end && start < r.end) {
                        continue;
                    }
                    let (line, context) = line_at(&text, start);
                    out.push(Mention {
                        source: source.clone(),
                        line,
                        context: context.to_string(),
                        text: text[start..end].to_string(),
                        start: utf16_len(&text[..start]),
                        end: utf16_len(&text[..end]),
                    });
                }
            }
        }
        Ok(out)
    }

    pub fn tags(&self) -> AppResult<Vec<TagCount>> {
        let mut stmt = self
            .conn
            .prepare("SELECT tag, COUNT(DISTINCT note_id) FROM tags GROUP BY tag ORDER BY tag")
            .map_err(db_err)?;
        let rows = stmt
            .query_map([], |r| {
                Ok(TagCount {
                    tag: r.get(0)?,
                    count: r.get::<_, i64>(1)? as usize,
                })
            })
            .map_err(db_err)?;
        rows.collect::<Result<_, _>>().map_err(db_err)
    }

    /// Links that point at `old_path`, for rewriting after a rename/move.
    pub fn links_into(&self, old_path: &str) -> AppResult<Vec<LinkSite>> {
        Ok(self
            .incoming(old_path)?
            .into_iter()
            .map(|i| LinkSite {
                source: i.source,
                target: i.target,
                target_start: i.target_start,
                target_end: i.target_end,
            })
            .collect())
    }

    pub(crate) fn conn(&self) -> &Connection {
        &self.conn
    }
}

struct Incoming {
    source: String,
    fm_len: usize,
    target: String,
    embed: bool,
    start: usize,
    target_start: usize,
    target_end: usize,
    note_id: i64,
    fm_lines: usize,
}

#[derive(Debug, Clone)]
pub struct LinkSite {
    pub source: String,
    pub target: String,
    pub target_start: usize,
    pub target_end: usize,
}

pub(crate) fn like_escape(s: &str) -> String {
    s.replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}

fn collect_notes(vault: &Vault, dir: &Path, out: &mut HashMap<String, u64>) -> AppResult<()> {
    let (mut walk, real) = Walk::new(dir);
    collect_in(vault, dir, &real, &mut walk, out);
    Ok(())
}

fn collect_in(
    vault: &Vault,
    dir: &Path,
    real: &Path,
    walk: &mut Walk,
    out: &mut HashMap<String, u64>,
) {
    for child in walk.children(dir, real) {
        if child.is_dir {
            collect_in(vault, &child.path, &child.real, walk, out);
        } else if is_indexed(&child.name) {
            if let Some(rel) = vault.to_rel(&child.path) {
                out.insert(rel, modified_ms(&child.meta));
            }
        }
    }
}

fn remove_in(tx: &rusqlite::Transaction, path: &str) -> AppResult<()> {
    let id: Option<i64> = tx
        .query_row("SELECT id FROM notes WHERE path = ?1", [path], |r| r.get(0))
        .optional()
        .map_err(db_err)?;
    if let Some(id) = id {
        tx.execute("DELETE FROM fts WHERE rowid = ?1", [id])
            .map_err(db_err)?;
        tx.execute("DELETE FROM notes WHERE id = ?1", [id])
            .map_err(db_err)?;
    }
    Ok(())
}

fn upsert_in(tx: &rusqlite::Transaction, path: &str, mtime: u64, text: &str) -> AppResult<()> {
    let note = if is_grid(path) {
        parse::ParsedNote {
            title: Some(stem(path).to_string()),
            ..parse::parse_grid(text)
        }
    } else if is_canvas(path) {
        parse::ParsedNote {
            title: Some(stem(path).to_string()),
            ..parse::parse_canvas(text)
        }
    } else {
        parse::parse(text)
    };
    let name = note_name(path);
    let props = serde_json::Value::Object(note.props.clone()).to_string();
    let fm_lines = text[..note.frontmatter_len].matches('\n').count() as i64;
    let existing: Option<i64> = tx
        .query_row("SELECT id FROM notes WHERE path = ?1", [path], |r| r.get(0))
        .optional()
        .map_err(db_err)?;
    let id = match existing {
        Some(id) => {
            tx.execute(
                "UPDATE notes SET name = ?2, title = ?3, mtime = ?4, fm_len = ?5, props = ?6, fm_lines = ?7 WHERE id = ?1",
                params![id, name, note.title, mtime as i64, note.frontmatter_len as i64, props, fm_lines],
            )
            .map_err(db_err)?;
            for table in ["links", "tags", "aliases", "tasks"] {
                tx.execute(&format!("DELETE FROM {table} WHERE note_id = ?1"), [id])
                    .map_err(db_err)?;
            }
            tx.execute("DELETE FROM fts WHERE rowid = ?1", [id])
                .map_err(db_err)?;
            id
        }
        None => {
            tx.execute(
                "INSERT INTO notes(path, name, title, mtime, fm_len, props, fm_lines) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![path, name, note.title, mtime as i64, note.frontmatter_len as i64, props, fm_lines],
            )
            .map_err(db_err)?;
            tx.last_insert_rowid()
        }
    };
    {
        let mut stmt = tx
            .prepare_cached(
                "INSERT INTO links(note_id, target, target_name, heading, block, alias, embed, start, end, target_start, target_end)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            )
            .map_err(db_err)?;
        for l in &note.links {
            stmt.execute(params![
                id,
                l.target,
                note_name(&l.target),
                l.heading,
                l.block,
                l.alias,
                l.embed as i64,
                l.start as i64,
                l.end as i64,
                l.target_start as i64,
                l.target_end as i64
            ])
            .map_err(db_err)?;
        }
        let mut tag_stmt = tx
            .prepare_cached("INSERT INTO tags(note_id, tag) VALUES (?1, ?2)")
            .map_err(db_err)?;
        for t in &note.tags {
            tag_stmt.execute(params![id, t]).map_err(db_err)?;
        }
        let mut alias_stmt = tx
            .prepare_cached("INSERT INTO aliases(note_id, alias) VALUES (?1, ?2)")
            .map_err(db_err)?;
        for a in &note.aliases {
            alias_stmt.execute(params![id, a]).map_err(db_err)?;
        }
        let mut task_stmt = tx
            .prepare_cached(
                "INSERT INTO tasks(note_id, line, raw, text, done, due, priority) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            )
            .map_err(db_err)?;
        for t in &note.tasks {
            task_stmt
                .execute(params![
                    id,
                    t.line as i64,
                    t.raw,
                    t.text,
                    t.done as i64,
                    t.due,
                    t.priority as i64
                ])
                .map_err(db_err)?;
        }
    }
    let title = note
        .title
        .clone()
        .unwrap_or_else(|| strip_md(path.rsplit('/').next().unwrap_or("")).to_string());
    tx.execute(
        "INSERT INTO fts(rowid, title, body) VALUES (?1, ?2, ?3)",
        params![id, title, note.body],
    )
    .map_err(db_err)?;
    Ok(())
}

#[cfg(test)]
mod tests;
