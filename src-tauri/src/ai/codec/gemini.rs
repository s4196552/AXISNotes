//! Google Gemini API (`models/{model}:generateContent`). The key goes in the
//! `x-goog-api-key` header, never in the URL.

use serde_json::{json, Value};

use super::{error_message, join_url, u32_at, Codec, Flags, StreamAcc};
use crate::ai::sse::Event;
use crate::ai::transport::HttpRequest;
use crate::ai::{AiError, Completion, Effort, ModelInfo, Part, Request, Role, Usage};

pub struct Gemini;

fn model_path(model: &str) -> String {
    let id = model.strip_prefix("models/").unwrap_or(model);
    format!("models/{id}")
}

fn with_key(http: HttpRequest, key: Option<&str>) -> HttpRequest {
    match key {
        Some(k) => http.header("x-goog-api-key", k),
        None => http,
    }
}

fn usage(v: &Value) -> Option<Usage> {
    let u = v.get("usageMetadata")?;
    Some(Usage {
        input_tokens: u32_at(u, "promptTokenCount"),
        output_tokens: u32_at(u, "candidatesTokenCount"),
    })
}

/// Visible text of the first candidate (thought summaries are skipped).
fn candidate_text(v: &Value) -> String {
    v.pointer("/candidates/0/content/parts")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter(|p| p.get("thought").and_then(Value::as_bool) != Some(true))
        .filter_map(|p| p.get("text").and_then(Value::as_str))
        .collect()
}

fn blocked(v: &Value) -> Option<String> {
    let reason = v.pointer("/promptFeedback/blockReason")?.as_str()?;
    Some(format!("prompt blocked by Gemini ({reason})"))
}

impl Codec for Gemini {
    fn request(
        &self,
        base: &str,
        key: Option<&str>,
        req: &Request,
        stream: bool,
        _flags: Flags,
    ) -> HttpRequest {
        let parts = |content: &[Part]| -> Vec<Value> {
            content
                .iter()
                .map(|p| match p {
                    Part::Text { text } => json!({ "text": text }),
                    Part::Image { mime, data } => {
                        json!({ "inline_data": { "mime_type": mime, "data": data } })
                    }
                })
                .collect()
        };
        let contents: Vec<Value> = req
            .messages
            .iter()
            .filter(|m| m.role != Role::System)
            .map(|m| {
                let role = if m.role == Role::Assistant {
                    "model"
                } else {
                    "user"
                };
                json!({ "role": role, "parts": parts(&m.content) })
            })
            .collect();
        let system: Vec<Value> = req
            .messages
            .iter()
            .filter(|m| m.role == Role::System)
            .flat_map(|m| parts(&m.content))
            .collect();
        let mut config = json!({});
        if let Some(n) = req.max_output_tokens {
            config["maxOutputTokens"] = json!(n);
        }
        if let Some(t) = req.temperature {
            config["temperature"] = json!(t);
        }
        if req.json {
            config["responseMimeType"] = json!("application/json");
        }
        if let Some(e) = req.effort {
            let budget: i64 = match e {
                Effort::Quick => 0,
                Effort::Balanced => -1, // dynamic
                Effort::Deep => 16_384,
            };
            config["thinkingConfig"] = json!({ "thinkingBudget": budget });
        }
        let mut body = json!({ "contents": contents });
        if !system.is_empty() {
            body["systemInstruction"] = json!({ "parts": system });
        }
        if config.as_object().is_some_and(|c| !c.is_empty()) {
            body["generationConfig"] = config;
        }
        let action = if stream {
            ":streamGenerateContent?alt=sse"
        } else {
            ":generateContent"
        };
        let url = join_url(base, &format!("{}{action}", model_path(&req.model)));
        with_key(HttpRequest::post(url, body), key)
    }

    fn parse(&self, body: &Value) -> Result<Completion, AiError> {
        if let Some(msg) = error_message(body).or_else(|| blocked(body)) {
            return Err(AiError::Protocol(msg));
        }
        Ok(Completion {
            text: candidate_text(body),
            model: body
                .get("modelVersion")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string(),
            usage: usage(body),
        })
    }

    fn event(&self, ev: &Event, acc: &mut StreamAcc) -> Result<Option<String>, AiError> {
        let data: Value = serde_json::from_str(&ev.data)
            .map_err(|e| AiError::Protocol(format!("bad stream event: {e}")))?;
        if let Some(msg) = error_message(&data).or_else(|| blocked(&data)) {
            return Err(AiError::Protocol(msg));
        }
        if let Some(m) = data.get("modelVersion").and_then(Value::as_str) {
            acc.model = m.to_string();
        }
        if let Some(u) = usage(&data) {
            acc.usage = Some(u);
        }
        if data.pointer("/candidates/0/finishReason").is_some() {
            acc.done = true;
        }
        let t = candidate_text(&data);
        if t.is_empty() {
            return Ok(None);
        }
        acc.text.push_str(&t);
        Ok(Some(t))
    }

    fn models_request(&self, base: &str, key: Option<&str>) -> HttpRequest {
        with_key(
            HttpRequest::get(join_url(base, "models?pageSize=1000")),
            key,
        )
    }

    fn parse_models(&self, body: &Value) -> Vec<ModelInfo> {
        body.get("models")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter(|m| {
                m.get("supportedGenerationMethods")
                    .and_then(Value::as_array)
                    .is_some_and(|a| a.iter().any(|x| x == "generateContent"))
            })
            .filter_map(|m| {
                let full = m.get("name")?.as_str()?;
                let id = full.strip_prefix("models/").unwrap_or(full).to_string();
                let name = m
                    .get("displayName")
                    .and_then(Value::as_str)
                    .unwrap_or(&id)
                    .to_string();
                Some(ModelInfo {
                    vision: id.starts_with("gemini"),
                    json: true,
                    context: m
                        .get("inputTokenLimit")
                        .and_then(Value::as_u64)
                        .map(|n| n as u32),
                    id,
                    name,
                })
            })
            .collect()
    }
}
