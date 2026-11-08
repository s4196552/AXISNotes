//! "Ask your vault": the parts of notes most likely to answer a question, within a token
//! budget. Notes are found with the full-text index (any of the question's words, ranked
//! by bm25), then split at their headings; the sections that mention the most words are
//! kept, best first. The AI layer re-reads each section from the file when it sends it
//! (`RunRequest.passages`), so the webview never supplies the text it claims to quote.

use std::collections::HashSet;

use serde::Serialize;

use super::search::fts_quote;
use super::{db_err, Index};
use crate::error::AppResult;

/// Notes the index is asked for, at most.
const MAX_NOTES: usize = 40;
/// Sections taken from one note, at most.
const PER_NOTE: usize = 3;
/// A longer section is cut to this many characters when sent.
pub const MAX_PASSAGE_CHARS: usize = 6000;

const STOPWORDS: &[&str] = &[
    "the", "and", "for", "are", "but", "not", "you", "all", "any", "can", "had", "her", "was",
    "one", "our", "out", "has", "his", "how", "its", "may", "new", "now", "see", "who", "did",
    "does", "what", "when", "where", "which", "while", "with", "why", "this", "that", "these",
    "those", "they", "them", "then", "than", "there", "their", "from", "have", "into", "about",
    "would", "could", "should", "will", "your", "been", "were", "also", "just", "some", "such",
    "more", "most", "much", "many", "very", "each", "other", "only", "over", "after", "before",
    "tell", "explain", "give", "list", "show", "find", "notes", "note", "please", "know", "make",
    "made", "like", "want", "need", "use", "used", "using", "ive", "i've", "my", "me",
];

/// The words of a question worth searching for: "quoted phrases", and words of three or
/// more letters that aren't common filler, lower-cased, without repeats.
pub fn question_terms(question: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut seen = HashSet::new();
    let mut rest = String::new();
    for (i, part) in question.split('"').enumerate() {
        if i % 2 == 1 {
            let phrase = part
                .split_whitespace()
                .collect::<Vec<_>>()
                .join(" ")
                .to_lowercase();
            if !phrase.is_empty() && seen.insert(phrase.clone()) {
                out.push(phrase);
            }
        } else {
            rest.push(' ');
            rest.push_str(part);
        }
    }
    for word in rest.split(|c: char| !c.is_alphanumeric() && c != '\'') {
        let w = word.trim_matches('\'').to_lowercase();
        if w.chars().count() >= 3 && !STOPWORDS.contains(&w.as_str()) && seen.insert(w.clone()) {
            out.push(w);
        }
    }
    out
}

/// A part of a note: the text under one heading (with the heading line), or the text
/// before the first heading (`heading: None`).
#[derive(Debug, Clone, PartialEq)]
pub struct Section {
    pub heading: Option<String>,
    pub text: String,
}

/// A note's body split at its headings (headings inside code blocks don't count).
pub fn sections(body: &str) -> Vec<Section> {
    let mut out = Vec::new();
    let mut heading: Option<String> = None;
    let mut text = String::new();
    let mut fence = false;
    for line in body.split_inclusive('\n') {
        let l = line.trim_end_matches(['\r', '\n']);
        let t = l.trim_start();
        if t.starts_with("```") || t.starts_with("~~~") {
            fence = !fence;
        }
        let hashes = l.chars().take_while(|&c| c == '#').count();
        let is_heading = !fence
            && (1..=6).contains(&hashes)
            && l[hashes..].starts_with([' ', '\t'])
            && !l[hashes..].trim().is_empty();
        if is_heading {
            if heading.is_some() || !text.trim().is_empty() {
                out.push(Section {
                    heading: heading.take(),
                    text: std::mem::take(&mut text),
                });
            }
            text.clear();
            heading = Some(
                l[hashes..]
                    .trim()
                    .trim_end_matches('#')
                    .trim_end()
                    .to_string(),
            );
        }
        text.push_str(line);
    }
    if heading.is_some() || !text.trim().is_empty() {
        out.push(Section { heading, text });
    }
    out
}

/// The text of a note's section under `heading` (`None` = before the first heading),
/// cut to `MAX_PASSAGE_CHARS`.
pub fn section_text(body: &str, heading: Option<&str>) -> Option<String> {
    let s = sections(body)
        .into_iter()
        .find(|s| s.heading.as_deref() == heading)?;
    let mut text = s.text.trim_end().to_string();
    if text.chars().count() > MAX_PASSAGE_CHARS {
        text = text.chars().take(MAX_PASSAGE_CHARS).collect::<String>() + " …";
    }
    Some(text)
}

/// How well a section matches: each term it contains counts 10, plus how often terms
/// appear (up to 9 more).
fn score(text: &str, terms: &[String]) -> u32 {
    let lower = text.to_lowercase();
    let mut distinct = 0;
    let mut hits = 0;
    for t in terms {
        let n = lower.matches(t.as_str()).count() as u32;
        if n > 0 {
            distinct += 1;
            hits += n;
        }
    }
    distinct * 10 + hits.min(9)
}

pub fn estimate_tokens(text: &str) -> u32 {
    (text.chars().count().min(MAX_PASSAGE_CHARS) as u32).div_ceil(4)
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Passage {
    pub path: String,
    pub heading: Option<String>,
    /// Estimated tokens the passage adds to a request.
    pub tokens: u32,
}

impl Index {
    /// The passages that best answer `question`, best first, within `budget` tokens.
    /// `keep(path)` decides which notes may be used (the AI rules).
    pub fn passages(
        &self,
        question: &str,
        budget: u32,
        keep: &dyn Fn(&str) -> bool,
    ) -> AppResult<Vec<Passage>> {
        let terms = question_terms(question);
        if terms.is_empty() {
            return Ok(Vec::new());
        }
        let expr = terms
            .iter()
            .map(|t| {
                if t.contains(' ') {
                    fts_quote(t)
                } else {
                    format!("{}*", fts_quote(t))
                }
            })
            .collect::<Vec<_>>()
            .join(" OR ");
        let mut stmt = self
            .conn()
            .prepare(&format!(
                "SELECT n.path, fts.body FROM notes n JOIN fts ON fts.rowid = n.id
                 WHERE fts MATCH ?1 ORDER BY bm25(fts, 8.0, 1.0) LIMIT {MAX_NOTES}"
            ))
            .map_err(db_err)?;
        let rows = stmt
            .query_map([expr], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
            })
            .map_err(db_err)?;
        let mut out = Vec::new();
        let mut used = 0u32;
        for row in rows {
            let (path, body) = row.map_err(db_err)?;
            if !keep(&path) {
                continue;
            }
            let mut found: Vec<(u32, Section)> = sections(&body)
                .into_iter()
                .map(|s| (score(&s.text, &terms), s))
                .filter(|(n, _)| *n > 0)
                .collect();
            found.sort_by_key(|f| std::cmp::Reverse(f.0));
            for (_, s) in found.into_iter().take(PER_NOTE) {
                let tokens = estimate_tokens(&s.text);
                if used + tokens > budget {
                    continue;
                }
                used += tokens;
                out.push(Passage {
                    path: path.clone(),
                    heading: s.heading,
                    tokens,
                });
            }
        }
        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vault::Vault;

    #[test]
    fn picks_the_words_of_a_question() {
        assert_eq!(
            question_terms("What do mitochondria make, and where is \"Krebs cycle\" in my notes?"),
            ["krebs cycle", "mitochondria"]
        );
        assert!(question_terms("what is it?").is_empty());
    }

    #[test]
    fn splits_a_note_at_its_headings_but_not_inside_code() {
        let body = "Intro line\n# Energy\nATP here\n```\n# not a heading\n```\n## Sub ##\nmore\n";
        let s = sections(body);
        assert_eq!(
            s.iter().map(|s| s.heading.as_deref()).collect::<Vec<_>>(),
            [None, Some("Energy"), Some("Sub")]
        );
        assert!(s[1].text.contains("# not a heading"));
        assert_eq!(section_text(body, Some("Sub")).unwrap(), "## Sub ##\nmore");
        assert_eq!(section_text(body, None).unwrap(), "Intro line");
        assert!(section_text(body, Some("Missing")).is_none());
        let long = format!("# Long\n{}", "x".repeat(MAX_PASSAGE_CHARS * 2));
        assert!(section_text(&long, Some("Long")).unwrap().ends_with(" …"));
    }

    #[test]
    fn finds_the_best_sections_within_the_budget_and_the_rules() {
        let dir = tempfile::tempdir().unwrap();
        let v = Vault::open(dir.path()).unwrap();
        v.write_file(
            "School/Bio.md",
            "# Cells\nCells are small.\n# Energy\nMitochondria make ATP in the Krebs cycle.\n",
            None,
        )
        .unwrap();
        v.write_file("School/Chem.md", "# ATP\nATP stores energy.\n", None)
            .unwrap();
        v.write_file(
            "Medical/Scan.md",
            "# Result\nMitochondria scan ATP.\n",
            None,
        )
        .unwrap();
        v.write_file("Other.md", "# Cooking\nPasta.\n", None)
            .unwrap();
        let idx = Index::open(&v).unwrap();
        let all = |_: &str| true;
        let p = idx
            .passages("Where do mitochondria make ATP?", 10_000, &all)
            .unwrap();
        let got: Vec<(String, Option<String>)> = p
            .iter()
            .map(|p| (p.path.clone(), p.heading.clone()))
            .collect();
        assert!(got.contains(&("School/Bio.md".into(), Some("Energy".into()))));
        assert!(got.contains(&("School/Chem.md".into(), Some("ATP".into()))));
        assert!(!got
            .iter()
            .any(|(p, h)| p == "School/Bio.md" && h.as_deref() == Some("Cells")));
        assert!(!got.iter().any(|(p, _)| p == "Other.md"));
        // The rules decide which notes may be used.
        let no_medical = |p: &str| !p.starts_with("Medical/");
        let p = idx
            .passages("mitochondria ATP", 10_000, &no_medical)
            .unwrap();
        assert!(p.iter().all(|p| !p.path.starts_with("Medical/")));
        // The budget caps what's taken.
        let p = idx.passages("mitochondria ATP", 12, &all).unwrap();
        assert!(p.iter().map(|p| p.tokens).sum::<u32>() <= 12);
        assert!(idx.passages("the and", 10_000, &all).unwrap().is_empty());
    }
}
