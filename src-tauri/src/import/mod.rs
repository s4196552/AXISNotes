//! Importing notes from other apps into a new folder of the open vault:
//!
//! - **Obsidian** vault folder: copied as it is (Obsidian's Markdown is AXISNotes's), JSON
//!   Canvas files converted, `.obsidian/` left out and its template/daily-note settings read.
//! - **Notion** "Markdown & CSV" export (`.zip`, multi-part zips, or unzipped): the 32-character
//!   IDs dropped from names, links rewritten to match, databases turned into grids (or
//!   Markdown tables) and row properties into frontmatter, HTML pages converted.
//! - **Markdown** folder or `.zip` (Bear, Logseq, Roam, Typora, Joplin, Simplenote…):
//!   `.md`/`.txt` notes and HTML pages, with relative links to notes made wikilinks.
//! - **Evernote** `.enex` notebooks (one file, or a folder of them).
//!
//! The source is never changed, and nothing in the vault is overwritten: the import folder
//! is new (`Imported/Notion 2026-10-20 2` if that name is taken) and names inside it are
//! made unique.

mod canvas;
mod enex;
mod html;
mod plan;
mod source;
mod tables;

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::vault::{validate_name, Vault};

pub use canvas::json_canvas_to_axcanvas;
use plan::{file_name, parent, FileKind, LinkStats, Linker, Plan, Rules};
use source::Input;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ImportKind {
    Obsidian,
    Notion,
    Markdown,
    Evernote,
}

#[derive(Debug, Clone, Copy, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportOptions {
    /// Notion databases as Markdown tables (with links to their rows) instead of grids.
    #[serde(default)]
    pub tables_as_markdown: bool,
}

/// Obsidian settings worth carrying over (paths are inside the import folder).
#[derive(Debug, Clone, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ObsidianSettings {
    pub templates_folder: Option<String>,
    pub daily_folder: Option<String>,
    pub daily_format: Option<String>,
    pub daily_template: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Skipped {
    pub path: String,
    pub reason: String,
}

/// What an import would bring in, shown before it runs.
#[derive(Debug, Clone, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ImportPreview {
    /// The export's name (folder or file name without extension).
    pub name: String,
    pub notes: usize,
    pub attachments: usize,
    pub tables: usize,
    pub canvases: usize,
    /// What the source looks like, when it isn't the kind chosen.
    pub looks_like: Option<ImportKind>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ImportReport {
    /// Vault folder the files went into.
    pub target: String,
    pub notes: usize,
    pub attachments: usize,
    pub canvases: usize,
    /// Database tables (grids or Markdown tables).
    pub tables: usize,
    /// Links rewritten to point at the imported notes and files.
    pub links: usize,
    pub skipped: Vec<Skipped>,
    pub warnings: Vec<String>,
    pub settings: ObsidianSettings,
}

/// Whether `dir` looks like an Obsidian vault (has `.obsidian/`).
pub fn is_obsidian_vault(dir: &Path) -> bool {
    dir.join(".obsidian").is_dir()
}

fn json_field(v: &serde_json::Value, key: &str) -> Option<String> {
    v.get(key)
        .and_then(|x| x.as_str())
        .map(|s| s.trim().trim_matches('/').to_string())
        .filter(|s| !s.is_empty())
}

fn read_json(path: PathBuf) -> Option<serde_json::Value> {
    serde_json::from_str(&fs::read_to_string(path).ok()?).ok()
}

/// Template and daily-note settings from `.obsidian/`, prefixed with `target`.
pub fn read_settings(source: &Path, target: &str) -> ObsidianSettings {
    let obs = source.join(".obsidian");
    let within = |p: String| {
        if target.is_empty() {
            p
        } else {
            format!("{target}/{p}")
        }
    };
    let mut s = ObsidianSettings::default();
    if let Some(v) = read_json(obs.join("templates.json")) {
        s.templates_folder = json_field(&v, "folder").map(within);
    }
    if let Some(v) = read_json(obs.join("daily-notes.json")) {
        s.daily_folder = json_field(&v, "folder").map(within);
        // Moment.js tokens; the common ones (YYYY, MM, DD, ddd...) match AXISNotes's.
        s.daily_format = json_field(&v, "format");
        s.daily_template = json_field(&v, "template").map(|t| {
            let t = if t.ends_with(".md") {
                t
            } else {
                format!("{t}.md")
            };
            within(t)
        });
    }
    s
}

fn lower_ext(path: &str) -> String {
    let name = file_name(path);
    name.rfind('.')
        .filter(|&i| i > 0)
        .map(|i| name[i + 1..].to_ascii_lowercase())
        .unwrap_or_default()
}

fn rules(kind: ImportKind, options: ImportOptions) -> Rules {
    Rules {
        strip_ids: kind == ImportKind::Notion,
        table_ext: if options.tables_as_markdown {
            ".md"
        } else {
            ".axgrid"
        },
    }
}

/// What each file of the export becomes, and what's left out.
fn classify(kind: ImportKind, input: &Input) -> (Vec<(usize, String, FileKind)>, Vec<Skipped>) {
    let paths: HashSet<&str> = input.entries.iter().map(|e| e.path.as_str()).collect();
    // Logseq keeps its settings and backups in `logseq/`.
    let logseq = kind == ImportKind::Markdown && paths.contains("logseq/config.edn");
    let mut files = Vec::new();
    let mut skipped = Vec::new();
    for (i, e) in input.entries.iter().enumerate() {
        let path = e.path.clone();
        if logseq && path.starts_with("logseq/") {
            continue;
        }
        let ext = lower_ext(&path);
        let k = match (kind, ext.as_str()) {
            (_, "md") => FileKind::Note,
            (ImportKind::Obsidian, "canvas") => FileKind::Canvas,
            (ImportKind::Obsidian, _) => FileKind::Attachment,
            (ImportKind::Notion, "csv") => {
                // Notion writes a database twice: the view (`Tasks 0123….csv`) and the
                // whole table (`Tasks 0123…_all.csv`). The whole table wins.
                let all = format!("{}_all.csv", &path[..path.len() - 4]);
                if paths.contains(all.as_str()) {
                    skipped.push(Skipped {
                        path,
                        reason: "a view of a database; its full table was imported".into(),
                    });
                    continue;
                }
                FileKind::Table
            }
            (ImportKind::Markdown, "markdown" | "mdown" | "mkd" | "mkdn" | "txt") => FileKind::Note,
            (_, "html" | "htm") => FileKind::Html,
            _ => FileKind::Attachment,
        };
        files.push((i, path, k));
    }
    (files, skipped)
}

fn display_name(source: &Path) -> String {
    let name = if source.is_dir() {
        source.file_name()
    } else {
        source.file_stem()
    };
    name.map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default()
}

/// `.enex` files to import from `source` (the file itself, or those in a folder).
fn enex_files(source: &Path) -> AppResult<Vec<PathBuf>> {
    if source.is_file() {
        return Ok(vec![source.to_path_buf()]);
    }
    let mut out: Vec<PathBuf> = fs::read_dir(source)?
        .filter_map(Result::ok)
        .map(|e| e.path())
        .filter(|p| {
            p.is_file()
                && p.extension()
                    .is_some_and(|e| e.eq_ignore_ascii_case("enex"))
        })
        .collect();
    out.sort();
    Ok(out)
}

fn read_enex(path: &Path) -> AppResult<String> {
    if fs::metadata(path)?.len() > source::MAX_FILE_BYTES {
        return Err(AppError::Io(format!(
            "{} is too large to import",
            path.display()
        )));
    }
    let bytes = fs::read(path)?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

/// What importing `source` as `kind` would bring in.
pub fn inspect(kind: ImportKind, source: &Path) -> AppResult<ImportPreview> {
    if !source.exists() {
        return Err(AppError::NotFound(source.display().to_string()));
    }
    let mut p = ImportPreview {
        name: display_name(source),
        ..ImportPreview::default()
    };
    let is_enex = source.is_file()
        && source
            .extension()
            .is_some_and(|e| e.eq_ignore_ascii_case("enex"));
    if kind == ImportKind::Evernote || is_enex {
        let files = if kind == ImportKind::Evernote || is_enex {
            enex_files(source)?
        } else {
            Vec::new()
        };
        for f in &files {
            let (notes, resources) = enex::count(&read_enex(f)?);
            p.notes += notes;
            p.attachments += resources;
        }
        if kind != ImportKind::Evernote {
            p.looks_like = Some(ImportKind::Evernote);
        } else if files.is_empty() {
            p.warnings.push(
                "There are no .enex files here: export a notebook from Evernote first.".into(),
            );
        } else if p.notes == 0 {
            p.warnings.push("No notes found in this file.".into());
        }
        return Ok(p);
    }
    let input = Input::open(source)?;
    let (files, _) = classify(kind, &input);
    let plan = Plan::build(files, &rules(kind, ImportOptions::default()));
    let mut html = 0;
    for f in &plan.files {
        match f.kind {
            FileKind::Note => p.notes += 1,
            FileKind::Html => {
                p.notes += 1;
                html += 1;
            }
            FileKind::Table => p.tables += 1,
            FileKind::Canvas => p.canvases += 1,
            FileKind::Attachment => p.attachments += 1,
        }
    }
    let obsidian = source.is_dir() && is_obsidian_vault(source);
    let notion = if kind == ImportKind::Notion {
        plan.had_ids
    } else {
        let (files, _) = classify(ImportKind::Notion, &input);
        Plan::build(files, &rules(ImportKind::Notion, ImportOptions::default())).had_ids
    };
    let looks = if obsidian {
        ImportKind::Obsidian
    } else if notion {
        ImportKind::Notion
    } else {
        ImportKind::Markdown
    };
    // Any folder of Markdown imports fine as Markdown, Obsidian vaults included.
    if looks != kind && !(kind == ImportKind::Markdown && looks == ImportKind::Obsidian) {
        p.looks_like = Some(looks);
    }
    match kind {
        ImportKind::Obsidian if !obsidian => p.warnings.push(
            "There's no .obsidian folder here, so this may not be an Obsidian vault. Its files will still be copied."
                .into(),
        ),
        ImportKind::Notion if !notion => p.warnings.push(
            "No Notion page IDs in these names, so this may not be a Notion export. Its files will still be imported."
                .into(),
        ),
        _ => {}
    }
    if kind == ImportKind::Notion && html > 0 {
        p.warnings.push(format!(
            "{html} HTML page{} will be converted to Markdown. Notion's \"Markdown & CSV\" export keeps more (databases, properties).",
            if html == 1 { "" } else { "s" }
        ));
    }
    if p.notes + p.tables + p.canvases == 0 {
        p.warnings.push("No notes found here.".into());
    }
    Ok(p)
}

/// `target` checked (a folder inside the vault, not hidden) and made unique: `Name`,
/// `Name 2`, `Name 3`… whichever doesn't exist yet.
fn new_folder(vault: &Vault, target: &str) -> AppResult<String> {
    let target = target.trim().replace('\\', "/");
    let target = target.trim_matches('/').to_string();
    if target.is_empty() {
        return Err(AppError::InvalidName(
            "choose a folder to import into".into(),
        ));
    }
    for part in target.split('/') {
        if part.starts_with('.') {
            return Err(AppError::InvalidName(format!("import folder {target:?}")));
        }
        validate_name(part)?;
    }
    let mut n = 1;
    loop {
        let candidate = if n == 1 {
            target.clone()
        } else {
            format!("{target} {n}")
        };
        if !vault.resolve(&candidate)?.exists() {
            return Ok(candidate);
        }
        n += 1;
    }
}

/// Writes into the import folder, never over an existing file.
struct Out<'a> {
    vault: &'a Vault,
    target: String,
    report: ImportReport,
}

impl Out<'_> {
    /// Write `rel` (inside the import folder); false if it was skipped.
    fn write(&mut self, source: &str, rel: &str, bytes: &[u8], text: bool) -> bool {
        let dest = format!("{}/{rel}", self.target);
        let result = self.vault.resolve(&dest).and_then(|abs| {
            if abs.exists() {
                return Err(AppError::AlreadyExists(dest.clone()));
            }
            if text {
                self.vault
                    .write_file(&dest, &String::from_utf8_lossy(bytes), None)
                    .map(|_| ())
            } else {
                self.vault.write_bytes(&dest, bytes)
            }
        });
        match result {
            Ok(()) => true,
            Err(e) => {
                self.skip(source, &e.to_string());
                false
            }
        }
    }

    fn skip(&mut self, source: &str, reason: &str) {
        self.report.skipped.push(Skipped {
            path: source.to_string(),
            reason: reason.to_string(),
        });
    }
}

/// Import `source` as `kind` into a new folder named after `target` in `vault`.
/// `progress(done, total)` is called as files are written.
pub fn run(
    vault: &Vault,
    kind: ImportKind,
    source: &Path,
    target: &str,
    options: ImportOptions,
    progress: &mut dyn FnMut(usize, usize),
) -> AppResult<ImportReport> {
    if !source.exists() {
        return Err(AppError::NotFound(source.display().to_string()));
    }
    if source.is_dir() {
        // Importing a folder into itself (or the vault into itself) would recurse.
        let src = dunce::canonicalize(source)?;
        let root = dunce::canonicalize(vault.root())?;
        if root.starts_with(&src) || src.starts_with(&root) {
            return Err(AppError::InvalidName(
                "pick a folder outside this vault (it can't import itself)".into(),
            ));
        }
    }
    let target = new_folder(vault, target)?;
    vault.create_dir(&target)?;
    let mut out = Out {
        vault,
        target: target.clone(),
        report: ImportReport {
            target: target.clone(),
            ..ImportReport::default()
        },
    };
    if kind == ImportKind::Evernote {
        import_enex(&mut out, source, progress)?;
    } else {
        if kind == ImportKind::Obsidian && source.is_dir() {
            out.report.settings = read_settings(source, &target);
        }
        import_tree(&mut out, kind, source, options, progress)?;
    }
    Ok(out.report)
}

fn table_stem(old: &str) -> &str {
    let stem = &old[..old.len() - 4];
    stem.strip_suffix("_all").unwrap_or(stem)
}

fn import_tree(
    out: &mut Out,
    kind: ImportKind,
    source: &Path,
    options: ImportOptions,
    progress: &mut dyn FnMut(usize, usize),
) -> AppResult<()> {
    let mut input = Input::open(source)?;
    let (files, skipped) = classify(kind, &input);
    let mut plan = Plan::build(files, &rules(kind, options));
    // Pages link to a database's view; it was left out for the whole table.
    for s in &skipped {
        if let Some(view) = s.path.strip_suffix(".csv") {
            plan.alias(&s.path, &format!("{view}_all.csv"));
        }
    }
    out.report.skipped.extend(skipped);
    let target = out.target.clone();
    let linker = Linker {
        plan: &plan,
        target: &target,
        tables_as_markdown: options.tables_as_markdown,
    };
    let total = plan.files.len();
    progress(0, total);

    // Database tables first: their columns tell a row page's properties from its text.
    let mut tables: HashMap<usize, Vec<Vec<String>>> = HashMap::new();
    let mut table_dirs: HashMap<String, usize> = HashMap::new();
    for (i, f) in plan.files.iter().enumerate() {
        if f.kind != FileKind::Table {
            continue;
        }
        match input.read_text(f.entry) {
            Ok(text) => {
                table_dirs.insert(table_stem(&f.old).to_string(), i);
                tables.insert(i, tables::parse_csv(&text));
            }
            Err(e) => out.skip(&f.old, &e.to_string()),
        }
    }
    // Row pages by (database folder, title), for links from Markdown tables.
    let mut rows: HashMap<(String, String), usize> = HashMap::new();
    for (i, f) in plan.files.iter().enumerate() {
        if f.kind == FileKind::Note && table_dirs.contains_key(parent(&f.old)) {
            let stem = file_name(&f.old).trim_end_matches(".md");
            let title = plan::sanitize(plan::split_id(stem).0).to_lowercase();
            rows.entry((parent(&f.old).to_string(), title)).or_insert(i);
        }
    }

    let mut stats = LinkStats::default();
    let mut html_pages = 0;
    for (n, f) in plan.files.iter().enumerate() {
        let written = match f.kind {
            FileKind::Note | FileKind::Html => match input.read_text(f.entry) {
                Ok(text) => {
                    let text = if f.kind == FileKind::Html {
                        html_pages += 1;
                        html::Converter { media: &|_| None }.convert(&text)
                    } else {
                        text
                    };
                    // Obsidian notes are AXISNotes notes: copied byte for byte.
                    let text = if kind == ImportKind::Obsidian {
                        text
                    } else {
                        linker.rewrite_text(&text, &f.old, &f.new, &mut stats)
                    };
                    let text = if kind == ImportKind::Notion && f.kind == FileKind::Note {
                        let stem = file_name(&f.old).trim_end_matches(".md");
                        drop_title_heading(&text, plan::split_id(stem).0)
                    } else {
                        text
                    };
                    let columns = table_dirs
                        .get(parent(&f.old))
                        .and_then(|t| tables.get(t))
                        .and_then(|rows| rows.first());
                    let text = match columns {
                        Some(cols) if kind == ImportKind::Notion => {
                            tables::properties_to_frontmatter(&text, cols)
                        }
                        _ => text,
                    };
                    out.write(&f.old, &f.new, text.as_bytes(), true)
                }
                Err(e) => {
                    out.skip(&f.old, &e.to_string());
                    false
                }
            },
            FileKind::Table => match tables.get(&n) {
                Some(data) => {
                    let text = if options.tables_as_markdown {
                        let title = file_name(&f.new).trim_end_matches(".md");
                        let dir = table_stem(&f.old).to_string();
                        tables::to_markdown_table(title, data, |cell| {
                            let key = (dir.clone(), plan::sanitize(cell).to_lowercase());
                            rows.get(&key)
                                .map(|&r| linker.wikilink(&plan.files[r], cell, false, true))
                        })
                    } else {
                        tables::to_grid(data)
                    };
                    out.write(&f.old, &f.new, text.as_bytes(), true)
                }
                None => false,
            },
            FileKind::Canvas => match input.read_text(f.entry) {
                Ok(text) => match json_canvas_to_axcanvas(&text, &target) {
                    Ok(json) => out.write(&f.old, &f.new, json.as_bytes(), true),
                    Err(e) => {
                        out.skip(&f.old, &format!("not a JSON Canvas: {e}"));
                        false
                    }
                },
                Err(e) => {
                    out.skip(&f.old, &e.to_string());
                    false
                }
            },
            FileKind::Attachment => match input.read(f.entry) {
                Ok(bytes) => out.write(&f.old, &f.new, &bytes, false),
                Err(e) => {
                    out.skip(&f.old, &e.to_string());
                    false
                }
            },
        };
        if written {
            let r = &mut out.report;
            match f.kind {
                FileKind::Note | FileKind::Html => r.notes += 1,
                FileKind::Table => r.tables += 1,
                FileKind::Canvas => r.canvases += 1,
                FileKind::Attachment => r.attachments += 1,
            }
        }
        progress(n + 1, total);
    }
    out.report.links = stats.rewritten;
    if stats.broken > 0 {
        out.report.warnings.push(format!(
            "{} link{} to pages or files that weren't in the export {} left as {}.",
            stats.broken,
            if stats.broken == 1 { "" } else { "s" },
            if stats.broken == 1 { "was" } else { "were" },
            if stats.broken == 1 {
                "it was"
            } else {
                "they were"
            },
        ));
    }
    if html_pages > 0 {
        out.report.warnings.push(format!(
            "{html_pages} HTML page{} converted to Markdown; check any complex layouts.",
            if html_pages == 1 { " was" } else { "s were" }
        ));
    }
    Ok(())
}

/// Notion starts every page with `# Title`; AXISNotes shows the file name as the title, so
/// a first heading that only repeats it is dropped (with the blank lines after it).
fn drop_title_heading(text: &str, title: &str) -> String {
    let (first, rest) = text.split_once('\n').unwrap_or((text, ""));
    if !title.is_empty() && first.trim_end() == format!("# {title}") {
        rest.trim_start_matches(['\r', '\n']).to_string()
    } else {
        text.to_string()
    }
}

/// A name not yet in `used` (compared ignoring case): `stem.ext`, `stem 2.ext`…
fn unique_name(used: &mut HashSet<String>, stem: &str, ext: &str) -> String {
    let mut n = 1;
    loop {
        let name = if n == 1 {
            format!("{stem}{ext}")
        } else {
            format!("{stem} {n}{ext}")
        };
        if used.insert(name.to_lowercase()) {
            return name;
        }
        n += 1;
    }
}

fn import_enex(
    out: &mut Out,
    source: &Path,
    progress: &mut dyn FnMut(usize, usize),
) -> AppResult<()> {
    let files = enex_files(source)?;
    if files.is_empty() {
        return Err(AppError::NotFound(
            "no .enex files to import (export a notebook from Evernote first)".into(),
        ));
    }
    let one_file = source.is_file();
    let texts: Vec<(PathBuf, String)> = files
        .into_iter()
        .map(|f| read_enex(&f).map(|t| (f, t)))
        .collect::<AppResult<_>>()?;
    let total: usize = texts.iter().map(|(_, t)| enex::count(t).0).sum();
    progress(0, total);
    let mut done = 0;
    let mut folders: HashSet<String> = HashSet::new();
    for (path, text) in &texts {
        // A folder of notebooks: one folder each.
        let folder = if one_file {
            String::new()
        } else {
            let stem = path
                .file_stem()
                .map(|s| s.to_string_lossy().into_owned())
                .unwrap_or_default();
            unique_name(&mut folders, &plan::sanitize(&stem), "")
        };
        let within = |name: &str| {
            if folder.is_empty() {
                name.to_string()
            } else {
                format!("{folder}/{name}")
            }
        };
        let source_name = path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        let mut note_names: HashSet<String> = HashSet::new();
        let mut attachment_names: HashSet<String> = HashSet::new();
        for note in enex::notes(text) {
            let title = if note.title.is_empty() {
                "Untitled".to_string()
            } else {
                note.title.clone()
            };
            let label = format!("{source_name}: {title}");
            // Attachments first, so the note can link to them.
            let mut media: HashMap<String, String> = HashMap::new();
            let mut order = Vec::new();
            for r in &note.resources {
                if media.contains_key(&r.hash) {
                    continue;
                }
                let raw = r
                    .file_name
                    .clone()
                    .unwrap_or_else(|| format!("{}.{}", r.hash, enex::ext_for_mime(&r.mime)));
                let clean = plan::sanitize(&raw);
                let (stem, ext) = match clean.rfind('.') {
                    Some(i) if i > 0 => (&clean[..i], &clean[i..]),
                    _ => (clean.as_str(), ""),
                };
                let name = unique_name(&mut attachment_names, stem, ext);
                let rel = format!("Attachments/{name}");
                if out.write(&label, &within(&rel), &r.data, false) {
                    out.report.attachments += 1;
                    let link = plan::percent_encode(&rel);
                    let md = if r.mime.starts_with("image/") {
                        format!("![]({link})")
                    } else {
                        format!("[{}]({link})", name.replace(['[', ']'], ""))
                    };
                    media.insert(r.hash.clone(), md);
                    order.push(r.hash.clone());
                }
            }
            if note.bad_resources > 0 {
                out.skip(&label, "an attachment's data couldn't be read");
            }
            let used = std::cell::RefCell::new(HashSet::new());
            let mut body = enex::to_markdown(&note.content, &|hash| {
                used.borrow_mut().insert(hash.to_string());
                media.get(hash).cloned()
            });
            // Attachments the note's text doesn't show still get a link.
            let used = used.into_inner();
            let unused: Vec<&String> = order.iter().filter(|h| !used.contains(*h)).collect();
            if !unused.is_empty() {
                if !body.is_empty() {
                    body.push('\n');
                }
                for h in unused {
                    body.push_str(&media[h]);
                    body.push('\n');
                }
            }
            let mut props = Vec::new();
            let mut prop = |key: &str, value: &Option<String>| {
                if let Some(v) = value.as_ref().filter(|v| !v.is_empty()) {
                    props.push((key.to_string(), tables::PropValue::Text(v.clone())));
                }
            };
            prop("created", &note.created);
            prop("updated", &note.updated);
            prop("source", &note.source_url);
            prop("author", &note.author);
            if !note.tags.is_empty() {
                props.push((
                    "tags".to_string(),
                    tables::PropValue::List(note.tags.clone()),
                ));
            }
            let mut content = if props.is_empty() {
                String::new()
            } else {
                tables::frontmatter(&props)
            };
            content.push_str(&body);
            let name = unique_name(&mut note_names, &plan::sanitize(&title), ".md");
            if out.write(&label, &within(&name), content.as_bytes(), true) {
                out.report.notes += 1;
            }
            done += 1;
            progress(done, total);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests;
