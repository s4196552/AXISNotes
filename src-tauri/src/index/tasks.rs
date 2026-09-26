//! Markdown tasks (`- [ ] …`) across the vault, with due dates and priorities written in
//! the Obsidian Tasks plugin's emoji format (`📅 2026-10-01`, `⏫ 🔼 🔽`), so existing
//! vaults work unchanged. `due:2026-10-01` is accepted as an easier-to-type alternative.

use rusqlite::params;
use serde::Serialize;

use super::{db_err, Index};
use crate::error::AppResult;

/// A task as found in one note (before it is stored).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedTask {
    /// 1-based line in the file.
    pub line: usize,
    /// The whole line as written (used to check the file still matches before editing).
    pub raw: String,
    /// Task text without the checkbox and metadata.
    pub text: String,
    pub done: bool,
    /// `YYYY-MM-DD`.
    pub due: Option<String>,
    /// 0 = none, 1 = low, 2 = medium, 3 = high.
    pub priority: u8,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskRef {
    pub path: String,
    pub line: usize,
    pub raw: String,
    pub text: String,
    pub done: bool,
    pub due: Option<String>,
    pub priority: u8,
}

fn is_date(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() == 10
        && b[4] == b'-'
        && b[7] == b'-'
        && b.iter()
            .enumerate()
            .all(|(i, c)| i == 4 || i == 7 || c.is_ascii_digit())
}

/// Parse one line as a task, or None if it isn't a list item with a checkbox.
pub fn parse_task_line(line: &str, line_no: usize) -> Option<ParsedTask> {
    let t = line.trim_start();
    // List marker: -, *, + or an ordered "1." / "1)".
    let rest = if let Some(r) = t.strip_prefix(['-', '*', '+']) {
        r
    } else {
        let digits = t.chars().take_while(char::is_ascii_digit).count();
        if digits == 0 {
            return None;
        }
        t[digits..].strip_prefix(['.', ')'])?
    };
    let rest = rest.strip_prefix([' ', '\t'])?.trim_start();
    let mut chars = rest.chars();
    if chars.next()? != '[' {
        return None;
    }
    let mark = chars.next()?;
    if chars.next()? != ']' {
        return None;
    }
    let done = match mark {
        ' ' => false,
        'x' | 'X' => true,
        _ => return None,
    };
    let body = &rest[3..];
    if !(body.is_empty() || body.starts_with([' ', '\t'])) {
        return None;
    }

    let mut due = None;
    let mut priority = 0u8;
    let mut words: Vec<&str> = Vec::new();
    let mut tokens = body.split_whitespace().peekable();
    while let Some(tok) = tokens.next() {
        match tok {
            "📅" | "🗓️" | "🗓" => {
                if let Some(d) = tokens.peek().filter(|d| is_date(d)) {
                    due = Some((*d).to_string());
                    tokens.next();
                    continue;
                }
                words.push(tok);
            }
            // Done / created / start / scheduled dates: metadata, not text.
            "✅" | "➕" | "🛫" | "⏳" => {
                if tokens.peek().is_some_and(|d| is_date(d)) {
                    tokens.next();
                    continue;
                }
                words.push(tok);
            }
            "🔺" | "⏫" => priority = 3,
            "🔼" => priority = 2,
            "🔽" | "⏬" => priority = priority.max(1),
            _ => {
                if let Some(d) = tok.strip_prefix("due:").filter(|d| is_date(d)) {
                    due = Some(d.to_string());
                } else {
                    words.push(tok);
                }
            }
        }
    }
    // A trailing `^block-id` marker is for links, not part of the text.
    if words
        .last()
        .is_some_and(|w| w.len() > 1 && w.starts_with('^'))
    {
        words.pop();
    }
    Some(ParsedTask {
        line: line_no,
        raw: line.to_string(),
        text: words.join(" "),
        done,
        due,
        priority,
    })
}

impl Index {
    /// Every task in the vault: open tasks first, then by due date (undated last),
    /// priority (high first), path and line.
    pub fn tasks(&self) -> AppResult<Vec<TaskRef>> {
        let mut stmt = self
            .conn()
            .prepare(
                "SELECT n.path, t.line, t.raw, t.text, t.done, t.due, t.priority
                 FROM tasks t JOIN notes n ON n.id = t.note_id
                 ORDER BY t.done, t.due IS NULL, t.due, t.priority DESC, n.path, t.line",
            )
            .map_err(db_err)?;
        let rows = stmt
            .query_map(params![], |r| {
                Ok(TaskRef {
                    path: r.get(0)?,
                    line: r.get::<_, i64>(1)? as usize,
                    raw: r.get(2)?,
                    text: r.get(3)?,
                    done: r.get::<_, i64>(4)? != 0,
                    due: r.get(5)?,
                    priority: r.get::<_, i64>(6)? as u8,
                })
            })
            .map_err(db_err)?;
        rows.collect::<Result<_, _>>().map_err(db_err)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn task(line: &str) -> Option<ParsedTask> {
        parse_task_line(line, 1)
    }

    #[test]
    fn recognizes_checkbox_list_items() {
        assert!(task("- [ ] a").is_some());
        assert!(task("  * [x] a").unwrap().done);
        assert!(task("3. [X] a").unwrap().done);
        assert!(task("+ [ ]").is_some());
        assert!(task("- [-] cancelled").is_none());
        assert!(task("[ ] not a list").is_none());
        assert!(task("- [ ]no space").is_none());
        assert!(task("-[ ] no space").is_none());
        assert!(task("- plain item").is_none());
    }

    #[test]
    fn extracts_due_dates_priorities_and_clean_text() {
        let t = task("- [ ] Call Bob 📅 2026-10-01 ⏫ #work ^abc123").unwrap();
        assert_eq!(t.text, "Call Bob #work");
        assert_eq!(t.due.as_deref(), Some("2026-10-01"));
        assert_eq!(t.priority, 3);

        let t = task("- [x] Pay rent due:2026-09-30 🔼 ✅ 2026-09-29").unwrap();
        assert_eq!(t.text, "Pay rent");
        assert_eq!(t.due.as_deref(), Some("2026-09-30"));
        assert_eq!(t.priority, 2);

        let t = task("- [ ] odd 📅 soon due:notadate").unwrap();
        assert_eq!(t.text, "odd 📅 soon due:notadate");
        assert_eq!((t.due, t.priority), (None, 0));
    }
}
