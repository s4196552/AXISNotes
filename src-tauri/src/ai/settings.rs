//! AI settings, per user (not per vault, since vaults may be shared): configured
//! providers, the model for each task, the fallback order and cost limits. Stored as
//! `ai-settings.json` in the app config folder. Never contains API keys.

use std::collections::HashMap;
use std::path::Path;

use serde::{Deserialize, Serialize};

use super::registry::Task;
use super::{Effort, ProviderKind};
use crate::error::AppResult;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderConfig {
    /// Stable id (also the keychain entry name).
    pub id: String,
    pub kind: ProviderKind,
    pub name: String,
    /// Empty = the provider's default endpoint.
    #[serde(default)]
    pub base_url: String,
    #[serde(default = "yes")]
    pub enabled: bool,
}

fn yes() -> bool {
    true
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskChoice {
    pub provider: String,
    pub model: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct AiSettings {
    pub providers: Vec<ProviderConfig>,
    pub tasks: HashMap<Task, TaskChoice>,
    /// Provider ids to try, in order, when the task's provider fails.
    pub fallback: Vec<String>,
    /// Refuse requests estimated above this many input tokens (None = no cap).
    pub max_input_tokens: Option<u32>,
    /// Ask before sending requests estimated above this many input tokens.
    pub confirm_above_tokens: u32,
    pub effort: Effort,
    /// Keep the local request log (metadata only).
    pub log_requests: bool,
}

impl Default for AiSettings {
    fn default() -> Self {
        AiSettings {
            providers: Vec::new(),
            tasks: HashMap::new(),
            fallback: Vec::new(),
            max_input_tokens: None,
            confirm_above_tokens: 4_000,
            effort: Effort::Balanced,
            log_requests: true,
        }
    }
}

/// Shown when an endpoint would send API keys and notes over unencrypted HTTP.
pub const PLAIN_HTTP_REMOTE: &str = "Plain http:// is only allowed for a server on this computer (localhost, 127.0.0.1 or [::1]). Use https:// for other servers, so API keys and notes aren't sent unencrypted.";

/// Why `url` can't be a provider endpoint, or None if it can (empty = the default).
pub fn endpoint_problem(url: &str) -> Option<String> {
    not_web_address(url).or_else(|| plaintext_remote(url).then(|| PLAIN_HTTP_REMOTE.into()))
}

/// An `http://` endpoint that isn't on this computer: keys and notes would cross the
/// network unencrypted.
pub fn plaintext_remote(url: &str) -> bool {
    let url = url.trim();
    url.get(..7)
        .is_some_and(|s| s.eq_ignore_ascii_case("http://"))
        && !super::is_local_url(url)
}

/// Why `url` isn't a web address at all (for example a pasted API key), or None.
fn not_web_address(url: &str) -> Option<String> {
    let url = url.trim();
    if url.is_empty() {
        return None;
    }
    let lower = url.to_ascii_lowercase();
    let rest = lower
        .strip_prefix("https://")
        .or_else(|| lower.strip_prefix("http://"));
    let ok = rest.is_some_and(|r| {
        let host = r.split(['/', '?', '#']).next().unwrap_or("");
        !host.is_empty() && url.chars().all(|c| c.is_ascii_graphic())
    });
    if ok {
        return None;
    }
    Some(if looks_like_key(url) {
        "That looks like an API key, not an endpoint. Paste it in the API key box and leave the endpoint empty.".into()
    } else {
        "The endpoint must be a web address starting with https:// (or http:// for a local server), or empty for the default.".into()
    })
}

/// A secret pasted into the wrong box: no scheme, no spaces, long or key-prefixed.
pub fn looks_like_key(s: &str) -> bool {
    let s = s.trim();
    !s.contains("://")
        && !s.contains(char::is_whitespace)
        && (s.starts_with("sk-")
            || s.starts_with("sk_")
            || s.starts_with("AIza")
            || (s.len() >= 32 && !s.contains('/') && !s.contains('.')))
}

impl AiSettings {
    pub fn load(path: &Path) -> Self {
        std::fs::read_to_string(path)
            .ok()
            .and_then(|t| serde_json::from_str(&t).ok())
            .unwrap_or_default()
    }

    /// Clear endpoints that aren't web addresses (for example an API key pasted into the
    /// endpoint box, which would otherwise sit in this plain-text file). True if any changed.
    /// A saved plain-http remote endpoint is kept, so the user sees it; requests to it are
    /// refused by the transport until it is changed.
    pub fn clear_bad_endpoints(&mut self) -> bool {
        let mut changed = false;
        for p in &mut self.providers {
            if not_web_address(&p.base_url).is_some() {
                p.base_url.clear();
                changed = true;
            }
        }
        changed
    }

    pub fn save(&self, path: &Path) -> AppResult<()> {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let tmp = path.with_extension("json.tmp");
        std::fs::write(&tmp, serde_json::to_string_pretty(self).unwrap_or_default())?;
        std::fs::rename(&tmp, path)?;
        Ok(())
    }

    pub fn provider(&self, id: &str) -> Option<&ProviderConfig> {
        self.providers.iter().find(|p| p.id == id)
    }

    pub fn task(&self, task: Task) -> Option<&TaskChoice> {
        self.tasks.get(&task)
    }
}
