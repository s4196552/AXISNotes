//! OpenAI-compatible Chat Completions (`POST /chat/completions`): OpenRouter, Ollama,
//! LM Studio and custom endpoints (Mistral, Groq, DeepSeek, Azure OpenAI, ...).

use serde_json::{json, Value};

use super::{data_url, error_message, join_url, u32_at, Codec, Flags, StreamAcc};
use crate::ai::sse::Event;
use crate::ai::transport::HttpRequest;
use crate::ai::{AiError, Completion, ModelInfo, Part, Request, Role, Usage};

pub struct OpenAiChat;

fn messages(req: &Request) -> Vec<Value> {
    req.messages
        .iter()
        .map(|m| {
            let role = match m.role {
                Role::System => "system",
                Role::User => "user",
                Role::Assistant => "assistant",
            };
            let text_only = m.content.iter().all(|p| matches!(p, Part::Text { .. }));
            let content = if text_only {
                // Plain strings are the most widely supported form.
                Value::String(
                    m.content
                        .iter()
                        .map(|p| match p {
                            Part::Text { text } => text.as_str(),
                            Part::Image { .. } => "",
                        })
                        .collect::<Vec<_>>()
                        .join("\n"),
                )
            } else {
                Value::Array(
                    m.content
                        .iter()
                        .map(|p| match p {
                            Part::Text { text } => json!({ "type": "text", "text": text }),
                            Part::Image { mime, data } => json!({
                                "type": "image_url",
                                "image_url": { "url": data_url(mime, data) }
                            }),
                        })
                        .collect(),
                )
            };
            json!({ "role": role, "content": content })
        })
        .collect()
}

fn usage(v: &Value) -> Option<Usage> {
    let u = v.get("usage").filter(|u| u.is_object())?;
    Some(Usage {
        input_tokens: u32_at(u, "prompt_tokens"),
        output_tokens: u32_at(u, "completion_tokens"),
    })
}

/// `{ data: [{ id }] }`, shared with the Responses API's model list.
pub(super) fn parse_model_list(body: &Value) -> Vec<ModelInfo> {
    let mut out: Vec<ModelInfo> = body
        .get("data")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|m| {
            let id = m.get("id")?.as_str()?.to_string();
            let name = m
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or(&id)
                .to_string();
            let context = m
                .get("context_length")
                .and_then(Value::as_u64)
                .map(|n| n as u32);
            Some(ModelInfo {
                id,
                name,
                vision: false,
                json: false,
                context,
            })
        })
        .collect();
    out.sort_by(|a, b| a.id.cmp(&b.id));
    out
}

impl Codec for OpenAiChat {
    fn request(
        &self,
        base: &str,
        key: Option<&str>,
        req: &Request,
        stream: bool,
        flags: Flags,
    ) -> HttpRequest {
        let mut body = json!({ "model": req.model, "messages": messages(req) });
        if let Some(n) = req.max_output_tokens {
            body["max_tokens"] = json!(n);
        }
        if let Some(t) = req.temperature {
            body["temperature"] = json!(t);
        }
        if let Some(e) = req.effort {
            body["reasoning_effort"] = json!(e.openai());
        }
        if req.json {
            body["response_format"] = json!({ "type": "json_object" });
        }
        if stream {
            body["stream"] = json!(true);
            if !flags.no_stream_options {
                body["stream_options"] = json!({ "include_usage": true });
            }
        }
        let mut http = HttpRequest::post(join_url(base, "chat/completions"), body);
        if let Some(k) = key.filter(|k| !k.is_empty()) {
            http = http.header("Authorization", format!("Bearer {k}"));
        }
        http
    }

    fn parse(&self, body: &Value) -> Result<Completion, AiError> {
        if let Some(msg) = error_message(body) {
            return Err(AiError::Protocol(msg));
        }
        let choice = body
            .pointer("/choices/0/message")
            .ok_or_else(|| AiError::Protocol("no choices in response".into()))?;
        let text = match choice.get("content") {
            Some(Value::String(s)) => s.clone(),
            Some(Value::Array(parts)) => parts
                .iter()
                .filter_map(|p| p.get("text").and_then(Value::as_str))
                .collect(),
            _ => String::new(),
        };
        Ok(Completion {
            text,
            model: body
                .get("model")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string(),
            usage: usage(body),
        })
    }

    fn event(&self, ev: &Event, acc: &mut StreamAcc) -> Result<Option<String>, AiError> {
        if ev.data.trim() == "[DONE]" {
            acc.done = true;
            return Ok(None);
        }
        let data: Value = serde_json::from_str(&ev.data)
            .map_err(|e| AiError::Protocol(format!("bad stream event: {e}")))?;
        if let Some(msg) = error_message(&data) {
            return Err(AiError::Protocol(msg));
        }
        if let Some(m) = data.get("model").and_then(Value::as_str) {
            acc.model = m.to_string();
        }
        if let Some(u) = usage(&data) {
            acc.usage = Some(u);
        }
        let delta = data
            .pointer("/choices/0/delta/content")
            .and_then(Value::as_str)
            .unwrap_or("");
        if delta.is_empty() {
            return Ok(None);
        }
        acc.text.push_str(delta);
        Ok(Some(delta.to_string()))
    }

    fn models_request(&self, base: &str, key: Option<&str>) -> HttpRequest {
        let mut http = HttpRequest::get(join_url(base, "models"));
        if let Some(k) = key.filter(|k| !k.is_empty()) {
            http = http.header("Authorization", format!("Bearer {k}"));
        }
        http
    }

    fn parse_models(&self, body: &Value) -> Vec<ModelInfo> {
        parse_model_list(body)
    }
}
