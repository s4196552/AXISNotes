//! Multi-provider AI layer. One `AiProvider` trait; one codec per API format (OpenAI
//! Responses, OpenAI-compatible Chat Completions, Anthropic Messages, Gemini); one
//! generic `Adapter` that drives a codec over a `Transport` (real HTTP, or recorded
//! fixtures in tests). API keys live in the OS keychain and never reach the webview.

pub mod adapter;
pub mod codec;
pub mod keys;
pub mod log;
pub mod privacy;
pub mod registry;
pub mod service;
pub mod settings;
pub mod sse;
pub mod transport;

use std::future::Future;
use std::pin::Pin;

use serde::{Deserialize, Serialize};

pub type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

/// The provider products AXISNotes knows. Everything except OpenAI, Anthropic and Gemini
/// speaks the OpenAI-compatible Chat Completions format.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ProviderKind {
    OpenAi,
    Anthropic,
    Gemini,
    OpenRouter,
    Ollama,
    LmStudio,
    /// Any OpenAI-compatible endpoint (Mistral, Groq, DeepSeek, Azure OpenAI, ...).
    Custom,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ApiFormat {
    OpenAiResponses,
    OpenAiChat,
    Anthropic,
    Gemini,
}

impl ProviderKind {
    pub fn format(self) -> ApiFormat {
        match self {
            ProviderKind::OpenAi => ApiFormat::OpenAiResponses,
            ProviderKind::Anthropic => ApiFormat::Anthropic,
            ProviderKind::Gemini => ApiFormat::Gemini,
            _ => ApiFormat::OpenAiChat,
        }
    }

    pub fn default_base_url(self) -> &'static str {
        match self {
            ProviderKind::OpenAi => "https://api.openai.com/v1",
            ProviderKind::Anthropic => "https://api.anthropic.com/v1",
            ProviderKind::Gemini => "https://generativelanguage.googleapis.com/v1beta",
            ProviderKind::OpenRouter => "https://openrouter.ai/api/v1",
            ProviderKind::Ollama => "http://localhost:11434/v1",
            ProviderKind::LmStudio => "http://localhost:1234/v1",
            ProviderKind::Custom => "",
        }
    }

    /// Whether the provider needs an API key (custom endpoints may or may not).
    pub fn requires_key(self) -> bool {
        matches!(
            self,
            ProviderKind::OpenAi
                | ProviderKind::Anthropic
                | ProviderKind::Gemini
                | ProviderKind::OpenRouter
        )
    }
}

/// True if `base_url` points at this machine (so data never leaves it).
pub fn is_local_url(base_url: &str) -> bool {
    let rest = base_url
        .split_once("://")
        .map_or(base_url, |(_, r)| r)
        .to_ascii_lowercase();
    let host = rest.split(['/', '?']).next().unwrap_or("");
    let host = if let Some(h) = host.strip_prefix('[') {
        h.split(']').next().unwrap_or("")
    } else {
        host.rsplit_once(':').map_or(host, |(h, port)| {
            if port.chars().all(|c| c.is_ascii_digit()) {
                h
            } else {
                host
            }
        })
    };
    host == "localhost" || host.ends_with(".localhost") || host == "::1" || host.starts_with("127.")
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    System,
    User,
    Assistant,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Part {
    Text {
        text: String,
    },
    /// Base64 image data (PNG/JPEG/WebP), no `data:` prefix.
    Image {
        mime: String,
        data: String,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Message {
    pub role: Role,
    pub content: Vec<Part>,
}

impl Message {
    #[allow(dead_code)] // tests and Phase 5 features
    pub fn text(role: Role, text: impl Into<String>) -> Self {
        Message {
            role,
            content: vec![Part::Text { text: text.into() }],
        }
    }
}

/// "Quick / Balanced / Deep" in the UI; mapped to each API's reasoning setting.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Effort {
    Quick,
    Balanced,
    Deep,
}

impl Effort {
    pub fn openai(self) -> &'static str {
        match self {
            Effort::Quick => "low",
            Effort::Balanced => "medium",
            Effort::Deep => "high",
        }
    }
}

/// A provider-independent request.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Request {
    pub model: String,
    pub messages: Vec<Message>,
    #[serde(default)]
    pub max_output_tokens: Option<u32>,
    #[serde(default)]
    pub temperature: Option<f32>,
    #[serde(default)]
    pub effort: Option<Effort>,
    /// Ask for a JSON object as the answer.
    #[serde(default)]
    pub json: bool,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Usage {
    pub input_tokens: u32,
    pub output_tokens: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Completion {
    pub text: String,
    pub model: String,
    pub usage: Option<Usage>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelInfo {
    pub id: String,
    pub name: String,
    pub vision: bool,
    pub json: bool,
    pub context: Option<u32>,
}

/// Why a provider call failed; decides retries and fallbacks.
#[derive(Debug, Clone, PartialEq)]
pub enum AiError {
    /// Missing or rejected API key (401/403).
    Auth(String),
    /// The request itself was rejected (400/404/422); `param` names an unsupported
    /// parameter when the provider said so.
    Invalid {
        message: String,
        param: Option<String>,
    },
    /// Rate limit (429).
    RateLimited(String),
    /// Network failure, timeout or 5xx: worth trying another provider.
    Unavailable(String),
    /// The response couldn't be understood.
    Protocol(String),
    Cancelled,
}

impl AiError {
    /// Whether falling back to another provider could help.
    pub fn retryable_elsewhere(&self) -> bool {
        matches!(
            self,
            AiError::Unavailable(_) | AiError::RateLimited(_) | AiError::Auth(_)
        )
    }
}

impl std::fmt::Display for AiError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AiError::Auth(m) => write!(f, "authentication failed: {m}"),
            AiError::Invalid { message, .. } => write!(f, "request rejected: {message}"),
            AiError::RateLimited(m) => write!(f, "rate limited: {m}"),
            AiError::Unavailable(m) => write!(f, "provider unavailable: {m}"),
            AiError::Protocol(m) => write!(f, "unexpected response: {m}"),
            AiError::Cancelled => write!(f, "cancelled"),
        }
    }
}

pub type AiResult<T> = Result<T, AiError>;

/// One AI backend. `stream` reports text deltas as they arrive and returns the full
/// completion; `vision` is `complete` with an image attached.
///
/// The app streams everything today (so requests can be cancelled); `complete` and
/// `vision` are part of the provider contract, covered by the fixture tests.
#[allow(dead_code)]
pub trait AiProvider: Send + Sync {
    fn complete<'a>(&'a self, req: &'a Request) -> BoxFuture<'a, AiResult<Completion>>;

    fn stream<'a>(
        &'a self,
        req: &'a Request,
        on_delta: &'a mut (dyn FnMut(&str) -> bool + Send),
    ) -> BoxFuture<'a, AiResult<Completion>>;

    fn list_models(&self) -> BoxFuture<'_, AiResult<Vec<ModelInfo>>>;

    fn vision<'a>(
        &'a self,
        model: &'a str,
        prompt: &'a str,
        image_mime: &'a str,
        image_base64: &'a str,
    ) -> BoxFuture<'a, AiResult<Completion>> {
        Box::pin(async move {
            let req = Request {
                model: model.to_string(),
                messages: vec![Message {
                    role: Role::User,
                    content: vec![
                        Part::Image {
                            mime: image_mime.to_string(),
                            data: image_base64.to_string(),
                        },
                        Part::Text {
                            text: prompt.to_string(),
                        },
                    ],
                }],
                ..Request::default()
            };
            self.complete(&req).await
        })
    }
}

/// Rough token estimate (≈4 characters per token for text; images at a flat rate),
/// shown before large requests and checked against the per-request cap.
pub fn estimate_tokens(messages: &[Message]) -> u32 {
    let mut chars = 0usize;
    let mut images = 0u32;
    for m in messages {
        for p in &m.content {
            match p {
                Part::Text { text } => chars += text.chars().count(),
                Part::Image { .. } => images += 1,
            }
        }
    }
    (chars as u32).div_ceil(4) + images * 1000
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognizes_local_endpoints() {
        for url in [
            "http://localhost:11434/v1",
            "http://127.0.0.1:1234/v1",
            "http://[::1]:8080",
            "http://ollama.localhost/v1",
        ] {
            assert!(is_local_url(url), "{url}");
        }
        for url in [
            "https://api.openai.com/v1",
            "http://localhost.evil.com/v1",
            "http://192.168.1.10:11434/v1",
        ] {
            assert!(!is_local_url(url), "{url}");
        }
    }

    #[test]
    fn estimates_tokens() {
        let m = vec![Message::text(Role::User, "a".repeat(400))];
        assert_eq!(estimate_tokens(&m), 100);
    }
}
