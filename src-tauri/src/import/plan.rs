//! Where each file of an export goes, and links rewritten to match. Names are cleaned per
//! folder (Notion's 32-character IDs dropped, characters Windows can't store replaced) and
//! made unique, keeping a page, its folder of subpages and its database table under one
//! name. Markdown links to other notes in the export become wikilinks, and links to
//! attachments point at their new paths.

use std::collections::{BTreeMap, HashMap, HashSet};

/// What a file becomes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum FileKind {
    /// A Markdown note (links rewritten unless the source keeps its names).
    Note,
    /// An HTML page, converted to Markdown.
    Html,
    /// A database table (CSV), written as a grid or a Markdown table.
    Table,
    /// An Obsidian JSON Canvas, converted.
    Canvas,
    /// Copied as it is.
    Attachment,
}

impl FileKind {
    /// Whether the file ends up as a Markdown note.
    pub fn is_markdown(self, tables_as_markdown: bool) -> bool {
        matches!(self, FileKind::Note | FileKind::Html)
            || (self == FileKind::Table && tables_as_markdown)
    }
}

#[derive(Debug, Clone)]
pub(crate) struct Planned {
    /// Index into the input's entries.
    pub entry: usize,
    /// Path in the export.
    pub old: String,
    /// Path inside the import folder.
    pub new: String,
    pub kind: FileKind,
}

#[derive(Debug, Default)]
pub(crate) struct Plan {
    pub files: Vec<Planned>,
    /// Lowercased export path -> index into `files`.
    by_old: HashMap<String, usize>,
    /// Notion ID -> index into `files` (pages before tables).
    by_id: HashMap<String, usize>,
    /// Whether any name had a Notion ID.
    pub had_ids: bool,
}

/// How a source names and converts its files.
pub(crate) struct Rules {
    /// Drop Notion's ` 0123…cdef` IDs from names.
    pub strip_ids: bool,
    /// Extension database tables get (`.axgrid` or `.md`).
    pub table_ext: &'static str,
}

impl Rules {
    /// Extension a file of `kind` gets (None = keep its own).
    fn ext(&self, kind: FileKind) -> Option<&'static str> {
        match kind {
            FileKind::Note | FileKind::Html => Some(".md"),
            FileKind::Table => Some(self.table_ext),
            FileKind::Canvas => Some(".axcanvas"),
            FileKind::Attachment => None,
        }
    }
}

pub(crate) fn is_hex_id(s: &str) -> bool {
    s.len() == 32 && s.bytes().all(|b| b.is_ascii_hexdigit())
}

/// `Page Title 0123…cdef` -> (`Page Title`, Some(id)). Notion names without a title are
/// just the ID.
pub(crate) fn split_id(stem: &str) -> (&str, Option<&str>) {
    if stem.len() >= 32 {
        let (head, tail) = stem.split_at(stem.len() - 32);
        if is_hex_id(tail) && (head.is_empty() || head.ends_with(' ')) {
            return (head.trim_end(), Some(tail));
        }
    }
    (stem, None)
}

const RESERVED: &[&str] = &[
    "con", "prn", "aux", "nul", "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8",
    "com9", "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
];

/// A name every OS can store: no `<>:"/\|?*` or control characters, no trailing dots or
/// spaces, not a reserved Windows device name, never empty.
pub(crate) fn sanitize(name: &str) -> String {
    let mut s: String = name
        .chars()
        .filter(|c| !c.is_control())
        .map(|c| match c {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '-',
            c => c,
        })
        .collect();
    let trimmed = s.trim().trim_end_matches('.').trim_end().to_string();
    s = trimmed.trim_start_matches('.').to_string();
    if s.is_empty() {
        s = "Untitled".into();
    }
    if RESERVED.contains(&s.to_lowercase().as_str()) {
        s.push('_');
    }
    // Long names (Notion keeps whole titles) are cut so deep folders still fit on disk.
    if s.chars().count() > 120 {
        s = s
            .chars()
            .take(120)
            .collect::<String>()
            .trim_end()
            .to_string();
    }
    s
}

/// (stem, extension with its dot) of a file name.
fn split_ext(name: &str) -> (&str, &str) {
    match name.rfind('.') {
        Some(i) if i > 0 => (&name[..i], &name[i..]),
        _ => (name, ""),
    }
}

pub(crate) fn parent(path: &str) -> &str {
    path.rfind('/').map_or("", |i| &path[..i])
}

pub(crate) fn file_name(path: &str) -> &str {
    path.rfind('/').map_or(path, |i| &path[i + 1..])
}

impl Plan {
    /// Plan `files` (entry index, export path, kind) under `rules`.
    pub fn build(files: Vec<(usize, String, FileKind)>, rules: &Rules) -> Plan {
        // Children of each folder: name -> (stem key, extension it will have, is a folder).
        let mut dirs: BTreeMap<String, BTreeMap<String, (String, String, bool)>> = BTreeMap::new();
        for (_, path, kind) in &files {
            let mut dir = String::new();
            let parts: Vec<&str> = path.split('/').collect();
            for (i, part) in parts.iter().enumerate() {
                let last = i + 1 == parts.len();
                let child = if last {
                    let (stem, ext) = split_ext(part);
                    // Notion's `Tasks 0123…_all.csv` is the whole of database `Tasks 0123…`.
                    let stem = if *kind == FileKind::Table {
                        stem.strip_suffix("_all").unwrap_or(stem)
                    } else {
                        stem
                    };
                    let ext = rules
                        .ext(*kind)
                        .map_or_else(|| ext.to_string(), String::from);
                    (stem.to_string(), ext, false)
                } else {
                    (part.to_string(), String::new(), true)
                };
                dirs.entry(dir.clone())
                    .or_default()
                    .insert(part.to_string(), child);
                if !last {
                    dir = if dir.is_empty() {
                        part.to_string()
                    } else {
                        format!("{dir}/{part}")
                    };
                }
            }
        }

        // New name of each (folder, child name).
        let mut renamed: HashMap<(String, String), String> = HashMap::new();
        let mut had_ids = false;
        for (dir, children) in &dirs {
            // Children sharing a stem (a page, its subpage folder, its table) share a name.
            // One that would end up with the same name as another in its group (`a.md` and
            // `a.txt`, both notes) is named on its own after them.
            type Member<'m> = (&'m str, &'m str, bool);
            let mut groups: BTreeMap<&str, Vec<Member>> = BTreeMap::new();
            let mut extra: Vec<(&str, Vec<Member>)> = Vec::new();
            for (name, (stem, ext, is_dir)) in children {
                let group = groups.entry(stem.as_str()).or_default();
                let member = (name.as_str(), ext.as_str(), *is_dir);
                if group
                    .iter()
                    .any(|(_, e, d)| *e == ext.as_str() && d == is_dir)
                {
                    extra.push((stem.as_str(), vec![member]));
                } else {
                    group.push(member);
                }
            }
            let clean_of = |stem: &str, had_ids: &mut bool| {
                let (clean, id) = if rules.strip_ids {
                    split_id(stem)
                } else {
                    (stem, None)
                };
                *had_ids |= id.is_some();
                (id.is_some(), sanitize(clean))
            };
            let mut order: Vec<(bool, &str, String, Vec<Member>)> = groups
                .iter()
                .map(|(stem, members)| {
                    let (has_id, clean) = clean_of(stem, &mut had_ids);
                    (has_id, *stem, clean, members.clone())
                })
                .collect();
            // Names without IDs keep theirs first; then the rest in order.
            order.sort();
            for (stem, members) in extra {
                let (has_id, clean) = clean_of(stem, &mut had_ids);
                order.push((has_id, stem, clean, members));
            }
            let mut used: HashSet<String> = HashSet::new();
            for (_, _, clean, members) in &order {
                let mut n = 1;
                let base = loop {
                    let base = if n == 1 {
                        clean.clone()
                    } else {
                        format!("{clean} {n}")
                    };
                    let free = members.iter().all(|(_, ext, is_dir)| {
                        let full = if *is_dir {
                            base.clone()
                        } else {
                            format!("{base}{ext}")
                        };
                        !used.contains(&full.to_lowercase())
                    });
                    if free {
                        break base;
                    }
                    n += 1;
                };
                for (name, ext, is_dir) in members {
                    let full = if *is_dir {
                        base.clone()
                    } else {
                        format!("{base}{ext}")
                    };
                    used.insert(full.to_lowercase());
                    renamed.insert((dir.clone(), name.to_string()), full);
                }
            }
        }

        let mut plan = Plan {
            had_ids,
            ..Plan::default()
        };
        for (entry, old, kind) in files {
            let mut dir = String::new();
            let mut new = Vec::new();
            for part in old.split('/') {
                new.push(renamed[&(dir.clone(), part.to_string())].clone());
                dir = if dir.is_empty() {
                    part.to_string()
                } else {
                    format!("{dir}/{part}")
                };
            }
            let stem = split_ext(file_name(&old)).0;
            let stem = stem.strip_suffix("_all").unwrap_or(stem);
            let id = if rules.strip_ids {
                split_id(stem).1.map(str::to_lowercase)
            } else {
                None
            };
            let i = plan.files.len();
            plan.by_old.insert(old.to_lowercase(), i);
            if let Some(id) = id {
                let page_wins = plan
                    .by_id
                    .get(&id)
                    .is_some_and(|&j| plan.files[j].kind != FileKind::Table);
                if !page_wins {
                    plan.by_id.insert(id, i);
                }
            }
            plan.files.push(Planned {
                entry,
                old,
                new: new.join("/"),
                kind,
            });
        }
        plan
    }

    /// Links to `old` (a file left out) go to `to` (a planned file) instead.
    pub fn alias(&mut self, old: &str, to: &str) {
        if let Some(&i) = self.by_old.get(&to.to_lowercase()) {
            self.by_old.insert(old.to_lowercase(), i);
        }
    }

    pub fn find_old(&self, old: &str) -> Option<&Planned> {
        self.by_old
            .get(&old.to_lowercase())
            .map(|&i| &self.files[i])
    }

    pub fn find_id(&self, id: &str) -> Option<&Planned> {
        self.by_id.get(&id.to_lowercase()).map(|&i| &self.files[i])
    }
}

// ---- Paths in links ----

/// Decode `%20`-style escapes (invalid UTF-8 replaced).
pub(crate) fn percent_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            let hex = |c: u8| (c as char).to_digit(16);
            if let (Some(h), Some(l)) = (hex(b[i + 1]), hex(b[i + 2])) {
                out.push((h * 16 + l) as u8);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Escape what a Markdown link destination can't hold as is.
pub(crate) fn percent_encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            ' ' => out.push_str("%20"),
            '%' => out.push_str("%25"),
            '(' => out.push_str("%28"),
            ')' => out.push_str("%29"),
            '<' => out.push_str("%3C"),
            '>' => out.push_str("%3E"),
            '#' => out.push_str("%23"),
            '?' => out.push_str("%3F"),
            '[' => out.push_str("%5B"),
            ']' => out.push_str("%5D"),
            c => out.push(c),
        }
    }
    out
}

/// `target` written in a file in `dir`, as a path from the export's root (None if it
/// climbs out of it).
pub(crate) fn join_relative(dir: &str, target: &str) -> Option<String> {
    let mut parts: Vec<&str> = if target.starts_with('/') || dir.is_empty() {
        Vec::new()
    } else {
        dir.split('/').collect()
    };
    for seg in target.split('/') {
        match seg {
            "" | "." => {}
            ".." => {
                parts.pop()?;
            }
            s => parts.push(s),
        }
    }
    Some(parts.join("/"))
}

/// A relative path from folder `from_dir` to `to` (both inside the same root).
pub(crate) fn relative_path(from_dir: &str, to: &str) -> String {
    let from: Vec<&str> = from_dir.split('/').filter(|s| !s.is_empty()).collect();
    let to_parts: Vec<&str> = to.split('/').collect();
    let common = from
        .iter()
        .zip(&to_parts)
        .take_while(|(a, b)| a == b)
        .count();
    let mut out: Vec<&str> = vec![".."; from.len() - common];
    out.extend(&to_parts[common..]);
    out.join("/")
}

fn has_scheme(href: &str) -> bool {
    let Some(colon) = href.find(':') else {
        return false;
    };
    let scheme = &href[..colon];
    scheme.len() >= 2
        && scheme.starts_with(|c: char| c.is_ascii_alphabetic())
        && scheme
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '-' | '.'))
}

/// The Notion page ID in a `notion.so` / `notion.site` address.
fn notion_url_id(href: &str) -> Option<String> {
    let rest = href
        .strip_prefix("https://")
        .or_else(|| href.strip_prefix("http://"))?;
    let (host, path) = rest.split_once('/')?;
    if !(host.ends_with("notion.so") || host.ends_with("notion.site")) {
        return None;
    }
    let path = path.split(['?', '#']).next().unwrap_or("");
    let last = path.rsplit('/').next().unwrap_or("");
    let tail = last.rsplit('-').next().unwrap_or(last);
    is_hex_id(tail).then(|| tail.to_lowercase())
}

/// Text that can sit in a wikilink's alias.
fn alias_text(text: &str) -> String {
    text.replace('|', "-")
        .replace(['[', ']'], "")
        .replace('\n', " ")
        .trim()
        .to_string()
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub(crate) struct LinkStats {
    pub rewritten: usize,
    /// Links to files that look local but weren't in the export.
    pub broken: usize,
}

/// A Markdown link as written: `[text](href)`, or an image `![text](href)`.
struct Link<'t> {
    text: &'t str,
    href: &'t str,
    image: bool,
}

/// Rewrites links in one Markdown file.
pub(crate) struct Linker<'a> {
    pub plan: &'a Plan,
    /// The import folder in the vault (wikilinks use full vault paths, so they can't
    /// resolve to a same-named note elsewhere).
    pub target: &'a str,
    pub tables_as_markdown: bool,
}

impl Linker<'_> {
    pub fn vault_path(&self, new: &str) -> String {
        format!("{}/{}", self.target, new)
    }

    /// A wikilink (or embed) to planned file `p`.
    pub fn wikilink(&self, p: &Planned, text: &str, embed: bool, in_table: bool) -> String {
        let full = self.vault_path(&p.new);
        let target = if p.kind.is_markdown(self.tables_as_markdown) {
            full.strip_suffix(".md").unwrap_or(&full).to_string()
        } else {
            full
        };
        let alias = alias_text(text);
        if embed {
            format!("![[{target}]]")
        } else if alias.is_empty() || in_table {
            // `|` would split a Markdown table's cell.
            format!("[[{target}]]")
        } else {
            format!("[[{target}|{alias}]]")
        }
    }

    /// One link's new form, or None to leave it as written.
    fn rewrite(
        &self,
        link: Link,
        from_old: &str,
        from_new: &str,
        in_table: bool,
        stats: &mut LinkStats,
    ) -> Option<String> {
        let Link { text, href, image } = link;
        let href = href.trim();
        if href.is_empty() || href.starts_with('#') {
            return None;
        }
        let target = if has_scheme(href) {
            self.plan.find_id(&notion_url_id(href)?)?
        } else {
            let path = href.split(['#', '?']).next().unwrap_or("");
            let decoded = percent_decode(path);
            let resolved = join_relative(parent(from_old), &decoded);
            match resolved.as_deref().and_then(|r| self.plan.find_old(r)) {
                Some(p) => p,
                None => {
                    // A link to a file that should have been exported (`Page abc.md`,
                    // `photo.png`) but wasn't: counted so the summary can say so.
                    if file_name(&decoded).contains('.') {
                        stats.broken += 1;
                    }
                    return None;
                }
            }
        };
        stats.rewritten += 1;
        if target.kind == FileKind::Attachment {
            let rel = relative_path(parent(from_new), &target.new);
            let bang = if image { "!" } else { "" };
            return Some(format!("{bang}[{text}]({})", percent_encode(&rel)));
        }
        Some(self.wikilink(target, text, image, in_table))
    }

    /// `text` (a Markdown file at `from_old` in the export, `from_new` in the import) with
    /// its links rewritten. Code blocks and code spans are left alone.
    pub fn rewrite_text(
        &self,
        text: &str,
        from_old: &str,
        from_new: &str,
        stats: &mut LinkStats,
    ) -> String {
        let mut out = String::with_capacity(text.len());
        let mut fence: Option<(char, usize)> = None;
        for line in text.split_inclusive('\n') {
            let trimmed = line.trim_start();
            let marker = trimmed
                .chars()
                .next()
                .filter(|c| *c == '`' || *c == '~')
                .map(|c| (c, trimmed.chars().take_while(|x| *x == c).count()))
                .filter(|(_, n)| *n >= 3);
            if let Some((c, n)) = fence {
                if marker.is_some_and(|(mc, mn)| mc == c && mn >= n) {
                    fence = None;
                }
                out.push_str(line);
                continue;
            }
            if marker.is_some() {
                fence = marker;
                out.push_str(line);
                continue;
            }
            let in_table = trimmed.starts_with('|');
            out.push_str(&self.rewrite_line(line, from_old, from_new, in_table, stats));
        }
        out
    }

    fn rewrite_line(
        &self,
        line: &str,
        from_old: &str,
        from_new: &str,
        in_table: bool,
        stats: &mut LinkStats,
    ) -> String {
        let b = line.as_bytes();
        let mut out = String::with_capacity(line.len());
        let mut copied = 0;
        let mut i = 0;
        while i < b.len() {
            match b[i] {
                b'`' => {
                    // Skip a code span: up to the same run of backticks.
                    let run = b[i..].iter().take_while(|&&c| c == b'`').count();
                    let close = "`".repeat(run);
                    match line[i + run..].find(&close) {
                        Some(j) => i += run + j + run,
                        None => i += run,
                    }
                }
                b'\\' => i += 2,
                b'[' => {
                    let Some((end, text, href)) = parse_link(line, i) else {
                        i += 1;
                        continue;
                    };
                    let image = i > 0 && b[i - 1] == b'!' && (i < 2 || b[i - 2] != b'\\');
                    let start = if image { i - 1 } else { i };
                    if let Some(new) = self.rewrite(
                        Link { text, href, image },
                        from_old,
                        from_new,
                        in_table,
                        stats,
                    ) {
                        out.push_str(&line[copied..start]);
                        out.push_str(&new);
                        copied = end;
                    }
                    i = end;
                }
                _ => i += 1,
            }
        }
        out.push_str(&line[copied.min(line.len())..]);
        out
    }
}

/// A Markdown link starting at the `[` at `at`: (end, text, destination).
fn parse_link(line: &str, at: usize) -> Option<(usize, &str, &str)> {
    let b = line.as_bytes();
    let mut depth = 0;
    let mut i = at;
    let close = loop {
        match *b.get(i)? {
            b'\\' => i += 1,
            b'[' => depth += 1,
            b']' => {
                depth -= 1;
                if depth == 0 {
                    break i;
                }
            }
            b'\n' => return None,
            _ => {}
        }
        i += 1;
    };
    if b.get(close + 1) != Some(&b'(') {
        return None;
    }
    let text = &line[at + 1..close];
    let start = close + 2;
    if b.get(start) == Some(&b'<') {
        let end = start + line[start..].find('>')?;
        let after = end + 1 + line[end + 1..].find(')')?;
        return Some((after + 1, text, &line[start + 1..end]));
    }
    let mut depth = 0;
    let mut i = start;
    let end = loop {
        match *b.get(i)? {
            b'(' => depth += 1,
            b')' if depth == 0 => break i,
            b')' => depth -= 1,
            b'\n' => return None,
            _ => {}
        }
        i += 1;
    };
    let inner = line[start..end].trim();
    // `(dest "title")`: the destination stops at the first space.
    let dest = inner
        .split_once(char::is_whitespace)
        .map_or(inner, |(d, _)| d);
    Some((end + 1, text, dest))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rules(strip_ids: bool) -> Rules {
        Rules {
            strip_ids,
            table_ext: ".axgrid",
        }
    }

    const A: &str = "0123456789abcdef0123456789abcdef";
    const B: &str = "fedcba9876543210fedcba9876543210";

    #[test]
    fn splits_notion_ids() {
        assert_eq!(split_id(&format!("Page {A}")), ("Page", Some(A)));
        assert_eq!(split_id(A), ("", Some(A)));
        assert_eq!(split_id(&format!("Page{A}")).1, None);
        assert_eq!(split_id("Page"), ("Page", None));
    }

    #[test]
    fn sanitizes_names() {
        assert_eq!(sanitize("a: b?"), "a- b-");
        assert_eq!(sanitize("  .hidden. "), "hidden");
        assert_eq!(sanitize(""), "Untitled");
        assert_eq!(sanitize("CON"), "CON_");
    }

    #[test]
    fn strips_ids_keeping_pages_folders_and_tables_together() {
        let files = vec![
            (0, format!("Home {A}.md"), FileKind::Note),
            (1, format!("Home {A}/Untitled {A}.md"), FileKind::Note),
            (2, format!("Home {A}/Untitled {B}.md"), FileKind::Note),
            (3, format!("Home {A}/Tasks {B}_all.csv"), FileKind::Table),
            (4, format!("Home {A}/Tasks {B}/Row {A}.md"), FileKind::Note),
            (5, format!("Home {A}/Untitled.png"), FileKind::Attachment),
            (6, format!("Home {A}/untitled.md"), FileKind::Note),
        ];
        let plan = Plan::build(files, &rules(true));
        let new: Vec<&str> = plan.files.iter().map(|f| f.new.as_str()).collect();
        assert_eq!(
            new,
            [
                "Home.md",
                "Home/Untitled 2.md",
                "Home/Untitled 3.md",
                "Home/Tasks.axgrid",
                "Home/Tasks/Row.md",
                "Home/Untitled.png",
                "Home/untitled.md",
            ]
        );
        assert!(plan.had_ids);
        assert_eq!(plan.find_id(A).unwrap().new, "Home.md");
        assert_eq!(
            plan.find_id(&B.to_uppercase()).unwrap().new,
            "Home/Untitled 3.md"
        );
    }

    #[test]
    fn keeps_names_without_id_stripping() {
        let plan = Plan::build(
            vec![(0, format!("Page {A}.md"), FileKind::Note)],
            &rules(false),
        );
        assert_eq!(plan.files[0].new, format!("Page {A}.md"));
        assert!(!plan.had_ids);
    }

    #[test]
    fn paths() {
        assert_eq!(percent_decode("My%20Page%2"), "My Page%2");
        assert_eq!(percent_decode("caf%C3%A9"), "café");
        assert_eq!(percent_encode("a b(1)%.png"), "a%20b%281%29%25.png");
        assert_eq!(
            join_relative("a/b", "../c/d.md").as_deref(),
            Some("a/c/d.md")
        );
        assert_eq!(join_relative("a", "../../x"), None);
        assert_eq!(join_relative("a", "/x/y").as_deref(), Some("x/y"));
        assert_eq!(relative_path("a/b", "a/c/x.png"), "../c/x.png");
        assert_eq!(relative_path("", "a/x.png"), "a/x.png");
        assert_eq!(relative_path("a", "a/x.png"), "x.png");
        assert_eq!(
            notion_url_id(&format!("https://www.notion.so/team/Page-{A}?pvs=4")).as_deref(),
            Some(A)
        );
        assert_eq!(notion_url_id("https://example.com/x"), None);
    }

    #[test]
    fn rewrites_links_to_notes_tables_and_attachments() {
        let files = vec![
            (0, format!("Home {A}.md"), FileKind::Note),
            (1, format!("Home {A}/Sub {B}.md"), FileKind::Note),
            (2, format!("Home {A}/pic one.png"), FileKind::Attachment),
            (3, format!("Home {A}/DB {B}_all.csv"), FileKind::Table),
        ];
        let plan = Plan::build(files, &rules(true));
        let linker = Linker {
            plan: &plan,
            target: "Imported/N",
            tables_as_markdown: false,
        };
        let mut stats = LinkStats::default();
        let text = format!(
            "See [Sub](Home%20{A}/Sub%20{B}.md) and ![pic](Home%20{A}/pic%20one.png).\n\
             [DB](Home%20{A}/DB%20{B}_all.csv) [web](https://x.com) [gone](Gone%20{A}0.md)\n\
             `[Sub](Home%20{A}/Sub%20{B}.md)` [top](https://www.notion.so/Sub-{B})\n\
             | [Sub](<Home {A}/Sub {B}.md>) |\n```\n[Sub](Home%20{A}/Sub%20{B}.md)\n```\n"
        );
        let out = linker.rewrite_text(&text, &format!("Home {A}.md"), "Home.md", &mut stats);
        let lines: Vec<&str> = out.lines().collect();
        assert_eq!(
            lines[0],
            "See [[Imported/N/Home/Sub|Sub]] and ![pic](Home/pic%20one.png)."
        );
        assert_eq!(
            lines[1],
            format!("[[Imported/N/Home/DB.axgrid|DB]] [web](https://x.com) [gone](Gone%20{A}0.md)")
        );
        assert!(lines[2].starts_with('`') && lines[2].ends_with("[[Imported/N/Home/Sub|top]]"));
        assert_eq!(lines[3], "| [[Imported/N/Home/Sub]] |");
        assert_eq!(lines[5], format!("[Sub](Home%20{A}/Sub%20{B}.md)"));
        assert_eq!(
            stats,
            LinkStats {
                rewritten: 5,
                broken: 1
            }
        );

        // From a subfolder, attachments are relative to it.
        let mut stats = LinkStats::default();
        let out = linker.rewrite_text(
            "![x](../Home%20".to_string().as_str(),
            &format!("Home {A}/Sub {B}.md"),
            "Home/Sub.md",
            &mut stats,
        );
        assert_eq!(out, "![x](../Home%20");
        let out = linker.rewrite_text(
            "![x](pic%20one.png)",
            &format!("Home {A}/Sub {B}.md"),
            "Home/Sub.md",
            &mut stats,
        );
        assert_eq!(out, "![x](pic%20one.png)");
    }
}
