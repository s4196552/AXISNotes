//! Time tracking entries, kept in each note's frontmatter as
//! `time_log: [{ start, end?, task? }]` (local `YYYY-MM-DDTHH:mm:ss`). An entry without
//! `end` is a running timer.

use serde::Serialize;
use serde_json::Value;

use super::{db_err, Index};
use crate::error::AppResult;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TimeEntry {
    pub path: String,
    pub start: String,
    pub end: Option<String>,
    pub task: Option<String>,
    /// The note's tags (for reports by tag).
    pub tags: Vec<String>,
    /// The note's `project` property, if any.
    pub project: Option<String>,
}

fn string_of(v: Option<&Value>) -> Option<String> {
    match v? {
        Value::String(s) if !s.trim().is_empty() => Some(s.trim().to_string()),
        Value::Array(items) => string_of(items.first()),
        _ => None,
    }
}

impl Index {
    /// Every time entry in the vault, oldest first.
    pub fn time_entries(&self) -> AppResult<Vec<TimeEntry>> {
        let conn = self.conn();
        let mut stmt = conn
            .prepare("SELECT id, path, props FROM notes WHERE props LIKE '%\"time_log\"%'")
            .map_err(db_err)?;
        let notes: Vec<(i64, String, String)> = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
            .map_err(db_err)?
            .collect::<Result<_, _>>()
            .map_err(db_err)?;
        let mut tag_stmt = conn
            .prepare("SELECT tag FROM tags WHERE note_id = ?1 ORDER BY tag")
            .map_err(db_err)?;
        let mut out = Vec::new();
        for (id, path, props) in notes {
            let Ok(Value::Object(props)) = serde_json::from_str::<Value>(&props) else {
                continue;
            };
            let Some(Value::Array(log)) = props.get("time_log") else {
                continue;
            };
            let tags: Vec<String> = tag_stmt
                .query_map([id], |r| r.get(0))
                .map_err(db_err)?
                .collect::<Result<_, _>>()
                .map_err(db_err)?;
            let project = string_of(props.get("project"));
            for e in log {
                let Some(start) = string_of(e.get("start")) else {
                    continue;
                };
                out.push(TimeEntry {
                    path: path.clone(),
                    start,
                    end: string_of(e.get("end")),
                    task: string_of(e.get("task")),
                    tags: tags.clone(),
                    project: project.clone(),
                });
            }
        }
        out.sort_by(|a, b| a.start.cmp(&b.start).then_with(|| a.path.cmp(&b.path)));
        Ok(out)
    }
}
