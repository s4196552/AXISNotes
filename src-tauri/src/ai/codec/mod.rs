//! Request building and response parsing for each API format. Codecs are pure: they
//! turn a `Request` into an `HttpRequest` and bytes back into completions, so they are
//! tested against recorded provider responses.

mod anthropic;
mod gemini;
mod openai_chat;
mod openai_responses;

use serde_json::Value;

use super::sse::Event;
use super::transport::HttpRequest;
use super::{AiError, ApiFormat, Completion, ModelInfo, Request, Usage};

/// Adapter-level switches that can be turned off after a provider rejects them.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Flags {
    /// Don't send `stream_options` (some OpenAI-compatible servers reject it).
    pub no_stream_options: bool,
}

/// State accumulated while reading a stream.
#[derive(Debug, Default)]
pub struct StreamAcc {
    pub text: String,
    pub model: String,
    pub usage: Option<Usage>,
    pub done: bool,
}

impl StreamAcc {
    pub fn into_completion(self, requested_model: &str) -> Completion {
        Completion {
            text: self.text,
            model: if self.model.is_empty() {
                requested_model.to_string()
            } else {
                self.model
            },
            usage: self.usage,
        }
    }
}

#[allow(dead_code)] // `parse` serves the non-streaming `complete`
pub trait Codec: Send + Sync {
    fn request(
        &self,
        base: &str,
        key: Option<&str>,
        req: &Request,
        stream: bool,
        flags: Flags,
    ) -> HttpRequest;
    fn parse(&self, body: &Value) -> Result<Completion, AiError>;
    /// Handle one stream event; returns a text delta, if any.
    fn event(&self, ev: &Event, acc: &mut StreamAcc) -> Result<Option<String>, AiError>;
    fn models_request(&self, base: &str, key: Option<&str>) -> HttpRequest;
    /// Model ids and names (capabilities are filled in from the registry).
    fn parse_models(&self, body: &Value) -> Vec<ModelInfo>;
}

pub fn codec_for(format: ApiFormat) -> &'static dyn Codec {
    match format {
        ApiFormat::OpenAiResponses => &openai_responses::OpenAiResponses,
        ApiFormat::OpenAiChat => &openai_chat::OpenAiChat,
        ApiFormat::Anthropic => &anthropic::Anthropic,
        ApiFormat::Gemini => &gemini::Gemini,
    }
}

pub(crate) fn join_url(base: &str, path: &str) -> String {
    format!(
        "{}/{}",
        base.trim_end_matches('/'),
        path.trim_start_matches('/')
    )
}

pub(crate) fn data_url(mime: &str, data: &str) -> String {
    format!("data:{mime};base64,{data}")
}

pub(crate) fn u32_at(v: &Value, key: &str) -> u32 {
    v.get(key).and_then(Value::as_u64).unwrap_or(0) as u32
}

/// Parameters a provider may reject for some models; mentioned in its error message.
const KNOWN_PARAMS: &[&str] = &[
    "stream_options",
    "reasoning_effort",
    "reasoning",
    "thinkingConfig",
    "thinking_config",
    "thinking",
    "temperature",
    "top_p",
    "response_format",
    "responseMimeType",
    "text.format",
];

fn error_message(body: &Value) -> Option<String> {
    let e = body.get("error")?;
    e.get("message")
        .and_then(Value::as_str)
        .map(String::from)
        .or_else(|| e.as_str().map(String::from))
}

/// Map an HTTP error response to an `AiError`.
pub fn error_from(status: u16, body: &[u8]) -> AiError {
    let json: Value = serde_json::from_slice(body).unwrap_or(Value::Null);
    let message = error_message(&json).unwrap_or_else(|| {
        let text = String::from_utf8_lossy(body);
        let text = text.trim();
        if text.is_empty() {
            format!("HTTP {status}")
        } else {
            text.chars().take(300).collect()
        }
    });
    match status {
        401 | 403 => AiError::Auth(message),
        429 => AiError::RateLimited(message),
        400 | 404 | 409 | 413 | 422 => {
            let param = json
                .pointer("/error/param")
                .and_then(Value::as_str)
                .map(String::from)
                .or_else(|| {
                    KNOWN_PARAMS
                        .iter()
                        .find(|p| message.contains(*p))
                        .map(|p| p.to_string())
                });
            AiError::Invalid { message, param }
        }
        s if s >= 500 => AiError::Unavailable(message),
        _ => AiError::Protocol(message),
    }
}

/// Turn off whatever the provider rejected; false if there was nothing to drop.
pub fn drop_param(param: &str, req: &mut Request, flags: &mut Flags) -> bool {
    let p = param.to_ascii_lowercase();
    if p.contains("stream_options") {
        let changed = !flags.no_stream_options;
        flags.no_stream_options = true;
        changed
    } else if p.contains("temperature") || p.contains("top_p") {
        req.temperature.take().is_some()
    } else if p.contains("reasoning") || p.contains("thinking") || p.contains("effort") {
        req.effort.take().is_some()
    } else if p.contains("response_format") || p.contains("mimetype") || p.contains("format") {
        std::mem::replace(&mut req.json, false)
    } else {
        false
    }
}

#[cfg(test)]
mod tests;
