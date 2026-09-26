//! Anthropic Messages API (`POST /messages`).

use serde_json::{json, Value};

use super::{error_message, join_url, u32_at, Codec, Flags, StreamAcc};
use crate::ai::sse::Event;
use crate::ai::transport::HttpRequest;
use crate::ai::{AiError, Completion, Effort, ModelInfo, Part, Request, Role, Usage};

pub struct Anthropic;

const VERSION: &str = "2023-06-01";
/// Anthropic requires `max_tokens`; used when the caller doesn't set one.
const DEFAULT_MAX_TOKENS: u32 = 4096;
const JSON_INSTRUCTION: &str = "Respond with a single valid JSON object and nothing else.";

fn thinking_budget(effort: Effort) -> Option<u32> {
    match effort {
        Effort::Quick => None,
        Effort::Balanced => Some(4_000),
        Effort::Deep => Some(16_000),
    }
}

fn with_headers(http: HttpRequest, key: Option<&str>) -> HttpRequest {
    let http = http.header("anthropic-version", VERSION);
    match key {
        Some(k) => http.header("x-api-key", k),
        None => http,
    }
}

impl Codec for Anthropic {
    fn request(
        &self,
        base: &str,
        key: Option<&str>,
        req: &Request,
        stream: bool,
        _flags: Flags,
    ) -> HttpRequest {
        let mut system: Vec<String> = req
            .messages
            .iter()
            .filter(|m| m.role == Role::System)
            .flat_map(|m| m.content.iter())
            .filter_map(|p| match p {
                Part::Text { text } => Some(text.clone()),
                Part::Image { .. } => None,
            })
            .collect();
        if req.json {
            system.push(JSON_INSTRUCTION.to_string());
        }
        let messages: Vec<Value> = req
            .messages
            .iter()
            .filter(|m| m.role != Role::System)
            .map(|m| {
                let content: Vec<Value> = m
                    .content
                    .iter()
                    .map(|p| match p {
                        Part::Text { text } => json!({ "type": "text", "text": text }),
                        Part::Image { mime, data } => json!({
                            "type": "image",
                            "source": { "type": "base64", "media_type": mime, "data": data }
                        }),
                    })
                    .collect();
                let role = if m.role == Role::Assistant {
                    "assistant"
                } else {
                    "user"
                };
                json!({ "role": role, "content": content })
            })
            .collect();
        let max = req.max_output_tokens.unwrap_or(DEFAULT_MAX_TOKENS);
        let mut body = json!({ "model": req.model, "messages": messages, "max_tokens": max });
        if !system.is_empty() {
            body["system"] = json!(system.join("\n\n"));
        }
        match req.effort.and_then(thinking_budget) {
            Some(budget) => {
                // Extended thinking: the budget counts toward max_tokens, and custom
                // temperature isn't allowed alongside it.
                body["thinking"] = json!({ "type": "enabled", "budget_tokens": budget });
                body["max_tokens"] = json!(max + budget);
            }
            None => {
                if let Some(t) = req.temperature {
                    body["temperature"] = json!(t);
                }
            }
        }
        if stream {
            body["stream"] = json!(true);
        }
        with_headers(HttpRequest::post(join_url(base, "messages"), body), key)
    }

    fn parse(&self, body: &Value) -> Result<Completion, AiError> {
        if let Some(msg) = error_message(body) {
            return Err(AiError::Protocol(msg));
        }
        let text: String = body
            .get("content")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter(|b| b.get("type").and_then(Value::as_str) == Some("text"))
            .filter_map(|b| b.get("text").and_then(Value::as_str))
            .collect();
        let usage = body.get("usage").map(|u| Usage {
            input_tokens: u32_at(u, "input_tokens"),
            output_tokens: u32_at(u, "output_tokens"),
        });
        Ok(Completion {
            text,
            model: body
                .get("model")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string(),
            usage,
        })
    }

    fn event(&self, ev: &Event, acc: &mut StreamAcc) -> Result<Option<String>, AiError> {
        let data: Value = serde_json::from_str(&ev.data)
            .map_err(|e| AiError::Protocol(format!("bad stream event: {e}")))?;
        let kind = ev
            .event
            .as_deref()
            .or_else(|| data.get("type").and_then(Value::as_str))
            .unwrap_or("");
        match kind {
            "message_start" => {
                let msg = data.get("message").unwrap_or(&Value::Null);
                if let Some(m) = msg.get("model").and_then(Value::as_str) {
                    acc.model = m.to_string();
                }
                if let Some(u) = msg.get("usage") {
                    acc.usage = Some(Usage {
                        input_tokens: u32_at(u, "input_tokens"),
                        output_tokens: u32_at(u, "output_tokens"),
                    });
                }
                Ok(None)
            }
            "content_block_delta" => {
                let delta = data.get("delta").unwrap_or(&Value::Null);
                if delta.get("type").and_then(Value::as_str) != Some("text_delta") {
                    return Ok(None); // thinking deltas stay private
                }
                let t = delta.get("text").and_then(Value::as_str).unwrap_or("");
                acc.text.push_str(t);
                Ok(Some(t.to_string()))
            }
            "message_delta" => {
                if let Some(out) = data.pointer("/usage/output_tokens").and_then(Value::as_u64) {
                    acc.usage.get_or_insert_with(Usage::default).output_tokens = out as u32;
                }
                Ok(None)
            }
            "message_stop" => {
                acc.done = true;
                Ok(None)
            }
            "error" => Err(AiError::Protocol(
                error_message(&data).unwrap_or_else(|| "stream error".into()),
            )),
            _ => Ok(None),
        }
    }

    fn models_request(&self, base: &str, key: Option<&str>) -> HttpRequest {
        with_headers(HttpRequest::get(join_url(base, "models?limit=1000")), key)
    }

    fn parse_models(&self, body: &Value) -> Vec<ModelInfo> {
        body.get("data")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(|m| {
                let id = m.get("id")?.as_str()?.to_string();
                let name = m
                    .get("display_name")
                    .and_then(Value::as_str)
                    .unwrap_or(&id)
                    .to_string();
                Some(ModelInfo {
                    id,
                    name,
                    vision: true, // every current Claude model accepts images
                    json: true,
                    context: None,
                })
            })
            .collect()
    }
}
