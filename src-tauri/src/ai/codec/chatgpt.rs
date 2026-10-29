//! Official ChatGPT plan Responses contract, separate from API-key billing.
use super::{openai_responses::OpenAiResponses, Codec, Flags, StreamAcc};
use crate::ai::sse::Event;
use crate::ai::transport::HttpRequest;
use crate::ai::{AiError, Completion, ModelInfo, Request};
use serde_json::Value;
pub struct ChatGptResponses;
impl Codec for ChatGptResponses {
    fn request(
        &self,
        _base: &str,
        key: Option<&str>,
        req: &Request,
        _stream: bool,
        flags: Flags,
    ) -> HttpRequest {
        let mut http = OpenAiResponses.request("https://api.openai.com/v1", key, req, true, flags);
        let body = http.body.as_mut().unwrap();
        body.as_object_mut().unwrap().remove("max_output_tokens");
        body.as_object_mut().unwrap().remove("temperature");
        for item in body["input"].as_array_mut().unwrap() {
            if item["role"] == "system" {
                item["role"] = Value::from("developer");
            }
        }
        http
    }
    fn parse(&self, body: &Value) -> Result<Completion, AiError> {
        OpenAiResponses.parse(body)
    }
    fn event(&self, ev: &Event, acc: &mut StreamAcc) -> Result<Option<String>, AiError> {
        let data: Value = serde_json::from_str(&ev.data)
            .map_err(|_| AiError::Protocol("Invalid ChatGPT stream event".into()))?;
        let kind = ev
            .event
            .as_deref()
            .or_else(|| data["type"].as_str())
            .unwrap_or("");
        if matches!(kind, "response.failed" | "response.incomplete" | "error") {
            let code = data
                .pointer("/response/error/code")
                .or_else(|| data.get("code"))
                .and_then(Value::as_str)
                .unwrap_or("");
            let message = if code.starts_with("subscription_sharing_usage_") {
                "ChatGPT plan limit reached or usage unavailable. Manage usage in ChatGPT or try again later. No API-key fallback was used."
            } else if kind == "response.incomplete" {
                "ChatGPT did not complete this response. Try again."
            } else {
                "ChatGPT could not complete this request. Check your plan access in ChatGPT settings. No API-key fallback was used."
            };
            return Err(AiError::Protocol(message.into()));
        }
        OpenAiResponses.event(ev, acc)
    }
    fn models_request(&self, _base: &str, key: Option<&str>) -> HttpRequest {
        OpenAiResponses.models_request("https://api.openai.com/v1", key)
    }
    fn parse_models(&self, body: &Value) -> Vec<ModelInfo> {
        body["models"]
            .as_array()
            .into_iter()
            .flatten()
            .filter(|m| m["visibility"] == "list")
            .filter_map(|m| {
                Some(ModelInfo {
                    id: m["slug"].as_str()?.into(),
                    name: m["display_name"]
                        .as_str()
                        .or_else(|| m["slug"].as_str())?
                        .into(),
                    vision: m["supports_image_input"].as_bool().unwrap_or(false),
                    json: false,
                    context: None,
                })
            })
            .collect()
    }
}
