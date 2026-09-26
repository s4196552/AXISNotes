//! OpenAI Responses API (`POST /responses`). Used for OpenAI itself; the Assistants API
//! is gone and Chat Completions is kept only for third-party compatible endpoints.

use serde_json::{json, Value};

use super::{data_url, error_message, join_url, u32_at, Codec, Flags, StreamAcc};
use crate::ai::sse::Event;
use crate::ai::transport::HttpRequest;
use crate::ai::{AiError, Completion, ModelInfo, Part, Request, Role, Usage};

pub struct OpenAiResponses;

fn input(req: &Request) -> Vec<Value> {
    req.messages
        .iter()
        .map(|m| {
            let role = match m.role {
                Role::System => "system",
                Role::User => "user",
                Role::Assistant => "assistant",
            };
            let content: Vec<Value> = m
                .content
                .iter()
                .map(|p| match (p, m.role) {
                    (Part::Text { text }, Role::Assistant) => {
                        json!({ "type": "output_text", "text": text })
                    }
                    (Part::Text { text }, _) => json!({ "type": "input_text", "text": text }),
                    (Part::Image { mime, data }, _) => {
                        json!({ "type": "input_image", "image_url": data_url(mime, data) })
                    }
                })
                .collect();
            json!({ "role": role, "content": content })
        })
        .collect()
}

fn usage(v: &Value) -> Option<Usage> {
    let u = v.get("usage")?;
    Some(Usage {
        input_tokens: u32_at(u, "input_tokens"),
        output_tokens: u32_at(u, "output_tokens"),
    })
}

#[allow(dead_code)] // used by `parse`
fn output_text(resp: &Value) -> String {
    let mut out = String::new();
    for item in resp
        .get("output")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        if item.get("type").and_then(Value::as_str) != Some("message") {
            continue; // reasoning summaries, tool calls
        }
        for c in item
            .get("content")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            if c.get("type").and_then(Value::as_str) == Some("output_text") {
                out.push_str(c.get("text").and_then(Value::as_str).unwrap_or(""));
            }
        }
    }
    out
}

impl Codec for OpenAiResponses {
    fn request(
        &self,
        base: &str,
        key: Option<&str>,
        req: &Request,
        stream: bool,
        _flags: Flags,
    ) -> HttpRequest {
        let mut body = json!({
            "model": req.model,
            "input": input(req),
            // Don't keep conversations on OpenAI's side.
            "store": false,
        });
        if let Some(n) = req.max_output_tokens {
            body["max_output_tokens"] = json!(n);
        }
        if let Some(t) = req.temperature {
            body["temperature"] = json!(t);
        }
        if let Some(e) = req.effort {
            body["reasoning"] = json!({ "effort": e.openai() });
        }
        if req.json {
            body["text"] = json!({ "format": { "type": "json_object" } });
        }
        if stream {
            body["stream"] = json!(true);
        }
        let mut http = HttpRequest::post(join_url(base, "responses"), body);
        if let Some(k) = key {
            http = http.header("Authorization", format!("Bearer {k}"));
        }
        http
    }

    fn parse(&self, body: &Value) -> Result<Completion, AiError> {
        if body.get("status").and_then(Value::as_str) == Some("failed") {
            let msg = body
                .pointer("/error/message")
                .and_then(Value::as_str)
                .unwrap_or("response failed");
            return Err(AiError::Protocol(msg.to_string()));
        }
        Ok(Completion {
            text: output_text(body),
            model: body
                .get("model")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string(),
            usage: usage(body),
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
            "response.output_text.delta" => {
                let d = data.get("delta").and_then(Value::as_str).unwrap_or("");
                acc.text.push_str(d);
                Ok(Some(d.to_string()))
            }
            "response.created" | "response.in_progress" => {
                if let Some(m) = data.pointer("/response/model").and_then(Value::as_str) {
                    acc.model = m.to_string();
                }
                Ok(None)
            }
            "response.completed" | "response.incomplete" => {
                let resp = data.get("response").unwrap_or(&Value::Null);
                acc.usage = usage(resp);
                if let Some(m) = resp.get("model").and_then(Value::as_str) {
                    acc.model = m.to_string();
                }
                acc.done = true;
                Ok(None)
            }
            "response.failed" => Err(AiError::Protocol(
                data.pointer("/response/error/message")
                    .and_then(Value::as_str)
                    .unwrap_or("response failed")
                    .to_string(),
            )),
            "error" => Err(AiError::Protocol(
                error_message(&json!({ "error": data }))
                    .or_else(|| {
                        data.get("message")
                            .and_then(Value::as_str)
                            .map(String::from)
                    })
                    .unwrap_or_else(|| "stream error".into()),
            )),
            _ => Ok(None),
        }
    }

    fn models_request(&self, base: &str, key: Option<&str>) -> HttpRequest {
        let mut http = HttpRequest::get(join_url(base, "models"));
        if let Some(k) = key {
            http = http.header("Authorization", format!("Bearer {k}"));
        }
        http
    }

    fn parse_models(&self, body: &Value) -> Vec<ModelInfo> {
        super::openai_chat::parse_model_list(body)
    }
}
