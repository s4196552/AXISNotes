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

use crate::error::AppError;
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

/// The vault config as JSON, or `None` when the vault has none yet. Anything else that
/// stops it being read (an I/O error, invalid JSON) is an error, so the rules fail closed.
pub fn read_config(vault: &Vault) -> Result<Option<Value>, String> {
    let text = match vault.read_file(CONFIG_PATH) {
        Ok(f) => f.content,
        Err(AppError::NotFound(_)) => return Ok(None),
        Err(e) => {
            return Err(format!(
                "AXISNotes couldn't read this vault's settings ({e}), so its AI rules can't be checked and nothing was sent."
            ))
        }
    };
    serde_json::from_str(&text).map(Some).map_err(|_| {
        "This vault's settings file (.axisnotes/config.json) isn't valid JSON, so its AI rules can't be checked and nothing was sent. Fix the file or save the settings again in AXISNotes.".to_string()
    })
}

/// Folder/file rules from the config (`ai.folders`). A value that isn't "any", "local" or
/// "never" counts as never, and `ai.folders` that isn't an object is an error (fail closed).
pub fn rules_from(config: Option<&Value>) -> Result<HashMap<String, AiRule>, String> {
    match config.and_then(|c| c.pointer("/ai/folders")) {
        None | Some(Value::Null) => Ok(HashMap::new()),
        Some(Value::Object(m)) => {
            let mut out: HashMap<String, AiRule> = HashMap::new();
            for (k, v) in m {
                let rule = v.as_str().map_or(AiRule::Never, parse_rule);
                let e = out.entry(k.trim_matches('/').to_string()).or_insert(rule);
                *e = (*e).max(rule);
            }
            Ok(out)
        }
        Some(_) => Err(
            "This vault's AI folder rules (ai.folders in .axisnotes/config.json) can't be read, so access is refused."
                .into(),
        ),
    }
}

/// Folder/file rules from the vault config; see [`read_config`] and [`rules_from`].
pub fn rules(vault: &Vault) -> Result<HashMap<String, AiRule>, String> {
    rules_from(read_config(vault)?.as_ref())
}

/// Folder/file rules matched both as written and ignoring case, the stricter winning:
/// Windows and macOS open `medical/x.md` from a folder named `Medical`, so a rule must not
/// depend on how a path is spelled.
#[derive(Debug, Clone, Default)]
pub struct FolderRules {
    exact: HashMap<String, AiRule>,
    folded: HashMap<String, AiRule>,
}

impl FolderRules {
    pub fn new(exact: HashMap<String, AiRule>) -> Self {
        let mut folded: HashMap<String, AiRule> = HashMap::new();
        for (k, r) in &exact {
            let e = folded.entry(k.to_lowercase()).or_insert(*r);
            *e = (*e).max(*r);
        }
        Self { exact, folded }
    }

    /// The vault's rules; an unreadable config is an error (see [`rules`]).
    pub fn load(vault: &Vault) -> Result<Self, String> {
        rules(vault).map(Self::new)
    }

    /// The rule for one vault path: the stricter of its exact-case and any-case rules.
    pub fn rule(&self, path: &str) -> AiRule {
        rule_for(&self.exact, path).max(rule_for(&self.folded, &path.to_lowercase()))
    }

    /// How many folder/file rules keep something from cloud AI.
    pub fn restricted(&self) -> usize {
        self.exact.values().filter(|r| **r != AiRule::Any).count()
    }
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
#[cfg(test)]
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

// ---- A note's own mark (AI output keeps the rule of what it was made from) ----

/// The frontmatter key (or, in an HTML page, `<meta name>`) that marks one note's AI
/// access. AXISNotes sets it on AI output made from stricter notes, so a summary of a
/// local-only note stays local-only wherever it's saved.
pub const NOTE_KEY: &str = "ai-access";

/// A mark's value as the index stores it: text is parsed, anything else is never.
pub fn parse_mark(value: Option<&str>) -> AiRule {
    value.map_or(AiRule::Never, parse_rule)
}

/// "any" | "local" | "never"; anything else fails closed.
fn parse_rule(s: &str) -> AiRule {
    match s.trim().to_ascii_lowercase().as_str() {
        "any" => AiRule::Any,
        "local" => AiRule::Local,
        _ => AiRule::Never,
    }
}

/// A note's own AI mark, if it has one. A mark that can't be read counts as never.
pub fn note_mark(path: &str, text: &str) -> Option<AiRule> {
    let lower = path.to_ascii_lowercase();
    if lower.ends_with(".html") || lower.ends_with(".htm") {
        return html_mark(text);
    }
    let (props, _) = crate::index::parse::frontmatter(text);
    match props.get(NOTE_KEY) {
        Some(Value::String(s)) => Some(parse_rule(s)),
        Some(_) => Some(AiRule::Never),
        // Broken YAML hides every property: a mark written there still counts.
        None => leading_block(text)
            .lines()
            .any(is_mark_line)
            .then_some(AiRule::Never),
    }
}

fn is_mark_line(line: &str) -> bool {
    line.trim_start()
        .strip_prefix(NOTE_KEY)
        .is_some_and(|rest| rest.trim_start().starts_with(':'))
}

/// The text of a leading `---` block (up to its closing line, or 200 lines).
fn leading_block(text: &str) -> &str {
    let mut lines = text.split_inclusive('\n');
    if lines.next().map(str::trim_end) != Some("---") {
        return "";
    }
    let start = text.find('\n').map_or(text.len(), |i| i + 1);
    let mut end = start;
    for line in lines.take(200) {
        let t = line.trim_end();
        if t == "---" || t == "..." {
            break;
        }
        end += line.len();
    }
    &text[start..end]
}

/// `<meta name="ai-access" content="local">` in the first 16 KB of a page.
fn html_mark(text: &str) -> Option<AiRule> {
    let mut cut = text.len().min(16_384);
    while !text.is_char_boundary(cut) {
        cut -= 1;
    }
    let head = text[..cut].to_ascii_lowercase();
    let at = head.find(NOTE_KEY)?;
    let open = head[..at].rfind('<').unwrap_or(0);
    let close = head[at..].find('>').map_or(head.len(), |i| at + i);
    let tag = &head[open..close];
    let value = tag.find("content=").and_then(|i| {
        let rest = &tag[i + "content=".len()..];
        let quote = rest.chars().next().filter(|c| *c == '"' || *c == '\'')?;
        let rest = &rest[1..];
        rest.find(quote).map(|j| &rest[..j])
    });
    Some(value.map_or(AiRule::Never, parse_rule))
}

/// The rule for one note: its folder/file rule or its own mark, whichever is stricter.
pub fn rule_for_note(rules: &FolderRules, path: &str, text: Option<&str>) -> AiRule {
    let mark = text.and_then(|t| note_mark(path, t)).unwrap_or(AiRule::Any);
    rules.rule(path).max(mark)
}

// ---- Which models a folder allows ----

/// `ai.models` in the vault config: the only models notes in a folder (or a file) may be
/// sent to, as `"<provider id>/<model>"` or `"<provider id>/*"`:
///
/// ```json
/// { "ai": { "models": { "Lab": ["ollama/llama3.3", "lmstudio/*"] } } }
/// ```
///
/// A value that isn't a list of strings allows nothing, and `ai.models` that isn't an
/// object is an error (fail closed).
pub fn allowlists_from(config: Option<&Value>) -> Result<HashMap<String, Vec<String>>, String> {
    let m = match config.and_then(|c| c.pointer("/ai/models")) {
        None | Some(Value::Null) => return Ok(HashMap::new()),
        Some(Value::Object(m)) => m,
        Some(_) => {
            return Err(
                "This vault's AI model rules (ai.models in .axisnotes/config.json) can't be read, so nothing was sent."
                    .into(),
            )
        }
    };
    let mut out: HashMap<String, Vec<String>> = HashMap::new();
    for (k, v) in m {
        let list: Vec<String> = v
            .as_array()
            .filter(|a| a.iter().all(Value::is_string))
            .map(|a| {
                a.iter()
                    .filter_map(Value::as_str)
                    .map(str::to_string)
                    .collect()
            })
            .unwrap_or_default();
        let key = k.trim_matches('/').to_string();
        match out.get_mut(&key) {
            // Two spellings of one key ("Lab", "/Lab/"): a model must be on both.
            Some(prev) => prev.retain(|e| list.contains(e)),
            None => {
                out.insert(key, list);
            }
        }
    }
    Ok(out)
}

/// The vault's model allowlists; an unreadable config is an error (see [`read_config`]).
#[cfg(test)]
pub fn model_allowlists(vault: &Vault) -> Result<HashMap<String, Vec<String>>, String> {
    allowlists_from(read_config(vault)?.as_ref())
}

/// Every allowlist that applies to a path: the nearest one as written, and the nearest
/// one ignoring case (all of them, if several keys differ only in case). A model must be
/// on each.
pub fn allowlists_for<'a>(
    lists: &'a HashMap<String, Vec<String>>,
    path: &str,
) -> Vec<(&'a str, &'a [String])> {
    let mut out: Vec<(&'a str, &'a [String])> = allowlist_for(lists, path).into_iter().collect();
    let lower = path.trim_matches('/').to_lowercase();
    let mut p = lower.as_str();
    loop {
        let mut found = false;
        for (k, v) in lists {
            if k.to_lowercase() == p {
                found = true;
                if !out.iter().any(|(at, _)| *at == k.as_str()) {
                    out.push((k.as_str(), v.as_slice()));
                }
            }
        }
        if found || p.is_empty() {
            return out;
        }
        p = p.rfind('/').map_or("", |i| &p[..i]);
    }
}

/// The nearest allowlist for a path (its own, else its closest folder's), with where it's set.
pub fn allowlist_for<'a>(
    lists: &'a HashMap<String, Vec<String>>,
    path: &str,
) -> Option<(&'a str, &'a [String])> {
    let mut p = path.trim_matches('/');
    loop {
        if let Some((k, v)) = lists.get_key_value(p) {
            return Some((k.as_str(), v.as_slice()));
        }
        if p.is_empty() {
            return None;
        }
        p = p.rfind('/').map_or("", |i| &p[..i]);
    }
}

/// Whether `provider`'s `model` is on the list.
pub fn allows(list: &[String], provider: &str, model: &str) -> bool {
    list.iter().any(|entry| match entry.split_once('/') {
        Some((p, m)) => p == provider && (m == "*" || m == model),
        None => false,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_notes_own_mark_is_read_and_fails_closed() {
        let md = |fm: &str| format!("---\n{fm}\n---\n# Body\n");
        assert_eq!(note_mark("a.md", "# no frontmatter"), None);
        assert_eq!(note_mark("a.md", &md("title: x")), None);
        assert_eq!(
            note_mark("a.md", &md("ai-access: local")),
            Some(AiRule::Local)
        );
        assert_eq!(
            note_mark("a.md", &md("ai-access: NEVER")),
            Some(AiRule::Never)
        );
        assert_eq!(note_mark("a.md", &md("ai-access: any")), Some(AiRule::Any));
        assert_eq!(
            note_mark("a.md", &md("ai-access: maybe")),
            Some(AiRule::Never)
        );
        assert_eq!(
            note_mark("a.md", &md("ai-access: [local]")),
            Some(AiRule::Never)
        );
        // Broken YAML: the mark still counts, as never.
        assert_eq!(
            note_mark("a.md", &md("ai-access: local\ntags: [unclosed")),
            Some(AiRule::Never)
        );
        assert_eq!(note_mark("a.md", &md("ai-accessible: yes")), None);
        let page =
            |meta: &str| format!("<!doctype html><html><head>{meta}</head><body>x</body></html>");
        assert_eq!(note_mark("p.html", &page("")), None);
        assert_eq!(
            note_mark(
                "p.html",
                &page(r#"<meta name="ai-access" content="local">"#)
            ),
            Some(AiRule::Local)
        );
        assert_eq!(
            note_mark(
                "p.HTML",
                &page(r#"<meta content='never' name='AI-Access'>"#)
            ),
            Some(AiRule::Never)
        );
        assert_eq!(
            note_mark("p.html", &page(r#"<meta name="ai-access">"#)),
            Some(AiRule::Never)
        );
        let rules = FolderRules::new([("Lab".to_string(), AiRule::Local)].into());
        assert_eq!(rule_for_note(&rules, "Lab/x.md", None), AiRule::Local);
        assert_eq!(
            rule_for_note(&rules, "Lab/x.md", Some(&md("ai-access: any"))),
            AiRule::Local,
            "a mark never loosens the folder's rule"
        );
        assert_eq!(
            rule_for_note(&rules, "School/x.md", Some(&md("ai-access: never"))),
            AiRule::Never
        );
    }

    #[test]
    fn model_allowlists_use_the_nearest_folder_and_fail_closed() {
        let dir = tempfile::tempdir().unwrap();
        let v = Vault::open(dir.path()).unwrap();
        v.write_file(
            CONFIG_PATH,
            r#"{"ai":{"models":{"Lab":["ollama/llama3.3","lmstudio/*"],"Lab/Open":["openai/*"],"Bad":"ollama/x","Mixed":["ollama/a",3]}}}"#,
            None,
        )
        .unwrap();
        let lists = model_allowlists(&v).unwrap();
        let (at, lab) = allowlist_for(&lists, "Lab/2026/run.md").unwrap();
        assert_eq!(at, "Lab");
        assert!(allows(lab, "ollama", "llama3.3"));
        assert!(!allows(lab, "ollama", "qwen3"));
        assert!(allows(lab, "lmstudio", "anything"));
        assert!(!allows(lab, "openai", "gpt-6-sol"));
        assert_eq!(
            allowlist_for(&lists, "Lab/Open/x.md").unwrap().0,
            "Lab/Open"
        );
        assert!(allowlist_for(&lists, "School/x.md").is_none());
        assert!(allowlist_for(&lists, "Bad/x.md").unwrap().1.is_empty());
        assert!(allowlist_for(&lists, "Mixed/x.md").unwrap().1.is_empty());
        assert!(!allows(&["ollama".into()], "ollama", "x"));
    }

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
        // No config yet: no rules.
        assert!(rules(&v).unwrap().is_empty());
        v.write_file(
            CONFIG_PATH,
            r#"{"theme":"dark","ai":{"folders":{"/Medical/":"never","Bad":"sometimes","Caps":"Local","Num":3}}}"#,
            None,
        )
        .unwrap();
        let r = rules(&v).unwrap();
        assert_eq!(r.get("Medical"), Some(&AiRule::Never));
        // A value that can't be read counts as never (fail closed); case doesn't matter.
        assert_eq!(r.get("Bad"), Some(&AiRule::Never));
        assert_eq!(r.get("Num"), Some(&AiRule::Never));
        assert_eq!(r.get("Caps"), Some(&AiRule::Local));
    }

    #[test]
    fn a_config_that_cant_be_read_fails_closed() {
        let dir = tempfile::tempdir().unwrap();
        let v = Vault::open(dir.path()).unwrap();
        v.write_file(
            CONFIG_PATH,
            r#"{"ai":{"folders":{"Medical":"never"},}}"#,
            None,
        )
        .unwrap();
        assert!(rules(&v).is_err());
        assert!(FolderRules::load(&v).is_err());
        assert!(model_allowlists(&v).is_err());
        v.write_file(
            CONFIG_PATH,
            r#"{"ai":{"folders":["Medical"],"models":"x"}}"#,
            None,
        )
        .unwrap();
        assert!(rules(&v).is_err());
        assert!(model_allowlists(&v).is_err());
        // A null section is the same as none.
        let cfg: Value = serde_json::from_str(r#"{"ai":{"folders":null,"models":null}}"#).unwrap();
        assert!(rules_from(Some(&cfg)).unwrap().is_empty());
        assert!(allowlists_from(Some(&cfg)).unwrap().is_empty());
    }

    #[test]
    fn folder_rules_and_allowlists_match_ignoring_case() {
        let r = FolderRules::new(
            [
                ("medical".to_string(), AiRule::Never),
                ("Journal".to_string(), AiRule::Local),
                ("journal".to_string(), AiRule::Any),
            ]
            .into(),
        );
        assert_eq!(r.rule("Medical/scan.md"), AiRule::Never);
        assert_eq!(r.rule("MEDICAL/x/y.md"), AiRule::Never);
        // Two spellings of one folder: the stricter wins, however the path is spelled.
        assert_eq!(r.rule("journal/day.md"), AiRule::Local);
        assert_eq!(r.rule("School/x.md"), AiRule::Any);
        assert_eq!(r.restricted(), 2);

        let lists: HashMap<String, Vec<String>> = [
            ("lab".to_string(), vec!["ollama/*".to_string()]),
            ("Lab/Open".to_string(), vec!["openai/*".to_string()]),
        ]
        .into();
        let found: Vec<&str> = allowlists_for(&lists, "Lab/run.md")
            .into_iter()
            .map(|(at, _)| at)
            .collect();
        assert_eq!(found, ["lab"]);
        let found: Vec<&str> = allowlists_for(&lists, "lab/open/x.md")
            .into_iter()
            .map(|(at, _)| at)
            .collect();
        // "lab" matches as written, "Lab/Open" ignoring case: both apply.
        assert_eq!(found, ["lab", "Lab/Open"]);
        assert!(allowlists_for(&lists, "School/x.md").is_empty());
        // Keys that differ only by slashes must both allow a model.
        let cfg: Value =
            serde_json::from_str(r#"{"ai":{"models":{"Lab":["a/1","b/2"],"/Lab/":["b/2"]}}}"#)
                .unwrap();
        assert_eq!(allowlists_from(Some(&cfg)).unwrap()["Lab"], ["b/2"]);
    }
}
