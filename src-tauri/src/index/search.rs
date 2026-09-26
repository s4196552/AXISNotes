//! Search query language → SQL over the index.
//!
//! `words "exact phrase" -excluded tag:work/alpha path:School file:calc prop:status=done prop:due`
//! Words match as prefixes; everything is AND-ed. Nested tags match their children.

use rusqlite::types::Value as SqlValue;
use serde::Serialize;

use super::{db_err, like_escape, Index};
use crate::error::AppResult;

/// Highlight markers in snippets (the UI turns them into <mark>).
pub const HL_START: char = '\u{1}';
pub const HL_END: char = '\u{2}';

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Term {
    Word(String),
    Phrase(String),
    Not(String),
    Tag(String),
    Path(String),
    File(String),
    Prop(String, Option<String>),
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub path: String,
    pub title: String,
    /// Body excerpt with matches wrapped in U+0001 … U+0002; empty for filter-only queries.
    pub snippet: String,
}

/// Split a query into terms, honoring double quotes (also in `prop:k="a b"`).
pub fn parse_query(q: &str) -> Vec<Term> {
    let mut tokens: Vec<(String, bool)> = Vec::new(); // (text, was_quoted_whole)
    let mut cur = String::new();
    let mut quoted = false;
    let mut whole_quoted = false;
    for c in q.chars() {
        match c {
            '"' => {
                if !quoted && cur.is_empty() {
                    whole_quoted = true;
                }
                quoted = !quoted;
            }
            c if c.is_whitespace() && !quoted => {
                if !cur.is_empty() {
                    tokens.push((std::mem::take(&mut cur), whole_quoted));
                }
                whole_quoted = false;
            }
            c => cur.push(c),
        }
    }
    if !cur.is_empty() {
        tokens.push((cur, whole_quoted));
    }

    tokens
        .into_iter()
        .filter_map(|(tok, whole_quoted)| {
            if whole_quoted {
                return Some(Term::Phrase(tok));
            }
            if let Some(rest) = tok.strip_prefix('-') {
                return (!rest.is_empty()).then(|| Term::Not(rest.to_string()));
            }
            if let Some((op, val)) = tok.split_once(':') {
                if !val.is_empty() {
                    match op.to_lowercase().as_str() {
                        "tag" => {
                            return Some(Term::Tag(val.trim_start_matches('#').to_lowercase()))
                        }
                        "path" => return Some(Term::Path(val.to_string())),
                        "file" => return Some(Term::File(val.to_string())),
                        "prop" | "property" => {
                            return Some(match val.split_once('=') {
                                Some((k, v)) => Term::Prop(k.to_string(), Some(v.to_string())),
                                None => Term::Prop(val.to_string(), None),
                            })
                        }
                        _ => {}
                    }
                }
            }
            if let Some(tag) = tok.strip_prefix('#') {
                if !tag.is_empty() {
                    return Some(Term::Tag(tag.to_lowercase()));
                }
            }
            Some(Term::Word(tok))
        })
        .collect()
}

fn fts_quote(s: &str) -> String {
    format!("\"{}\"", s.replace('"', "\"\""))
}

fn json_key_path(key: &str) -> String {
    format!("$.\"{}\"", key.replace('"', "\\\""))
}

impl Index {
    pub fn search(&self, query: &str, limit: usize) -> AppResult<Vec<SearchHit>> {
        let terms = parse_query(query);
        let mut positive: Vec<String> = Vec::new();
        let mut negative: Vec<String> = Vec::new();
        let mut filters: Vec<String> = Vec::new();
        let mut args: Vec<SqlValue> = Vec::new();

        for term in &terms {
            match term {
                Term::Word(w) => positive.push(format!("{}*", fts_quote(w))),
                Term::Phrase(p) => positive.push(fts_quote(p)),
                Term::Not(w) => negative.push(fts_quote(w)),
                Term::Tag(t) => {
                    filters.push(
                        "EXISTS (SELECT 1 FROM tags t WHERE t.note_id = n.id AND (t.tag = ? OR t.tag LIKE ? ESCAPE '\\'))"
                            .into(),
                    );
                    args.push(SqlValue::Text(t.clone()));
                    args.push(SqlValue::Text(format!("{}/%", like_escape(t))));
                }
                Term::Path(p) => {
                    filters.push("n.path LIKE ? ESCAPE '\\'".into());
                    args.push(SqlValue::Text(format!("%{}%", like_escape(p))));
                }
                Term::File(f) => {
                    filters.push("n.name LIKE ? ESCAPE '\\'".into());
                    args.push(SqlValue::Text(format!(
                        "%{}%",
                        like_escape(&f.to_lowercase())
                    )));
                }
                Term::Prop(k, None) => {
                    filters.push("json_type(n.props, ?) IS NOT NULL".into());
                    args.push(SqlValue::Text(json_key_path(k)));
                }
                Term::Prop(k, Some(v)) => {
                    // json_each works for scalars and lists alike.
                    filters.push(
                        "EXISTS (SELECT 1 FROM json_each(n.props, ?) j WHERE lower(CAST(j.value AS TEXT)) = lower(?))"
                            .into(),
                    );
                    args.push(SqlValue::Text(json_key_path(k)));
                    args.push(SqlValue::Text(v.clone()));
                }
            }
        }

        let use_fts = !positive.is_empty();
        let mut sql = String::from("SELECT n.path, coalesce(n.title, ''), ");
        if use_fts {
            sql.push_str(&format!(
                "snippet(fts, 1, char({}), char({}), '…', 14) FROM notes n JOIN fts ON fts.rowid = n.id WHERE fts MATCH ?",
                HL_START as u32, HL_END as u32
            ));
            let mut expr = positive.join(" AND ");
            for n in &negative {
                expr = format!("({expr}) NOT {n}");
            }
            args.insert(0, SqlValue::Text(expr));
        } else {
            sql.push_str("'' FROM notes n WHERE 1");
            for n in &negative {
                // No positive words: exclude notes whose text contains the word.
                filters.push("n.id NOT IN (SELECT rowid FROM fts WHERE fts MATCH ?)".into());
                args.push(SqlValue::Text(n.clone()));
            }
        }
        for f in &filters {
            sql.push_str(" AND ");
            sql.push_str(f);
        }
        if use_fts {
            sql.push_str(" ORDER BY bm25(fts, 8.0, 1.0)");
        } else if terms.is_empty() {
            return Ok(Vec::new());
        } else {
            sql.push_str(" ORDER BY n.mtime DESC");
        }
        sql.push_str(&format!(" LIMIT {}", limit.clamp(1, 500)));

        let mut stmt = self.conn().prepare(&sql).map_err(db_err)?;
        let rows = stmt
            .query_map(rusqlite::params_from_iter(args), |r| {
                let path: String = r.get(0)?;
                let title: String = r.get(1)?;
                Ok(SearchHit {
                    title: if title.is_empty() {
                        path.rsplit('/')
                            .next()
                            .unwrap_or("")
                            .trim_end_matches(".md")
                            .to_string()
                    } else {
                        title
                    },
                    path,
                    snippet: r.get(2)?,
                })
            })
            .map_err(db_err)?;
        rows.collect::<Result<_, _>>().map_err(db_err)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_operators_and_quotes() {
        let t = parse_query(
            r#"cell "powerhouse of" -plant tag:#Bio/Cells path:School prop:status=done prop:due file:calc #urgent"#,
        );
        assert_eq!(
            t,
            vec![
                Term::Word("cell".into()),
                Term::Phrase("powerhouse of".into()),
                Term::Not("plant".into()),
                Term::Tag("bio/cells".into()),
                Term::Path("School".into()),
                Term::Prop("status".into(), Some("done".into())),
                Term::Prop("due".into(), None),
                Term::File("calc".into()),
                Term::Tag("urgent".into()),
            ]
        );
        assert_eq!(
            parse_query(r#"prop:owner="Ada L""#),
            vec![Term::Prop("owner".into(), Some("Ada L".into()))]
        );
        assert!(parse_query("   ").is_empty());
    }
}
