//! Markdown note parser for indexing: frontmatter, title, headings, wikilinks, tags,
//! block IDs. Code (fenced blocks and inline spans) is skipped. Offsets are byte offsets.

use serde_json::{Map, Value};
use yaml_rust2::{Yaml, YamlLoader};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WikiLink {
    /// Link target as written, e.g. `Folder/Note` (no heading/alias).
    pub target: String,
    pub heading: Option<String>,
    pub block: Option<String>,
    pub alias: Option<String>,
    pub embed: bool,
    /// Byte range of the whole `[[...]]` (including a leading `!` for embeds).
    pub start: usize,
    pub end: usize,
    /// Byte range of `target` inside the note.
    pub target_start: usize,
    pub target_end: usize,
}

#[derive(Debug, Clone, Default)]
pub struct ParsedNote {
    pub props: Map<String, Value>,
    /// Byte length of the frontmatter block including delimiters (0 if none).
    pub frontmatter_len: usize,
    pub title: Option<String>,
    pub headings: Vec<(u8, String)>,
    pub links: Vec<WikiLink>,
    /// Lowercased tags without `#`, deduplicated, including frontmatter `tags`.
    pub tags: Vec<String>,
    pub aliases: Vec<String>,
    pub block_ids: Vec<String>,
    /// Body text for full-text search (content after the frontmatter).
    pub body: String,
}

/// A `.axgrid` file: the body is the text of its non-formula cells, one per line.
/// Invalid JSON indexes as empty rather than failing the whole sync.
pub fn parse_grid(text: &str) -> ParsedNote {
    let mut note = ParsedNote::default();
    let Ok(json) = serde_json::from_str::<Value>(text) else {
        return note;
    };
    if let Some(cells) = json.get("cells").and_then(Value::as_object) {
        let mut lines: Vec<String> = Vec::new();
        for v in cells.values() {
            let s = match v {
                Value::String(s) => s.clone(),
                Value::Number(n) => n.to_string(),
                _ => continue,
            };
            if !s.is_empty() && !s.starts_with('=') {
                lines.push(s);
            }
        }
        note.body = lines.join("\n");
    }
    note
}

pub fn parse(text: &str) -> ParsedNote {
    let mut note = ParsedNote::default();
    let (props, fm_len) = frontmatter(text);
    note.props = props;
    note.frontmatter_len = fm_len;
    let body = &text[fm_len..];
    note.body = body.to_string();

    let mut tags: Vec<String> = Vec::new();
    let mut fence: Option<(char, usize)> = None;
    let mut offset = fm_len;
    for raw_line in body.split_inclusive('\n') {
        let line = raw_line.trim_end_matches(['\n', '\r']);
        let line_start = offset;
        offset += raw_line.len();

        let trimmed = line.trim_start();
        if let Some((ch, n)) = fence_marker(trimmed) {
            match fence {
                None => fence = Some((ch, n)),
                Some((open_ch, open_n))
                    if ch == open_ch
                        && n >= open_n
                        && trimmed.trim_end().chars().all(|c| c == ch) =>
                {
                    fence = None
                }
                _ => {}
            }
            continue;
        }
        if fence.is_some() {
            continue;
        }

        if let Some((level, heading)) = atx_heading(trimmed) {
            if level == 1 && note.title.is_none() {
                note.title = Some(heading.clone());
            }
            note.headings.push((level, heading));
        }
        if let Some(id) = block_id(line) {
            note.block_ids.push(id);
        }
        scan_inline(line, line_start, &mut note.links, &mut tags);
    }

    for key in ["tags", "tag"] {
        if let Some(v) = note.props.get(key) {
            for t in value_strings(v) {
                tags.push(t.trim_start_matches('#').to_string());
            }
        }
    }
    for key in ["aliases", "alias"] {
        if let Some(v) = note.props.get(key) {
            note.aliases.extend(value_strings(v));
        }
    }
    let mut seen = std::collections::HashSet::new();
    note.tags = tags
        .into_iter()
        .map(|t| t.to_lowercase())
        .filter(|t| !t.is_empty() && seen.insert(t.clone()))
        .collect();
    note
}

/// Strings from a YAML scalar, list, or comma/space separated string.
fn value_strings(v: &Value) -> Vec<String> {
    match v {
        Value::String(s) => s
            .split([',', ' '])
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(String::from)
            .collect(),
        Value::Array(items) => items.iter().flat_map(value_strings).collect(),
        Value::Number(n) => vec![n.to_string()],
        _ => Vec::new(),
    }
}

/// Parse a leading `---` YAML block. Returns (properties, byte length of the block).
pub fn frontmatter(text: &str) -> (Map<String, Value>, usize) {
    let mut lines = text.split_inclusive('\n');
    let Some(first) = lines.next() else {
        return (Map::new(), 0);
    };
    if first.trim_end() != "---" {
        return (Map::new(), 0);
    }
    let mut len = first.len();
    let yaml_start = len;
    for line in lines {
        let t = line.trim_end();
        if t == "---" || t == "..." {
            let yaml = &text[yaml_start..len];
            len += line.len();
            let props = YamlLoader::load_from_str(yaml)
                .ok()
                .and_then(|docs| docs.into_iter().next())
                .map(yaml_to_json)
                .and_then(|v| match v {
                    Value::Object(m) => Some(m),
                    _ => None,
                })
                .unwrap_or_default();
            return (props, len);
        }
        len += line.len();
    }
    (Map::new(), 0) // unterminated: not frontmatter
}

fn yaml_to_json(y: Yaml) -> Value {
    match y {
        Yaml::Real(s) => s
            .parse::<f64>()
            .ok()
            .and_then(|f| serde_json::Number::from_f64(f).map(Value::Number))
            .unwrap_or(Value::String(s)),
        Yaml::Integer(i) => Value::Number(i.into()),
        Yaml::String(s) => Value::String(s),
        Yaml::Boolean(b) => Value::Bool(b),
        Yaml::Array(a) => Value::Array(a.into_iter().map(yaml_to_json).collect()),
        Yaml::Hash(h) => Value::Object(
            h.into_iter()
                .filter_map(|(k, v)| {
                    let key = match k {
                        Yaml::String(s) => s,
                        Yaml::Integer(i) => i.to_string(),
                        Yaml::Real(s) => s,
                        Yaml::Boolean(b) => b.to_string(),
                        _ => return None,
                    };
                    Some((key, yaml_to_json(v)))
                })
                .collect(),
        ),
        _ => Value::Null,
    }
}

fn fence_marker(trimmed: &str) -> Option<(char, usize)> {
    let ch = trimmed.chars().next()?;
    if ch != '`' && ch != '~' {
        return None;
    }
    let n = trimmed.chars().take_while(|&c| c == ch).count();
    (n >= 3).then_some((ch, n))
}

fn atx_heading(trimmed: &str) -> Option<(u8, String)> {
    let level = trimmed.chars().take_while(|&c| c == '#').count();
    if !(1..=6).contains(&level) {
        return None;
    }
    let rest = &trimmed[level..];
    if !rest.is_empty() && !rest.starts_with([' ', '\t']) {
        return None;
    }
    let text = rest.trim().trim_end_matches('#').trim_end();
    Some((level as u8, text.to_string()))
}

/// `... ^block-id` at the end of a line.
fn block_id(line: &str) -> Option<String> {
    let t = line.trim_end();
    let caret = t
        .rfind(" ^")
        .map(|i| i + 1)
        .or_else(|| t.starts_with('^').then_some(0))?;
    let id = &t[caret + 1..];
    (!id.is_empty() && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-'))
        .then(|| id.to_string())
}

fn is_tag_char(c: char) -> bool {
    c.is_alphanumeric() || matches!(c, '_' | '-' | '/')
}

/// Find wikilinks and #tags in one line, skipping inline code spans.
fn scan_inline(line: &str, line_start: usize, links: &mut Vec<WikiLink>, tags: &mut Vec<String>) {
    let bytes = line.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'`' => {
                let ticks = bytes[i..].iter().take_while(|&&b| b == b'`').count();
                let fence = &line[i..i + ticks];
                match line[i + ticks..].find(fence) {
                    Some(close) => i += ticks + close + ticks,
                    None => i += ticks,
                }
            }
            b'[' if bytes.get(i + 1) == Some(&b'[') => {
                let embed = i > 0 && bytes[i - 1] == b'!';
                if let Some(close) = line[i + 2..].find("]]") {
                    let inner = &line[i + 2..i + 2 + close];
                    if !inner.is_empty() && !inner.contains('[') {
                        let start = if embed { i - 1 } else { i };
                        links.push(wikilink(
                            inner,
                            line_start + i + 2,
                            line_start + start,
                            line_start + i + 2 + close + 2,
                            embed,
                        ));
                    }
                    i += 2 + close + 2;
                } else {
                    i += 2;
                }
            }
            b'#' => {
                let prev = line[..i].chars().next_back();
                let starts_ok = prev.is_none_or(|c| c.is_whitespace() || c == '(');
                let rest = &line[i + 1..];
                let len: usize = rest
                    .chars()
                    .take_while(|&c| is_tag_char(c))
                    .map(char::len_utf8)
                    .sum();
                let tag = rest[..len].trim_end_matches('/');
                if starts_ok && !tag.is_empty() && !tag.chars().all(|c| c.is_ascii_digit()) {
                    tags.push(tag.to_string());
                }
                i += 1 + len;
            }
            _ => i += 1,
        }
        // Stay on a char boundary.
        while i < bytes.len() && !line.is_char_boundary(i) {
            i += 1;
        }
    }
}

/// Byte ranges of fenced code blocks and inline code spans (where links/mentions don't count).
pub fn code_ranges(text: &str) -> Vec<std::ops::Range<usize>> {
    let mut out = Vec::new();
    let mut fence: Option<(char, usize, usize)> = None; // (char, count, start)
    let mut offset = 0;
    for raw in text.split_inclusive('\n') {
        let line = raw.trim_end_matches(['\n', '\r']);
        let start = offset;
        offset += raw.len();
        let trimmed = line.trim_start();
        if let Some((ch, n)) = fence_marker(trimmed) {
            match fence {
                None => fence = Some((ch, n, start)),
                Some((c, m, s))
                    if ch == c && n >= m && trimmed.trim_end().chars().all(|x| x == ch) =>
                {
                    out.push(s..offset);
                    fence = None;
                }
                _ => {}
            }
            continue;
        }
        if fence.is_some() {
            continue;
        }
        let bytes = line.as_bytes();
        let mut i = 0;
        while i < bytes.len() {
            if bytes[i] == b'`' {
                let ticks = bytes[i..].iter().take_while(|&&b| b == b'`').count();
                if let Some(close) = line[i + ticks..].find(&line[i..i + ticks]) {
                    let end = i + ticks + close + ticks;
                    out.push(start + i..start + end);
                    i = end;
                    continue;
                }
                i += ticks;
            } else {
                i += 1;
            }
        }
    }
    if let Some((_, _, s)) = fence {
        out.push(s..text.len());
    }
    out
}

fn wikilink(inner: &str, inner_start: usize, start: usize, end: usize, embed: bool) -> WikiLink {
    let (target_part, alias) = match inner.split_once('|') {
        Some((t, a)) => (t, Some(a.trim().to_string())),
        None => (inner, None),
    };
    let (target, anchor) = match target_part.split_once('#') {
        Some((t, a)) => (t, Some(a)),
        None => (target_part, None),
    };
    let (heading, block) = match anchor {
        Some(a) if a.starts_with('^') => (None, Some(a[1..].to_string())),
        Some(a) if !a.is_empty() => (Some(a.to_string()), None),
        _ => (None, None),
    };
    let trimmed = target.trim();
    let lead = target.len() - target.trim_start().len();
    WikiLink {
        target: trimmed.to_string(),
        heading,
        block,
        alias,
        embed,
        start,
        end,
        target_start: inner_start + lead,
        target_end: inner_start + lead + trimmed.len(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frontmatter_props_tags_and_aliases() {
        let n = parse("---\nstatus: done\npriority: 2\ntags: [Work/Alpha, school]\naliases: PA\n---\n# Project Alpha\nBody #Research");
        assert_eq!(n.props["status"], "done");
        assert_eq!(n.props["priority"], 2);
        assert_eq!(n.title.as_deref(), Some("Project Alpha"));
        assert_eq!(n.tags, vec!["research", "work/alpha", "school"]);
        assert_eq!(n.aliases, vec!["PA"]);
        assert!(n.body.starts_with("# Project Alpha"));
    }

    #[test]
    fn non_frontmatter_dashes_are_body() {
        let n = parse("Intro\n---\nnot: yaml\n---\n");
        assert!(n.props.is_empty());
        assert_eq!(n.frontmatter_len, 0);
    }

    #[test]
    fn wikilinks_with_heading_block_alias_and_embed() {
        let text = "See [[Project Alpha]], [[Notes/Plan#Goals|the plan]] and ![[Img#^blk1]].";
        let n = parse(text);
        assert_eq!(n.links.len(), 3);
        let l = &n.links[1];
        assert_eq!(l.target, "Notes/Plan");
        assert_eq!(l.heading.as_deref(), Some("Goals"));
        assert_eq!(l.alias.as_deref(), Some("the plan"));
        assert_eq!(&text[l.target_start..l.target_end], "Notes/Plan");
        assert_eq!(&text[l.start..l.end], "[[Notes/Plan#Goals|the plan]]");
        let e = &n.links[2];
        assert!(e.embed);
        assert_eq!(e.block.as_deref(), Some("blk1"));
        assert_eq!(&text[e.start..e.end], "![[Img#^blk1]]");
    }

    #[test]
    fn skips_code_and_non_tags() {
        let text = "```\n[[InCode]] #nottag\n```\n`[[inline]]` #real and a#b, #123, #work/projects/alpha/ ## Heading\nurl http://x.com/#frag";
        let n = parse(text);
        assert!(n.links.is_empty());
        assert_eq!(n.tags, vec!["real", "work/projects/alpha"]);
    }

    #[test]
    fn headings_and_block_ids() {
        let n = parse("# One\ntext ^abc-1\n## Two ##\n#nospace\n");
        assert_eq!(n.headings, vec![(1, "One".into()), (2, "Two".into())]);
        assert_eq!(n.block_ids, vec!["abc-1"]);
        assert_eq!(n.tags, vec!["nospace"]);
    }

    #[test]
    fn unicode_offsets_are_byte_accurate() {
        let text = "héllo [[Café]] #été";
        let n = parse(text);
        let l = &n.links[0];
        assert_eq!(&text[l.target_start..l.target_end], "Café");
        assert_eq!(n.tags, vec!["été"]);
    }
}
