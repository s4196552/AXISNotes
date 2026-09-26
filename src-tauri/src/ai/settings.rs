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

impl AiSettings {
    pub fn load(path: &Path) -> Self {
        std::fs::read_to_string(path)
            .ok()
            .and_then(|t| serde_json::from_str(&t).ok())
            .unwrap_or_default()
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
