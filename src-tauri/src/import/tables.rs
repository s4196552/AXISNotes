//! Notion databases: CSV tables become `.axgrid` grids or Markdown tables, and the
//! property lines at the top of a database row's page become YAML frontmatter.

use serde_json::{json, Map, Value};

/// Parse CSV (RFC 4180: quoted fields, doubled quotes, CRLF or LF). Empty trailing lines
/// are dropped.
pub(crate) fn parse_csv(text: &str) -> Vec<Vec<String>> {
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    let mut rows = Vec::new();
    let mut row = Vec::new();
    let mut field = String::new();
    let mut quoted = false;
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        if quoted {
            match c {
                '"' if chars.peek() == Some(&'"') => {
                    field.push('"');
                    chars.next();
                }
                '"' => quoted = false,
                c => field.push(c),
            }
            continue;
        }
        match c {
            '"' if field.is_empty() => quoted = true,
            ',' => row.push(std::mem::take(&mut field)),
            '\r' if chars.peek() == Some(&'\n') => {}
            '\n' | '\r' => {
                row.push(std::mem::take(&mut field));
                rows.push(std::mem::take(&mut row));
            }
            c => field.push(c),
        }
    }
    if !field.is_empty() || !row.is_empty() {
        row.push(field);
        rows.push(row);
    }
    while rows
        .last()
        .is_some_and(|r: &Vec<String>| r.iter().all(String::is_empty))
    {
        rows.pop();
    }
    rows
}

/// Column letters for a 0-based index: 0 -> A, 25 -> Z, 26 -> AA.
pub(crate) fn col_name(mut i: usize) -> String {
    let mut s = Vec::new();
    loop {
        s.push(b'A' + (i % 26) as u8);
        if i < 26 {
            break;
        }
        i = i / 26 - 1;
    }
    s.reverse();
    String::from_utf8(s).unwrap_or_default()
}

/// An `.axgrid` (see `src/lib/formula/sheet.ts`) holding `rows`, the first one bold.
pub(crate) fn to_grid(rows: &[Vec<String>]) -> String {
    let width = rows.iter().map(Vec::len).max().unwrap_or(0);
    let mut cells = Map::new();
    let mut formats = Map::new();
    for (r, row) in rows.iter().enumerate() {
        for (c, value) in row.iter().enumerate() {
            if value.is_empty() {
                continue;
            }
            let addr = format!("{}{}", col_name(c), r + 1);
            // A leading `=` would make text a formula.
            let value = if value.starts_with('=') {
                format!(" {value}")
            } else {
                value.clone()
            };
            cells.insert(addr.clone(), Value::String(value));
            if r == 0 {
                formats.insert(addr, json!({ "bold": true }));
            }
        }
    }
    let mut widths = Map::new();
    if width > 0 {
        widths.insert("A".into(), json!(200));
    }
    let grid = json!({
        "version": 1,
        "rows": (rows.len() + 20).max(100),
        "cols": (width + 2).max(26),
        "cells": cells,
        "widths": widths,
        "formats": formats,
    });
    serde_json::to_string_pretty(&grid).unwrap_or_default() + "\n"
}

fn table_cell(s: &str) -> String {
    s.replace('|', "\\|")
        .replace("\r\n", "<br>")
        .replace('\n', "<br>")
}

/// A Markdown table of `rows` (the first is the header). `link(row)` can turn a row's
/// first cell into a link to its page.
pub(crate) fn to_markdown_table(
    title: &str,
    rows: &[Vec<String>],
    link: impl Fn(&str) -> Option<String>,
) -> String {
    let mut out = format!("# {title}\n\n");
    let width = rows.iter().map(Vec::len).max().unwrap_or(0);
    if width == 0 {
        return out;
    }
    let line = |cells: Vec<String>| format!("| {} |\n", cells.join(" | "));
    let cells = |row: &Vec<String>, first_link: bool| -> Vec<String> {
        (0..width)
            .map(|c| {
                let v = row.get(c).map(String::as_str).unwrap_or("");
                match (c, first_link) {
                    (0, true) if !v.is_empty() => link(v).unwrap_or_else(|| table_cell(v)),
                    _ => table_cell(v),
                }
            })
            .collect()
    };
    out.push_str(&line(cells(&rows[0], false)));
    out.push_str(&line(vec!["---".to_string(); width]));
    for row in &rows[1..] {
        out.push_str(&line(cells(row, true)));
    }
    out
}

/// A YAML key or string value written safely (JSON strings are valid YAML).
fn yaml_key(k: &str) -> String {
    let plain = !k.is_empty()
        && k.starts_with(|c: char| c.is_alphanumeric())
        && k.chars()
            .all(|c| c.is_alphanumeric() || matches!(c, ' ' | '_' | '-'))
        && !k.ends_with(' ');
    if plain {
        k.to_string()
    } else {
        Value::String(k.to_string()).to_string()
    }
}

pub(crate) fn yaml_string(v: &str) -> String {
    Value::String(v.to_string()).to_string()
}

/// YAML frontmatter from (key, value) pairs; list values become YAML lists.
pub(crate) fn frontmatter(props: &[(String, PropValue)]) -> String {
    let mut out = String::from("---\n");
    for (k, v) in props {
        out.push_str(&yaml_key(k));
        out.push(':');
        match v {
            PropValue::Text(s) => {
                out.push(' ');
                out.push_str(&yaml_string(s));
                out.push('\n');
            }
            PropValue::List(items) => {
                out.push('\n');
                for item in items {
                    out.push_str("  - ");
                    out.push_str(&yaml_string(item));
                    out.push('\n');
                }
            }
        }
    }
    out.push_str("---\n");
    out
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) enum PropValue {
    Text(String),
    List(Vec<String>),
}

/// Move the `Property: value` lines Notion writes under a database row's title into YAML
/// frontmatter. Only names that are columns of the database count, so ordinary text that
/// happens to contain a colon stays where it is. Returns the text unchanged if there are none.
pub(crate) fn properties_to_frontmatter(text: &str, columns: &[String]) -> String {
    if text.starts_with("---") {
        return text.to_string();
    }
    let lines: Vec<&str> = text.split_inclusive('\n').collect();
    let mut i = 0;
    let mut head = String::new();
    if lines.first().is_some_and(|l| l.starts_with("# ")) {
        head.push_str(lines[0]);
        i = 1;
    }
    let mut blank = String::new();
    while i < lines.len() && lines[i].trim().is_empty() {
        blank.push_str(lines[i]);
        i += 1;
    }
    let mut props = Vec::new();
    while i < lines.len() {
        let line = lines[i].trim_end_matches(['\r', '\n']);
        // The longest column name the line starts with (names can hold ": " too).
        let Some(key) = columns
            .iter()
            .filter(|c| !c.is_empty() && line.starts_with(&format!("{c}: ")))
            .max_by_key(|c| c.len())
        else {
            break;
        };
        if props.iter().any(|(k, _)| k == key) {
            break;
        }
        let value = line[key.len() + 2..].trim();
        let v = if key.eq_ignore_ascii_case("tags") {
            PropValue::List(
                value
                    .split(", ")
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                    .map(String::from)
                    .collect(),
            )
        } else {
            PropValue::Text(value.to_string())
        };
        props.push((key.to_string(), v));
        i += 1;
    }
    if props.is_empty() {
        return text.to_string();
    }
    let rest: String = lines[i..].concat();
    let rest = rest.trim_start_matches(['\r', '\n']);
    let mut out = frontmatter(&props);
    out.push_str(&head);
    if !rest.is_empty() {
        if !head.is_empty() {
            out.push('\n');
        }
        out.push_str(rest);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_csv() {
        let rows = parse_csv("\u{feff}Name,Notes\r\n\"A, b\",\"say \"\"hi\"\"\nthere\"\r\nC,\n\n");
        assert_eq!(
            rows,
            vec![
                vec!["Name".to_string(), "Notes".into()],
                vec!["A, b".into(), "say \"hi\"\nthere".into()],
                vec!["C".into(), "".into()],
            ]
        );
        assert!(parse_csv("").is_empty());
    }

    #[test]
    fn column_names() {
        assert_eq!(col_name(0), "A");
        assert_eq!(col_name(25), "Z");
        assert_eq!(col_name(26), "AA");
        assert_eq!(col_name(27), "AB");
        assert_eq!(col_name(701), "ZZ");
        assert_eq!(col_name(702), "AAA");
    }

    #[test]
    fn writes_a_grid() {
        let rows = parse_csv("Name,Price\nTea,4.5\nOdd,=1+1\n");
        let v: Value = serde_json::from_str(&to_grid(&rows)).unwrap();
        assert_eq!(v["version"], 1);
        assert_eq!(v["cells"]["A1"], "Name");
        assert_eq!(v["cells"]["B2"], "4.5");
        assert_eq!(v["cells"]["B3"], " =1+1");
        assert_eq!(v["formats"]["B1"]["bold"], true);
        assert_eq!(
            (v["rows"].as_u64(), v["cols"].as_u64()),
            (Some(100), Some(26))
        );
    }

    #[test]
    fn writes_a_markdown_table() {
        let rows = parse_csv("Name,Notes\nAlpha,a|b\nBeta,\"two\nlines\"\n");
        let md = to_markdown_table("Tasks", &rows, |name| {
            (name == "Alpha").then(|| "[[T/Alpha]]".to_string())
        });
        assert_eq!(
            md,
            "# Tasks\n\n| Name | Notes |\n| --- | --- |\n| [[T/Alpha]] | a\\|b |\n| Beta | two<br>lines |\n"
        );
    }

    #[test]
    fn moves_row_properties_into_frontmatter() {
        let cols = vec![
            "Name".to_string(),
            "Status".into(),
            "Tags".into(),
            "Due: date".into(),
        ];
        let text = "# Alpha\n\nStatus: Done\nTags: work, urgent\nDue: date: May 1\n\nBody: not a property\n";
        assert_eq!(
            properties_to_frontmatter(text, &cols),
            "---\nStatus: \"Done\"\nTags:\n  - \"work\"\n  - \"urgent\"\n\"Due: date\": \"May 1\"\n---\n# Alpha\n\nBody: not a property\n"
        );
        // Not a database column: left alone.
        let plain = "# Note\n\nWhen: later\n";
        assert_eq!(properties_to_frontmatter(plain, &cols), plain);
        // Only properties.
        assert_eq!(
            properties_to_frontmatter("# A\n\nStatus: x", &cols),
            "---\nStatus: \"x\"\n---\n# A\n"
        );
    }
}
