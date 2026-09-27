//! Per-folder AI privacy rules, set in the vault's `.axisnotes/config.json`:
//!
//! ```json
//! { "ai": { "folders": { "Medical": "never", "Journal": "local", "Journal/Public": "any" } } }
//! ```
//!
//! The most specific rule for a path wins (a file rule beats its folder's rule). A request
//! is held to the strictest rule of all the notes it includes. This is enforced here, in
//! Rust, before any provider is contacted.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::vault::Vault;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AiRule {
    Any,
    /// Only providers on this machine (Ollama, LM Studio, localhost endpoints).
    Local,
    Never,
}

pub const CONFIG_PATH: &str = ".axisnotes/config.json";

/// Folder/file rules from the vault config (missing or invalid config = no rules).
pub fn rules(vault: &Vault) -> HashMap<String, AiRule> {
    let Ok(file) = vault.read_file(CONFIG_PATH) else {
        return HashMap::new();
    };
    let Ok(json) = serde_json::from_str::<Value>(&file.content) else {
        return HashMap::new();
    };
    json.pointer("/ai/folders")
        .and_then(Value::as_object)
        .map(|m| {
            m.iter()
                .filter_map(|(k, v)| {
                    let rule = serde_json::from_value::<AiRule>(v.clone()).ok()?;
                    Some((k.trim_matches('/').to_string(), rule))
                })
                .collect()
        })
        .unwrap_or_default()
}

/// The rule for one vault path: its own, else the nearest ancestor folder's, else Any.
pub fn rule_for(rules: &HashMap<String, AiRule>, path: &str) -> AiRule {
    let mut p = path.trim_matches('/');
    loop {
        if let Some(r) = rules.get(p) {
            return *r;
        }
        if p.is_empty() {
            return AiRule::Any;
        }
        p = p.rfind('/').map_or("", |i| &p[..i]);
    }
}

/// The strictest rule over every source path.
pub fn strictest<'a>(
    rules: &HashMap<String, AiRule>,
    paths: impl IntoIterator<Item = &'a String>,
) -> AiRule {
    paths
        .into_iter()
        .map(|p| rule_for(rules, p))
        .max()
        .unwrap_or(AiRule::Any)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn most_specific_rule_wins_and_requests_take_the_strictest() {
        let rules: HashMap<String, AiRule> = [
            ("Medical".to_string(), AiRule::Never),
            ("Journal".to_string(), AiRule::Local),
            ("Journal/Public".to_string(), AiRule::Any),
            ("School/Grades.md".to_string(), AiRule::Local),
        ]
        .into();
        assert_eq!(rule_for(&rules, "Medical/2026/scan.md"), AiRule::Never);
        assert_eq!(rule_for(&rules, "Journal/day.md"), AiRule::Local);
        assert_eq!(rule_for(&rules, "Journal/Public/post.md"), AiRule::Any);
        assert_eq!(rule_for(&rules, "School/Grades.md"), AiRule::Local);
        assert_eq!(rule_for(&rules, "School/Bio.md"), AiRule::Any);
        assert_eq!(rule_for(&rules, "MedicalNotes.md"), AiRule::Any); // not inside "Medical"
        let paths = ["School/Bio.md".to_string(), "Journal/x.md".to_string()];
        assert_eq!(strictest(&rules, &paths), AiRule::Local);
        let paths = ["Journal/x.md".to_string(), "Medical/y.md".to_string()];
        assert_eq!(strictest(&rules, &paths), AiRule::Never);
    }

    #[test]
    fn reads_rules_from_the_vault_config() {
        let dir = tempfile::tempdir().unwrap();
        let v = Vault::open(dir.path()).unwrap();
        v.write_file(
            CONFIG_PATH,
            r#"{"theme":"dark","ai":{"folders":{"/Medical/":"never","Bad":"sometimes"}}}"#,
            None,
        )
        .unwrap();
        let r = rules(&v);
        assert_eq!(r.get("Medical"), Some(&AiRule::Never));
        assert!(!r.contains_key("Bad"));
    }
}
