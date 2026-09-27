//! Importing an Obsidian vault into the open AXISNotes vault. Obsidian's Markdown (wikilinks,
//! embeds, block ids, tags, callouts, frontmatter) is what AXISNotes uses, so notes are copied
//! as they are. JSON Canvas files (`.canvas`) become AXISNotes canvases, and the template and
//! daily-note settings are read so the UI can offer to use them. Nothing is overwritten:
//! a file that already exists in the vault is skipped and reported.

mod canvas;

use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::error::{AppError, AppResult};
use crate::vault::Vault;

pub use canvas::json_canvas_to_axcanvas;

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

#[derive(Debug, Clone, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ImportReport {
    /// Vault folder the files went into ("" = the vault root).
    pub target: String,
    pub notes: usize,
    pub attachments: usize,
    pub canvases: usize,
    pub skipped: Vec<Skipped>,
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

fn skip_dir(name: &str) -> bool {
    name.starts_with('.') || name == "node_modules"
}

/// Files to import, as paths relative to `source` with forward slashes.
fn walk(source: &Path) -> AppResult<Vec<String>> {
    let mut out = Vec::new();
    let mut stack = vec![PathBuf::new()];
    while let Some(rel) = stack.pop() {
        let dir = source.join(&rel);
        let mut entries: Vec<_> = fs::read_dir(&dir)?.filter_map(Result::ok).collect();
        entries.sort_by_key(|e| e.file_name());
        for e in entries {
            let name = e.file_name().to_string_lossy().into_owned();
            let child = rel.join(&name);
            let ft = e.file_type()?;
            if ft.is_dir() {
                if !skip_dir(&name) {
                    stack.push(child);
                }
            } else if ft.is_file() && !name.starts_with('.') {
                out.push(child.to_string_lossy().replace('\\', "/"));
            }
        }
    }
    out.sort();
    Ok(out)
}

/// Copy the Obsidian vault at `source` into `target` (a folder in `vault`, "" = root).
pub fn import_obsidian(vault: &Vault, source: &Path, target: &str) -> AppResult<ImportReport> {
    if !source.is_dir() {
        return Err(AppError::NotFound(source.display().to_string()));
    }
    let target = target.trim().trim_matches('/').to_string();
    if target
        .split('/')
        .any(|p| p == ".." || p == "." || p.starts_with('.') && !p.is_empty())
    {
        return Err(AppError::InvalidName(format!("import folder {target:?}")));
    }
    // Importing a folder into itself (or the vault into itself) would recurse.
    let src = dunce::canonicalize(source)?;
    let root = dunce::canonicalize(vault.root())?;
    if root.starts_with(&src) || src.starts_with(&root) {
        return Err(AppError::InvalidName(
            "pick a folder outside this vault (it can't import itself)".into(),
        ));
    }
    let within = |p: &str| {
        if target.is_empty() {
            p.to_string()
        } else {
            format!("{target}/{p}")
        }
    };
    let mut report = ImportReport {
        target: target.clone(),
        settings: read_settings(source, &target),
        ..ImportReport::default()
    };
    for rel in walk(source)? {
        let from = source.join(&rel);
        let lower = rel.to_lowercase();
        let (dest, canvas) = if lower.ends_with(".canvas") {
            (within(&format!("{}.axcanvas", &rel[..rel.len() - 7])), true)
        } else {
            (within(&rel), false)
        };
        let abs = match vault.resolve(&dest) {
            Ok(p) => p,
            Err(e) => {
                report.skipped.push(Skipped {
                    path: rel,
                    reason: e.to_string(),
                });
                continue;
            }
        };
        if abs.exists() {
            report.skipped.push(Skipped {
                path: rel,
                reason: "already exists in the vault".into(),
            });
            continue;
        }
        let result = if canvas {
            fs::read_to_string(&from)
                .map_err(AppError::from)
                .and_then(|text| {
                    json_canvas_to_axcanvas(&text, &target)
                        .map_err(|e| AppError::InvalidName(format!("not a JSON Canvas: {e}")))
                })
                .and_then(|json| vault.write_file(&dest, &json, None).map(|_| ()))
        } else {
            fs::read(&from)
                .map_err(AppError::from)
                .and_then(|bytes| vault.write_bytes(&dest, &bytes))
        };
        match result {
            Ok(()) if canvas => report.canvases += 1,
            Ok(()) if lower.ends_with(".md") => report.notes += 1,
            Ok(()) => report.attachments += 1,
            Err(e) => report.skipped.push(Skipped {
                path: rel,
                reason: e.to_string(),
            }),
        }
    }
    Ok(report)
}

#[cfg(test)]
mod tests;
