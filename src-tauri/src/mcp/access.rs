//! What Claude may see and change in a vault, read again from `.axisnotes/config.json` on
//! every request so a change in Settings → Claude applies at once:
//!
//! ```json
//! { "claude": { "enabled": true, "allowChanges": false },
//!   "ai": { "folders": { "Medical": "never", "Journal": "local" } } }
//! ```
//!
//! Claude is cloud AI, so only paths whose AI rule is "any" are shared. Everything fails
//! closed: an unreadable config refuses all access, an unknown rule value counts as
//! "never", and a rule applies when it matches the path exactly or ignoring case.

use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

use serde_json::Value;

use crate::ai::privacy::{rule_for, AiRule, CONFIG_PATH};
use crate::error::AppError;
use crate::vault::{is_hidden_name, validate_name, Vault};

pub const OFF: &str =
    "Claude can't open this vault: access is off. Turn it on in AXISNotes under Settings → Claude.";
pub const READ_ONLY: &str = "This vault is read-only for Claude. To let Claude make changes, turn on \"Allow changes\" in AXISNotes under Settings → Claude.";

pub struct Access {
    pub enabled: bool,
    pub write: bool,
    rules: HashMap<String, AiRule>,
    /// The same rules with lower-case keys (both are checked; the stricter wins).
    folded: HashMap<String, AiRule>,
    pub daily_folder: String,
    pub daily_format: String,
}

impl Access {
    pub fn load(vault: &Vault) -> Result<Self, String> {
        let text = match vault.read_file(CONFIG_PATH) {
            Ok(f) => f.content,
            Err(AppError::NotFound(_)) => return Ok(Self::off()),
            Err(e) => {
                return Err(format!(
                    "AXISNotes couldn't read this vault's settings ({e}), so Claude's access is refused."
                ))
            }
        };
        let json: Value = serde_json::from_str(&text).map_err(|_| {
            "This vault's settings file (.axisnotes/config.json) isn't valid JSON, so Claude's access is refused until AXISNotes saves it again.".to_string()
        })?;
        let enabled = json.pointer("/claude/enabled") == Some(&Value::Bool(true));
        let write = enabled && json.pointer("/claude/allowChanges") == Some(&Value::Bool(true));
        let mut rules = HashMap::new();
        match json.pointer("/ai/folders") {
            None | Some(Value::Null) => {}
            Some(Value::Object(m)) => {
                for (k, v) in m {
                    let rule = serde_json::from_value::<AiRule>(v.clone()).unwrap_or(AiRule::Never);
                    rules.insert(k.trim_matches('/').to_string(), rule);
                }
            }
            Some(_) => {
                return Err(
                    "This vault's AI folder rules can't be read, so Claude's access is refused."
                        .into(),
                )
            }
        }
        let mut folded: HashMap<String, AiRule> = HashMap::new();
        for (k, r) in &rules {
            let e = folded.entry(k.to_lowercase()).or_insert(*r);
            *e = (*e).max(*r);
        }
        let text_at = |p: &str, def: &str| {
            json.pointer(p)
                .and_then(Value::as_str)
                .filter(|s| !s.trim().is_empty())
                .unwrap_or(def)
                .to_string()
        };
        Ok(Self {
            enabled,
            write,
            rules,
            folded,
            daily_folder: text_at("/dailyNotes/folder", "Daily")
                .trim_matches('/')
                .to_string(),
            daily_format: text_at("/dailyNotes/format", "YYYY-MM-DD"),
        })
    }

    fn off() -> Self {
        Self {
            enabled: false,
            write: false,
            rules: HashMap::new(),
            folded: HashMap::new(),
            daily_folder: "Daily".into(),
            daily_format: "YYYY-MM-DD".into(),
        }
    }

    pub fn require_on(&self) -> Result<(), String> {
        if self.enabled {
            Ok(())
        } else {
            Err(OFF.into())
        }
    }

    pub fn require_write(&self) -> Result<(), String> {
        self.require_on()?;
        if self.write {
            Ok(())
        } else {
            Err(READ_ONLY.into())
        }
    }

    /// The AI rule for a vault path: the stricter of its exact-case and any-case rules.
    pub fn rule(&self, path: &str) -> AiRule {
        rule_for(&self.rules, path).max(rule_for(&self.folded, &path.to_lowercase()))
    }

    /// Claude may see this path: access is on, no part of it is hidden (`.axisnotes`,
    /// `.git`, …), and its AI rule allows cloud models.
    pub fn can_see(&self, path: &str) -> bool {
        self.enabled && visible(path) && self.rule(path) == AiRule::Any
    }

    /// How many folder/file rules keep something from Claude (names are not shown).
    pub fn hidden_rules(&self) -> usize {
        self.rules.values().filter(|r| **r != AiRule::Any).count()
    }
}

fn visible(path: &str) -> bool {
    !path.is_empty()
        && path
            .split('/')
            .all(|s| !s.is_empty() && s != ".." && !is_hidden_name(s))
}

/// A path as Claude wrote it, checked and spelled the way it is on disk.
///
/// Each segment must be a valid name (no `:` streams, trailing dots or spaces), and each
/// one that exists must be found by name in its folder, exactly or ignoring case; the
/// on-disk spelling is used. A segment the folder doesn't list but the file system still
/// opens (an 8.3 short name such as `MEDICA~1`) is refused, so rules can't be sidestepped
/// by another spelling of the same folder.
pub fn real_path(vault: &Vault, path: &str) -> Result<String, String> {
    let cleaned = path.trim().replace('\\', "/");
    let cleaned = cleaned.trim_matches('/');
    if cleaned.is_empty() {
        return Err("Give a note path inside the vault, like \"Folder/Note.md\".".into());
    }
    let mut dir: PathBuf = vault.root().to_path_buf();
    let mut out: Vec<String> = Vec::new();
    let mut on_disk = true;
    for seg in cleaned.split('/') {
        if seg == "." || seg == ".." || validate_name(seg).is_err() {
            return Err(format!("\"{path}\" isn't a valid vault path."));
        }
        let name = if on_disk {
            match listed_name(&dir, seg) {
                Some(n) => n,
                None => {
                    if dir.join(seg).exists() {
                        return Err(not_shared(path));
                    }
                    on_disk = false;
                    seg.to_string()
                }
            }
        } else {
            seg.to_string()
        };
        dir.push(&name);
        out.push(name);
    }
    Ok(out.join("/"))
}

/// The name of `dir`'s entry called `seg`: exact match first, else a unique match
/// ignoring case.
fn listed_name(dir: &std::path::Path, seg: &str) -> Option<String> {
    let entries = fs::read_dir(dir).ok()?;
    let names: Vec<String> = entries
        .filter_map(|e| e.ok())
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .collect();
    if names.iter().any(|n| n == seg) {
        return Some(seg.to_string());
    }
    let lower = seg.to_lowercase();
    let mut matches = names.into_iter().filter(|n| n.to_lowercase() == lower);
    let first = matches.next()?;
    matches.next().is_none().then_some(first)
}

/// The same answer for "missing" and "kept from Claude", so hidden notes stay unseen.
pub fn not_shared(path: &str) -> String {
    format!("No note at \"{path}\" that Claude can open (it doesn't exist, or AXISNotes keeps it from cloud AI).")
}
