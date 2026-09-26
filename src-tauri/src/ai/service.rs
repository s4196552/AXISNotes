//! Runs AI requests for the app: resolves which provider and model to use (task
//! defaults, then the fallback order), enforces the vault's AI privacy rules and the
//! token cap, streams the answer, and logs metadata.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;

use serde::{Deserialize, Serialize};

use super::adapter::Adapter;
use super::keys::KeyStore;
use super::log::{self, LogEntry};
use super::privacy::{self, AiRule};
use super::registry::{Registry, Task};
use super::settings::{AiSettings, ProviderConfig};
use super::transport::Transport;
use super::{
    estimate_tokens, is_local_url, AiError, AiProvider, Effort, Message, ModelInfo, Part, Request,
    Role, Usage,
};
use crate::error::{AppError, AppResult};
use crate::vault::Vault;

/// A request from the UI.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct RunRequest {
    pub task: Option<Task>,
    pub messages: Vec<Message>,
    /// Notes whose text the UI put into `messages` (for privacy rules).
    pub sources: Vec<String>,
    /// Notes Rust reads and attaches itself (always covered by privacy rules).
    pub attach: Vec<String>,
    /// Override the task's provider/model.
    pub provider: Option<String>,
    pub model: Option<String>,
    pub max_output_tokens: Option<u32>,
    pub temperature: Option<f32>,
    pub effort: Option<Effort>,
    pub json: bool,
}

impl RunRequest {
    fn task(&self) -> Task {
        self.task.unwrap_or(Task::Chat)
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderStatus {
    #[serde(flatten)]
    pub config: ProviderConfig,
    pub has_key: bool,
    pub requires_key: bool,
    pub local: bool,
    pub default_base_url: &'static str,
}

/// Where a request would go, shown before sending.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Plan {
    pub provider_id: String,
    pub provider_name: String,
    pub model: String,
    pub local: bool,
    pub estimated_input_tokens: u32,
    /// Above the "confirm" threshold: the UI should ask before sending.
    pub needs_confirm: bool,
    /// Estimated input cost in USD, when the model's price is known.
    pub estimated_cost: Option<f64>,
    pub rule: AiRule,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunResult {
    pub text: String,
    pub provider_id: String,
    pub provider_name: String,
    pub model: String,
    pub local: bool,
    pub usage: Option<Usage>,
    /// Set when the answer came from a fallback provider.
    pub fallback_from: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelList {
    pub models: Vec<ModelInfo>,
    /// Why the live list couldn't be fetched (the registry's list is returned instead).
    pub error: Option<String>,
}

#[derive(Clone)]
struct Candidate {
    cfg: ProviderConfig,
    model: String,
}

pub struct AiService {
    settings_path: PathBuf,
    log_path: PathBuf,
    registry: Arc<Registry>,
    keys: Arc<dyn KeyStore>,
    transport: Arc<dyn Transport>,
    settings: Mutex<AiSettings>,
}

fn is_local(cfg: &ProviderConfig) -> bool {
    let url = if cfg.base_url.trim().is_empty() {
        cfg.kind.default_base_url()
    } else {
        cfg.base_url.as_str()
    };
    !url.is_empty() && is_local_url(url)
}

fn has_images(messages: &[Message]) -> bool {
    messages
        .iter()
        .flat_map(|m| &m.content)
        .any(|p| matches!(p, Part::Image { .. }))
}

impl AiService {
    pub fn new(
        settings_path: PathBuf,
        log_path: PathBuf,
        registry: Arc<Registry>,
        keys: Arc<dyn KeyStore>,
        transport: Arc<dyn Transport>,
    ) -> Self {
        let settings = AiSettings::load(&settings_path);
        AiService {
            settings_path,
            log_path,
            registry,
            keys,
            transport,
            settings: Mutex::new(settings),
        }
    }

    pub fn settings(&self) -> AiSettings {
        self.settings.lock().unwrap().clone()
    }

    pub fn providers(&self) -> Vec<ProviderStatus> {
        self.settings()
            .providers
            .into_iter()
            .map(|cfg| ProviderStatus {
                has_key: self.keys.get(&cfg.id).ok().flatten().is_some(),
                requires_key: cfg.kind.requires_key(),
                local: is_local(&cfg),
                default_base_url: cfg.kind.default_base_url(),
                config: cfg,
            })
            .collect()
    }

    /// Replace the settings. Keys of providers that were removed are deleted too.
    pub fn save_settings(&self, mut next: AiSettings) -> AppResult<()> {
        let mut seen = std::collections::HashSet::new();
        for p in &next.providers {
            if p.id.trim().is_empty() || !seen.insert(p.id.clone()) {
                return Err(AppError::InvalidName(format!("provider id {:?}", p.id)));
            }
        }
        next.fallback.retain(|id| seen.contains(id));
        next.tasks.retain(|_, c| seen.contains(&c.provider));
        let removed: Vec<String> = self
            .settings()
            .providers
            .iter()
            .filter(|p| !seen.contains(&p.id))
            .map(|p| p.id.clone())
            .collect();
        next.save(&self.settings_path)?;
        *self.settings.lock().unwrap() = next;
        for id in removed {
            let _ = self.keys.delete(&id);
        }
        Ok(())
    }

    pub fn set_key(&self, provider_id: &str, key: &str) -> AppResult<()> {
        if self.settings().provider(provider_id).is_none() {
            return Err(AppError::NotFound(format!("provider {provider_id}")));
        }
        if key.trim().is_empty() {
            return self.keys.delete(provider_id);
        }
        self.keys.set(provider_id, key)
    }

    pub fn delete_key(&self, provider_id: &str) -> AppResult<()> {
        self.keys.delete(provider_id)
    }

    fn adapter(&self, cfg: &ProviderConfig) -> AppResult<Adapter> {
        let key = self.keys.get(&cfg.id)?;
        if cfg.kind.requires_key() && key.is_none() {
            return Err(AppError::Ai(format!("{} has no API key", cfg.name)));
        }
        if cfg.kind == super::ProviderKind::Custom && cfg.base_url.trim().is_empty() {
            return Err(AppError::Ai(format!("{} has no endpoint URL", cfg.name)));
        }
        Ok(Adapter::new(
            cfg.kind,
            Some(&cfg.base_url),
            key,
            self.transport.clone(),
            self.registry.clone(),
        ))
    }

    fn provider_cfg(&self, id: &str) -> AppResult<ProviderConfig> {
        self.settings()
            .provider(id)
            .cloned()
            .ok_or_else(|| AppError::NotFound(format!("provider {id}")))
    }

    /// Live model list (enriched with capabilities); the registry's list if it fails.
    pub async fn list_models(&self, provider_id: &str) -> AppResult<ModelList> {
        let cfg = self.provider_cfg(provider_id)?;
        let fallback = |e: String| ModelList {
            models: self.registry.listed(cfg.kind),
            error: Some(e),
        };
        let adapter = match self.adapter(&cfg) {
            Ok(a) => a,
            Err(e) => return Ok(fallback(e.to_string())),
        };
        Ok(match adapter.list_models().await {
            Ok(models) => ModelList {
                models,
                error: None,
            },
            Err(e) => fallback(e.to_string()),
        })
    }

    /// Check a provider's endpoint and key by listing its models.
    pub async fn test_provider(&self, provider_id: &str) -> AppResult<usize> {
        let cfg = self.provider_cfg(provider_id)?;
        let adapter = self.adapter(&cfg)?;
        adapter
            .list_models()
            .await
            .map(|m| m.len())
            .map_err(|e| AppError::Ai(format!("{}: {e}", cfg.name)))
    }

    async fn default_model(&self, cfg: &ProviderConfig, task: Task) -> Option<String> {
        if let Some(m) = self.registry.default_model(cfg.kind, task, &[]) {
            return Some(m);
        }
        let models = self.adapter(cfg).ok()?.list_models().await.ok()?;
        self.registry.default_model(cfg.kind, task, &models)
    }

    /// Providers/models to try in order, after privacy and capability filtering.
    async fn candidates(&self, req: &RunRequest, rule: AiRule) -> AppResult<Vec<Candidate>> {
        if rule == AiRule::Never {
            return Err(AppError::Blocked(
                "This request includes notes from a folder marked \"AI: never\"; it was not sent."
                    .into(),
            ));
        }
        let settings = self.settings();
        let task = req.task();
        let mut chain: Vec<(ProviderConfig, Option<String>)> = Vec::new();
        let push = |chain: &mut Vec<(ProviderConfig, Option<String>)>, cfg: ProviderConfig, m| {
            if cfg.enabled && !chain.iter().any(|(c, _)| c.id == cfg.id) {
                chain.push((cfg, m));
            }
        };
        if let Some(id) = &req.provider {
            push(&mut chain, self.provider_cfg(id)?, req.model.clone());
        } else if let Some(choice) = settings.task(task) {
            if let Some(cfg) = settings.provider(&choice.provider) {
                push(&mut chain, cfg.clone(), Some(choice.model.clone()));
            }
        }
        for id in &settings.fallback {
            if let Some(cfg) = settings.provider(id) {
                push(&mut chain, cfg.clone(), None);
            }
        }
        if chain.is_empty() {
            // Nothing configured for this task: any enabled provider, in list order.
            for cfg in &settings.providers {
                push(&mut chain, cfg.clone(), None);
            }
        }
        if chain.is_empty() {
            return Err(AppError::Ai(
                "No AI provider is set up. Add one in Settings → AI.".into(),
            ));
        }

        let needs_vision = has_images(&req.messages);
        let mut out = Vec::new();
        let mut skipped: Vec<String> = Vec::new();
        for (cfg, model) in chain {
            if rule == AiRule::Local && !is_local(&cfg) {
                skipped.push(format!("{} is not a local provider", cfg.name));
                continue;
            }
            if cfg.kind.requires_key() && self.keys.get(&cfg.id).ok().flatten().is_none() {
                skipped.push(format!("{} has no API key", cfg.name));
                continue;
            }
            let model = match model {
                Some(m) if !m.is_empty() => m,
                _ => match self.default_model(&cfg, task).await {
                    Some(m) => m,
                    None => {
                        skipped.push(format!("{} has no model for this task", cfg.name));
                        continue;
                    }
                },
            };
            if needs_vision {
                let info = self.registry.enrich(
                    cfg.kind,
                    ModelInfo {
                        id: model.clone(),
                        name: model.clone(),
                        vision: false,
                        json: false,
                        context: None,
                    },
                );
                if !info.vision {
                    skipped.push(format!("{model} ({}) can't read images", cfg.name));
                    continue;
                }
            }
            out.push(Candidate { cfg, model });
        }
        if out.is_empty() {
            let why = skipped.join("; ");
            return Err(if rule == AiRule::Local {
                AppError::Blocked(format!(
                    "These notes are marked \"AI: local models only\", and no local provider \
                     (Ollama, LM Studio or a localhost endpoint) is available: {why}."
                ))
            } else {
                AppError::Ai(format!("No provider can take this request: {why}."))
            });
        }
        Ok(out)
    }

    /// Read attached notes (Rust-side, so they are always subject to the rules).
    fn expand(&self, vault: Option<&Vault>, req: &RunRequest) -> AppResult<Vec<Message>> {
        let mut messages = req.messages.clone();
        if req.attach.is_empty() {
            return Ok(messages);
        }
        let vault = vault.ok_or(AppError::NoVault)?;
        let mut parts = Vec::new();
        for path in &req.attach {
            let file = vault.read_file(path)?;
            parts.push(Part::Text {
                text: format!("<note path=\"{path}\">\n{}\n</note>", file.content),
            });
        }
        // Context goes before the user's last message.
        let at = messages
            .iter()
            .rposition(|m| m.role == Role::User)
            .unwrap_or(messages.len());
        messages.insert(
            at,
            Message {
                role: Role::User,
                content: parts,
            },
        );
        Ok(messages)
    }

    fn rule(&self, vault: Option<&Vault>, req: &RunRequest) -> AiRule {
        let Some(vault) = vault else {
            return AiRule::Any;
        };
        let rules = privacy::rules(vault);
        privacy::strictest(&rules, req.sources.iter().chain(&req.attach))
    }

    pub async fn plan(&self, vault: Option<&Vault>, req: &RunRequest) -> AppResult<Plan> {
        let rule = self.rule(vault, req);
        let messages = self.expand(vault, req)?;
        let tokens = estimate_tokens(&messages);
        let first = self.candidates(req, rule).await?.remove(0);
        let settings = self.settings();
        Ok(Plan {
            local: is_local(&first.cfg),
            estimated_cost: self.registry.cost(first.cfg.kind, &first.model, tokens, 0),
            provider_id: first.cfg.id,
            provider_name: first.cfg.name,
            model: first.model,
            estimated_input_tokens: tokens,
            needs_confirm: tokens > settings.confirm_above_tokens,
            rule,
        })
    }

    fn log(&self, entry: LogEntry) {
        if self.settings().log_requests {
            log::append(&self.log_path, &entry);
        }
    }

    pub fn read_log(&self, limit: usize) -> Vec<LogEntry> {
        log::read(&self.log_path, limit)
    }

    /// Run a request, streaming text deltas to `on_delta`. `cancel` stops it.
    pub async fn run(
        &self,
        vault: Option<&Vault>,
        req: RunRequest,
        cancel: Arc<AtomicBool>,
        on_delta: &mut (dyn FnMut(&str) + Send),
    ) -> AppResult<RunResult> {
        let task = req.task();
        let rule = self.rule(vault, &req);
        let sources = req.sources.len() + req.attach.len();
        let messages = self.expand(vault, &req)?;
        let estimate = estimate_tokens(&messages);
        let blocked = |provider: &str, model: &str, why: &str| LogEntry {
            time: log::now_ms(),
            task,
            provider: provider.into(),
            model: model.into(),
            local: false,
            status: "blocked".into(),
            error: Some(why.chars().take(200).collect()),
            estimated_input_tokens: estimate,
            input_tokens: None,
            output_tokens: None,
            duration_ms: 0,
            sources,
        };
        if let Some(cap) = self.settings().max_input_tokens {
            if estimate > cap {
                let why = format!(
                    "This request is about {estimate} input tokens, over your limit of {cap}."
                );
                self.log(blocked("", "", &why));
                return Err(AppError::Blocked(why));
            }
        }
        let candidates = match self.candidates(&req, rule).await {
            Ok(c) => c,
            Err(e) => {
                if matches!(e, AppError::Blocked(_)) {
                    self.log(blocked("", "", &e.to_string()));
                }
                return Err(e);
            }
        };

        let mut last_error: Option<String> = None;
        let mut first_provider: Option<String> = None;
        for cand in candidates {
            if cancel.load(Ordering::Relaxed) {
                return Err(AppError::Cancelled);
            }
            let adapter = self.adapter(&cand.cfg)?;
            let request = Request {
                model: cand.model.clone(),
                messages: messages.clone(),
                max_output_tokens: req.max_output_tokens,
                temperature: req.temperature,
                effort: req.effort,
                json: req.json,
            };
            let started = Instant::now();
            let mut emitted = false;
            let mut forward = |d: &str| -> bool {
                if cancel.load(Ordering::Relaxed) {
                    return false;
                }
                emitted = true;
                on_delta(d);
                true
            };
            let result = adapter.stream(&request, &mut forward).await;
            let local = is_local(&cand.cfg);
            let mut entry = LogEntry {
                time: log::now_ms(),
                task,
                provider: cand.cfg.id.clone(),
                model: cand.model.clone(),
                local,
                status: "ok".into(),
                error: None,
                estimated_input_tokens: estimate,
                input_tokens: None,
                output_tokens: None,
                duration_ms: started.elapsed().as_millis() as u64,
                sources,
            };
            match result {
                Ok(c) => {
                    entry.input_tokens = c.usage.as_ref().map(|u| u.input_tokens);
                    entry.output_tokens = c.usage.as_ref().map(|u| u.output_tokens);
                    self.log(entry);
                    return Ok(RunResult {
                        text: c.text,
                        provider_id: cand.cfg.id,
                        provider_name: cand.cfg.name,
                        model: if c.model.is_empty() {
                            cand.model
                        } else {
                            c.model
                        },
                        local,
                        usage: c.usage,
                        fallback_from: first_provider,
                    });
                }
                Err(AiError::Cancelled) => {
                    entry.status = "cancelled".into();
                    self.log(entry);
                    return Err(AppError::Cancelled);
                }
                Err(e) => {
                    entry.status = "error".into();
                    entry.error = Some(e.to_string().chars().take(200).collect());
                    self.log(entry);
                    let msg = format!("{} ({}): {e}", cand.cfg.name, cand.model);
                    if emitted || !e.retryable_elsewhere() {
                        return Err(AppError::Ai(msg));
                    }
                    first_provider.get_or_insert(cand.cfg.name.clone());
                    last_error = Some(msg);
                }
            }
        }
        Err(AppError::Ai(
            last_error.unwrap_or_else(|| "no provider answered".into()),
        ))
    }
}

/// Cancellation flags for running requests, by run id.
#[derive(Default)]
pub struct Runs(Mutex<HashMap<String, Arc<AtomicBool>>>);

impl Runs {
    pub fn start(&self, id: &str) -> Arc<AtomicBool> {
        let flag = Arc::new(AtomicBool::new(false));
        self.0.lock().unwrap().insert(id.to_string(), flag.clone());
        flag
    }

    pub fn cancel(&self, id: &str) {
        if let Some(f) = self.0.lock().unwrap().get(id) {
            f.store(true, Ordering::Relaxed);
        }
    }

    pub fn finish(&self, id: &str) {
        self.0.lock().unwrap().remove(id);
    }
}

#[cfg(test)]
mod tests;
