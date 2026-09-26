//! Model defaults and capabilities from `ai-models.json`: the bundled copy, overlaid by
//! the user's editable copy in the app config folder. Live model lists from providers
//! are enriched with these flags (or name hints when a model isn't listed).

use std::collections::HashMap;
use std::path::Path;

use serde::{Deserialize, Serialize};

use super::{ModelInfo, ProviderKind, Request};

pub const BUNDLED: &str = include_str!("../../ai-models.json");

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Task {
    Handwriting,
    Diagrams,
    TextFixes,
    Chat,
}

impl Task {
    /// Capabilities a model needs for this task.
    pub fn needs_vision(self) -> bool {
        self == Task::Handwriting
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct Price {
    pub input: f64,
    pub output: f64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct ModelSpec {
    pub id: String,
    pub name: Option<String>,
    pub vision: Option<bool>,
    pub json: Option<bool>,
    pub context: Option<u32>,
    /// False when the model rejects custom temperature/top_p.
    pub sampling: Option<bool>,
    /// Image generation model (not for text tasks).
    pub image: Option<bool>,
    pub price: Option<Price>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
struct ProviderSpec {
    defaults: HashMap<Task, String>,
    models: Vec<ModelSpec>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct File {
    providers: HashMap<ProviderKind, ProviderSpec>,
    vision_hints: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct Registry {
    file: File,
}

impl Registry {
    pub fn bundled() -> Self {
        Registry {
            file: serde_json::from_str(BUNDLED).expect("bundled ai-models.json is valid"),
        }
    }

    /// Bundled defaults overlaid with the user's copy (per provider: its defaults and
    /// models replace or add to the bundled ones). A broken user file is ignored.
    pub fn load(user: Option<&Path>) -> Self {
        let mut reg = Self::bundled();
        let Some(text) = user.and_then(|p| std::fs::read_to_string(p).ok()) else {
            return reg;
        };
        let Ok(over) = serde_json::from_str::<File>(&text) else {
            return reg;
        };
        for (kind, spec) in over.providers {
            let base = reg.file.providers.entry(kind).or_default();
            base.defaults.extend(spec.defaults);
            for m in spec.models {
                match base.models.iter_mut().find(|b| b.id == m.id) {
                    Some(b) => *b = m,
                    None => base.models.push(m),
                }
            }
        }
        if !over.vision_hints.is_empty() {
            reg.file.vision_hints = over.vision_hints;
        }
        reg
    }

    /// Spec for `id`: exact match, else the longest listed id that prefixes it (so
    /// dated snapshots like `gpt-6-sol-2026-09-22` inherit `gpt-6-sol`).
    pub fn spec(&self, kind: ProviderKind, id: &str) -> Option<&ModelSpec> {
        let models = &self.file.providers.get(&kind)?.models;
        models.iter().find(|m| m.id == id).or_else(|| {
            models
                .iter()
                .filter(|m| id.starts_with(&m.id))
                .max_by_key(|m| m.id.len())
        })
    }

    fn vision_hint(&self, id: &str) -> bool {
        let id = id.to_ascii_lowercase();
        self.file
            .vision_hints
            .iter()
            .any(|h| id.contains(h.as_str()))
    }

    /// Fill in capabilities for a model reported by a provider.
    pub fn enrich(&self, kind: ProviderKind, mut m: ModelInfo) -> ModelInfo {
        match self.spec(kind, &m.id) {
            Some(s) => {
                m.vision = s.vision.unwrap_or(m.vision || self.vision_hint(&m.id));
                m.json = s.json.unwrap_or(m.json);
                m.context = s.context.or(m.context);
                if let Some(name) = &s.name {
                    if m.name == m.id {
                        m.name = name.clone();
                    }
                }
            }
            None => m.vision = m.vision || self.vision_hint(&m.id),
        }
        m
    }

    /// Text models from the registry, used when a provider's model list can't be fetched.
    pub fn listed(&self, kind: ProviderKind) -> Vec<ModelInfo> {
        self.file
            .providers
            .get(&kind)
            .map(|p| {
                p.models
                    .iter()
                    .filter(|s| s.image != Some(true))
                    .map(|s| ModelInfo {
                        id: s.id.clone(),
                        name: s.name.clone().unwrap_or_else(|| s.id.clone()),
                        vision: s.vision.unwrap_or(false),
                        json: s.json.unwrap_or(false),
                        context: s.context,
                    })
                    .collect()
            })
            .unwrap_or_default()
    }

    pub fn is_text_model(&self, kind: ProviderKind, id: &str) -> bool {
        self.spec(kind, id).is_none_or(|s| s.image != Some(true))
    }

    /// Default model for a task: the configured one if the provider offers it, else a
    /// choice from the live list (Gemini's defaults are always picked this way).
    pub fn default_model(
        &self,
        kind: ProviderKind,
        task: Task,
        available: &[ModelInfo],
    ) -> Option<String> {
        let configured = self
            .file
            .providers
            .get(&kind)
            .and_then(|p| p.defaults.get(&task));
        if let Some(id) = configured {
            if available.is_empty() || available.iter().any(|m| &m.id == id) {
                return Some(id.clone());
            }
        }
        let usable: Vec<&ModelInfo> = available
            .iter()
            .filter(|m| self.is_text_model(kind, &m.id))
            .filter(|m| !task.needs_vision() || m.vision)
            .collect();
        if kind == ProviderKind::Gemini {
            let pick = |want: &dyn Fn(&str) -> bool| {
                usable
                    .iter()
                    .filter(|m| want(&m.id) && !m.id.contains("preview") && !m.id.contains("exp"))
                    .map(|m| m.id.clone())
                    .max_by(|a, b| version_key(a).cmp(&version_key(b)))
            };
            let chosen = match task {
                Task::Diagrams => pick(&|id| id.contains("pro")),
                Task::TextFixes => pick(&|id| id.contains("flash-lite")),
                Task::Handwriting | Task::Chat => {
                    pick(&|id| id.contains("flash") && !id.contains("lite"))
                }
            };
            if chosen.is_some() {
                return chosen;
            }
        }
        usable.first().map(|m| m.id.clone())
    }

    /// Adjust a request for known model limits before sending it.
    pub fn prepare(&self, kind: ProviderKind, req: &mut Request) {
        if self.spec(kind, &req.model).and_then(|s| s.sampling) == Some(false) {
            req.temperature = None;
        }
    }

    /// Estimated cost in USD, when the model's price is known.
    pub fn cost(&self, kind: ProviderKind, model: &str, input: u32, output: u32) -> Option<f64> {
        let p = self.spec(kind, model)?.price.as_ref()?;
        Some((input as f64 * p.input + output as f64 * p.output) / 1_000_000.0)
    }
}

/// Numbers in a model id, for picking the newest (`gemini-3.1-pro` > `gemini-2.5-pro`).
fn version_key(id: &str) -> Vec<u32> {
    id.split(|c: char| !c.is_ascii_digit())
        .filter(|s| !s.is_empty())
        .filter_map(|s| s.parse().ok())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn info(id: &str, vision: bool) -> ModelInfo {
        ModelInfo {
            id: id.into(),
            name: id.into(),
            vision,
            json: true,
            context: None,
        }
    }

    #[test]
    fn bundled_defaults_match_the_spec() {
        let r = Registry::bundled();
        let d = |k, t| r.default_model(k, t, &[]);
        assert_eq!(
            d(ProviderKind::OpenAi, Task::Diagrams).as_deref(),
            Some("gpt-6-astra")
        );
        assert_eq!(
            d(ProviderKind::OpenAi, Task::Handwriting).as_deref(),
            Some("gpt-6-sol")
        );
        assert_eq!(
            d(ProviderKind::OpenAi, Task::TextFixes).as_deref(),
            Some("gpt-6-luna")
        );
        assert_eq!(
            d(ProviderKind::Anthropic, Task::Diagrams).as_deref(),
            Some("claude-opus-5-5")
        );
        assert_eq!(
            d(ProviderKind::Anthropic, Task::TextFixes).as_deref(),
            Some("claude-haiku-4-5-20251001")
        );
    }

    #[test]
    fn omits_sampling_for_models_that_reject_it_including_snapshots() {
        let r = Registry::bundled();
        let mut req = Request {
            model: "gpt-6-astra-2026-09-03".into(),
            temperature: Some(0.2),
            ..Request::default()
        };
        r.prepare(ProviderKind::OpenAi, &mut req);
        assert_eq!(req.temperature, None);
        let mut req = Request {
            model: "gpt-6-sol".into(),
            temperature: Some(0.2),
            ..Request::default()
        };
        r.prepare(ProviderKind::OpenAi, &mut req);
        assert_eq!(req.temperature, Some(0.2));
    }

    #[test]
    fn picks_gemini_defaults_from_the_live_list() {
        let r = Registry::bundled();
        let live: Vec<ModelInfo> = [
            "gemini-2.5-pro",
            "gemini-3.1-pro",
            "gemini-3.1-pro-preview",
            "gemini-3.1-flash",
            "gemini-3.1-flash-lite",
            "text-embedding-004",
        ]
        .iter()
        .map(|id| r.enrich(ProviderKind::Gemini, info(id, false)))
        .collect();
        let d = |t| r.default_model(ProviderKind::Gemini, t, &live);
        assert_eq!(d(Task::Diagrams).as_deref(), Some("gemini-3.1-pro"));
        assert_eq!(d(Task::Chat).as_deref(), Some("gemini-3.1-flash"));
        assert_eq!(d(Task::TextFixes).as_deref(), Some("gemini-3.1-flash-lite"));
        assert_eq!(d(Task::Handwriting).as_deref(), Some("gemini-3.1-flash"));
    }

    #[test]
    fn handwriting_default_needs_vision_on_local_models() {
        let r = Registry::bundled();
        let live: Vec<ModelInfo> = ["llama3.3", "qwen2.5vl:7b"]
            .iter()
            .map(|id| r.enrich(ProviderKind::Ollama, info(id, false)))
            .collect();
        assert!(!live[0].vision && live[1].vision);
        assert_eq!(
            r.default_model(ProviderKind::Ollama, Task::Handwriting, &live)
                .as_deref(),
            Some("qwen2.5vl:7b")
        );
        assert_eq!(
            r.default_model(ProviderKind::Ollama, Task::Chat, &live)
                .as_deref(),
            Some("llama3.3")
        );
    }

    #[test]
    fn user_file_overrides_and_extends() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("ai-models.json");
        std::fs::write(
            &p,
            r#"{"providers":{"openai":{"defaults":{"chat":"gpt-6-luna"},"models":[{"id":"gpt-7","vision":true}]}}}"#,
        )
        .unwrap();
        let r = Registry::load(Some(&p));
        assert_eq!(
            r.default_model(ProviderKind::OpenAi, Task::Chat, &[])
                .as_deref(),
            Some("gpt-6-luna")
        );
        assert_eq!(
            r.spec(ProviderKind::OpenAi, "gpt-7").unwrap().vision,
            Some(true)
        );
        assert!(r.spec(ProviderKind::OpenAi, "gpt-6-sol").is_some());
        std::fs::write(&p, "{broken").unwrap();
        assert!(Registry::load(Some(&p))
            .spec(ProviderKind::OpenAi, "gpt-7")
            .is_none());
    }

    #[test]
    fn estimates_cost_from_prices() {
        let r = Registry::bundled();
        let c = r
            .cost(ProviderKind::OpenAi, "gpt-6-sol", 1_000_000, 100_000)
            .unwrap();
        assert!((c - 3.0).abs() < 1e-9);
        assert!(r
            .cost(ProviderKind::Anthropic, "claude-sonnet-5", 1, 1)
            .is_none());
    }
}
