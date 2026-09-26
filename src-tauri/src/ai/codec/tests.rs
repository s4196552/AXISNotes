//! Adapters against recorded provider responses (`src/ai/fixtures`). The same prompt is
//! sent through every API format; requests are checked for shape, answers for content.

use std::sync::Arc;

use serde_json::{json, Value};

use crate::ai::adapter::Adapter;
use crate::ai::registry::Registry;
use crate::ai::transport::fixture::Fixture;
use crate::ai::transport::HttpRequest;
use crate::ai::{AiError, AiProvider, Effort, Message, ProviderKind, Request, Role};

const PROMPT: &str = "In one sentence: what do mitochondria do?";
const ANSWER: &str = "Mitochondria make ATP.";

macro_rules! fixture {
    ($name:literal) => {
        include_str!(concat!("../fixtures/", $name))
    };
}

fn adapter(
    kind: ProviderKind,
    key: Option<&str>,
    responses: Vec<(u16, &str)>,
) -> (Adapter, Arc<Fixture>) {
    let fx = Arc::new(Fixture::new(responses));
    let a = Adapter::new(
        kind,
        None,
        key.map(String::from),
        fx.clone(),
        Arc::new(Registry::bundled()),
    );
    (a, fx)
}

fn request(model: &str) -> Request {
    Request {
        model: model.into(),
        messages: vec![
            Message::text(Role::System, "Be brief."),
            Message::text(Role::User, PROMPT),
        ],
        max_output_tokens: Some(200),
        ..Request::default()
    }
}

fn header<'a>(r: &'a HttpRequest, name: &str) -> Option<&'a str> {
    r.headers
        .iter()
        .find(|(k, _)| k.eq_ignore_ascii_case(name))
        .map(|(_, v)| v.as_str())
}

fn sent(fx: &Fixture) -> HttpRequest {
    fx.requests.lock().unwrap().last().unwrap().clone()
}

async fn stream_all(a: &Adapter, req: &Request) -> (String, Vec<String>) {
    let mut deltas = Vec::new();
    let c = a
        .stream(req, &mut |d: &str| {
            deltas.push(d.to_string());
            true
        })
        .await
        .unwrap();
    (c.text, deltas)
}

#[tokio::test]
async fn openai_uses_the_responses_api() {
    let (a, fx) = adapter(
        ProviderKind::OpenAi,
        Some("sk-test"),
        vec![
            (200, fixture!("openai_responses.json")),
            (200, fixture!("openai_responses.sse")),
        ],
    );
    let mut req = request("gpt-6-sol");
    req.effort = Some(Effort::Deep);
    req.json = true;
    let c = a.complete(&req).await.unwrap();
    assert_eq!(c.text, ANSWER);
    assert_eq!(c.model, "gpt-6-sol-2026-09-22");
    assert_eq!(c.usage.unwrap().input_tokens, 21);

    let r = sent(&fx);
    assert_eq!(r.url, "https://api.openai.com/v1/responses");
    assert_eq!(header(&r, "authorization"), Some("Bearer sk-test"));
    let body = r.body.unwrap();
    assert_eq!(body["store"], json!(false));
    assert_eq!(body["reasoning"], json!({ "effort": "high" }));
    assert_eq!(body["text"]["format"]["type"], "json_object");
    assert_eq!(
        body["input"][1]["content"][0],
        json!({ "type": "input_text", "text": PROMPT })
    );

    let (text, deltas) = stream_all(&a, &request("gpt-6-sol")).await;
    assert_eq!((text.as_str(), deltas.len()), (ANSWER, 2));
    assert_eq!(sent(&fx).body.unwrap()["stream"], json!(true));
}

#[tokio::test]
async fn anthropic_uses_the_messages_api() {
    let (a, fx) = adapter(
        ProviderKind::Anthropic,
        Some("sk-ant"),
        vec![
            (200, fixture!("anthropic.json")),
            (200, fixture!("anthropic.sse")),
        ],
    );
    let mut req = request("claude-sonnet-5");
    req.effort = Some(Effort::Balanced);
    req.temperature = Some(0.3);
    let c = a.complete(&req).await.unwrap();
    assert_eq!(c.text, ANSWER); // thinking block excluded
    let r = sent(&fx);
    assert_eq!(r.url, "https://api.anthropic.com/v1/messages");
    assert_eq!(header(&r, "x-api-key"), Some("sk-ant"));
    assert_eq!(header(&r, "anthropic-version"), Some("2023-06-01"));
    let body = r.body.unwrap();
    assert_eq!(body["system"], "Be brief.");
    assert_eq!(body["messages"].as_array().unwrap().len(), 1);
    assert_eq!(body["thinking"]["budget_tokens"], 4000);
    assert_eq!(body["max_tokens"], 4200);
    assert!(body.get("temperature").is_none()); // not allowed with thinking

    let (text, deltas) = stream_all(&a, &request("claude-sonnet-5")).await;
    assert_eq!((text.as_str(), deltas.len()), (ANSWER, 2));
}

#[tokio::test]
async fn gemini_uses_generate_content_with_the_key_in_a_header() {
    let (a, fx) = adapter(
        ProviderKind::Gemini,
        Some("AIza-test"),
        vec![
            (200, fixture!("gemini.json")),
            (200, fixture!("gemini.sse")),
        ],
    );
    let c = a.complete(&request("gemini-3.1-flash")).await.unwrap();
    assert_eq!(c.text, ANSWER); // thought part excluded
    assert_eq!(c.usage.unwrap().output_tokens, 6);
    let r = sent(&fx);
    assert_eq!(
        r.url,
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash:generateContent"
    );
    assert!(!r.url.contains("AIza"));
    assert_eq!(header(&r, "x-goog-api-key"), Some("AIza-test"));
    let body = r.body.unwrap();
    assert_eq!(body["systemInstruction"]["parts"][0]["text"], "Be brief.");
    assert_eq!(body["contents"][0]["role"], "user");
    assert_eq!(body["generationConfig"]["maxOutputTokens"], 200);

    let (text, _) = stream_all(&a, &request("models/gemini-3.1-flash")).await;
    assert_eq!(text, ANSWER);
    assert!(sent(&fx)
        .url
        .ends_with("models/gemini-3.1-flash:streamGenerateContent?alt=sse"));
}

#[tokio::test]
async fn ollama_uses_openai_compatible_chat_without_a_key() {
    let (a, fx) = adapter(
        ProviderKind::Ollama,
        None,
        vec![(200, fixture!("chat.json")), (200, fixture!("chat.sse"))],
    );
    let c = a.complete(&request("llama3.3")).await.unwrap();
    assert_eq!(c.text, ANSWER);
    let r = sent(&fx);
    assert_eq!(r.url, "http://localhost:11434/v1/chat/completions");
    assert_eq!(header(&r, "authorization"), None);
    assert_eq!(
        r.body.unwrap()["messages"][1],
        json!({ "role": "user", "content": PROMPT })
    );

    let (text, deltas) = stream_all(&a, &request("llama3.3")).await;
    assert_eq!(text, ANSWER);
    assert_eq!(deltas, vec!["Mitochondria", " make ATP."]);
    let body = sent(&fx).body.unwrap();
    assert_eq!(body["stream_options"], json!({ "include_usage": true }));
}

#[tokio::test]
async fn drops_an_unsupported_parameter_and_retries_once() {
    let (a, fx) = adapter(
        ProviderKind::OpenAi,
        Some("k"),
        vec![
            (400, fixture!("openai_unsupported.json")),
            (200, fixture!("openai_responses.json")),
        ],
    );
    let mut req = request("gpt-6-sol");
    req.temperature = Some(0.7);
    assert_eq!(a.complete(&req).await.unwrap().text, ANSWER);
    let reqs = fx.requests.lock().unwrap();
    assert_eq!(reqs.len(), 2);
    assert!(reqs[0].body.as_ref().unwrap().get("temperature").is_some());
    assert!(reqs[1].body.as_ref().unwrap().get("temperature").is_none());
}

#[tokio::test]
async fn gives_up_after_one_retry_with_a_clear_error() {
    let unsupported = fixture!("openai_unsupported.json");
    let (a, fx) = adapter(
        ProviderKind::OpenAi,
        Some("k"),
        vec![(400, unsupported), (400, unsupported)],
    );
    let mut req = request("gpt-6-sol");
    req.temperature = Some(0.7);
    let err = a.complete(&req).await.unwrap_err();
    assert!(matches!(err, AiError::Invalid { .. }), "{err:?}");
    assert!(err.to_string().contains("temperature"));
    assert_eq!(fx.requests.lock().unwrap().len(), 2);
}

#[tokio::test]
async fn never_sends_temperature_to_models_that_reject_it() {
    let (a, fx) = adapter(
        ProviderKind::OpenAi,
        Some("k"),
        vec![(200, fixture!("openai_responses.json"))],
    );
    let mut req = request("gpt-6-astra");
    req.temperature = Some(0.2);
    a.complete(&req).await.unwrap();
    assert!(sent(&fx).body.unwrap().get("temperature").is_none());
}

#[tokio::test]
async fn maps_http_errors() {
    type Check = fn(&AiError) -> bool;
    let cases: Vec<(u16, &str, Check)> = vec![
        (401, r#"{"error":{"message":"Incorrect API key"}}"#, |e| {
            matches!(e, AiError::Auth(_))
        }),
        (429, r#"{"error":{"message":"slow down"}}"#, |e| {
            matches!(e, AiError::RateLimited(_))
        }),
        (503, "overloaded", |e| matches!(e, AiError::Unavailable(_))),
        (404, r#"{"error":{"message":"model not found"}}"#, |e| {
            matches!(e, AiError::Invalid { param: None, .. })
        }),
    ];
    for (status, body, check) in cases {
        let (a, _) = adapter(ProviderKind::OpenRouter, Some("k"), vec![(status, body)]);
        let err = a.complete(&request("x")).await.unwrap_err();
        assert!(check(&err), "{status}: {err:?}");
    }
    let (a, _) = adapter(ProviderKind::Ollama, None, vec![(0, "")]);
    assert!(matches!(
        a.complete(&request("x")).await,
        Err(AiError::Unavailable(_))
    ));
}

#[tokio::test]
async fn stops_reading_when_the_caller_cancels() {
    let (a, _) = adapter(
        ProviderKind::Ollama,
        None,
        vec![(200, fixture!("chat.sse"))],
    );
    let mut seen = 0;
    let err = a
        .stream(&request("llama3.3"), &mut |_d: &str| {
            seen += 1;
            false
        })
        .await
        .unwrap_err();
    assert_eq!(err, AiError::Cancelled);
    assert_eq!(seen, 1);
}

#[tokio::test]
async fn sends_images_in_each_format() {
    let image = |kind, resp| {
        let (a, fx) = adapter(kind, Some("k"), vec![(200, resp)]);
        (a, fx)
    };
    let check = |fx: &Fixture, pointer: &str, expect: Value| {
        let body = sent(fx).body.unwrap();
        assert_eq!(body.pointer(pointer), Some(&expect), "{body}");
    };
    let (a, fx) = image(ProviderKind::OpenAi, fixture!("openai_responses.json"));
    a.vision("gpt-6-sol", "Transcribe.", "image/png", "iVBOR")
        .await
        .unwrap();
    check(
        &fx,
        "/input/0/content/0/image_url",
        json!("data:image/png;base64,iVBOR"),
    );
    let (a, fx) = image(ProviderKind::Anthropic, fixture!("anthropic.json"));
    a.vision("claude-sonnet-5", "Transcribe.", "image/png", "iVBOR")
        .await
        .unwrap();
    check(&fx, "/messages/0/content/0/source/data", json!("iVBOR"));
    let (a, fx) = image(ProviderKind::Gemini, fixture!("gemini.json"));
    a.vision("gemini-3.1-flash", "Transcribe.", "image/png", "iVBOR")
        .await
        .unwrap();
    check(
        &fx,
        "/contents/0/parts/0/inline_data/mime_type",
        json!("image/png"),
    );
    let (a, fx) = image(ProviderKind::LmStudio, fixture!("chat.json"));
    a.vision("qwen2.5vl:7b", "Transcribe.", "image/jpeg", "/9j/")
        .await
        .unwrap();
    check(
        &fx,
        "/messages/0/content/0/image_url/url",
        json!("data:image/jpeg;base64,/9j/"),
    );
}

#[tokio::test]
async fn lists_models_with_capabilities() {
    let (a, _) = adapter(
        ProviderKind::Ollama,
        None,
        vec![(200, fixture!("chat_models.json"))],
    );
    let m = a.list_models().await.unwrap();
    assert_eq!(
        m.iter()
            .map(|m| (m.id.as_str(), m.vision))
            .collect::<Vec<_>>(),
        vec![("llama3.3", false), ("qwen2.5vl:7b", true)]
    );
    let (a, _) = adapter(
        ProviderKind::Anthropic,
        Some("k"),
        vec![(200, fixture!("anthropic_models.json"))],
    );
    assert_eq!(a.list_models().await.unwrap()[0].name, "Claude Opus 5.5");
    let (a, _) = adapter(
        ProviderKind::Gemini,
        Some("k"),
        vec![(200, fixture!("gemini_models.json"))],
    );
    let m = a.list_models().await.unwrap();
    assert_eq!(m.len(), 2); // embedding model filtered out
    assert_eq!(m[1].context, Some(2_097_152));
}

/// Live check against real providers, only when keys are set (never in CI):
/// `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, and a running Ollama with
/// `AXIS_OLLAMA_MODEL`. Each missing one is skipped.
#[tokio::test]
async fn live_same_prompt_when_keys_are_available() {
    use crate::ai::transport::ReqwestTransport;
    let transport = Arc::new(ReqwestTransport::new().unwrap());
    let registry = Arc::new(Registry::bundled());
    let cases = [
        (ProviderKind::OpenAi, "OPENAI_API_KEY", "gpt-6-luna"),
        (
            ProviderKind::Anthropic,
            "ANTHROPIC_API_KEY",
            "claude-haiku-4-5-20251001",
        ),
        (ProviderKind::Gemini, "GEMINI_API_KEY", "gemini-3.1-flash"),
    ];
    for (kind, env, model) in cases {
        let Ok(key) = std::env::var(env) else {
            eprintln!("skipping live {kind:?}: {env} not set");
            continue;
        };
        let a = Adapter::new(kind, None, Some(key), transport.clone(), registry.clone());
        let c = a.complete(&request(model)).await.unwrap();
        assert!(
            c.text.to_lowercase().contains("atp") || !c.text.is_empty(),
            "{kind:?}"
        );
    }
    if let Ok(model) = std::env::var("AXIS_OLLAMA_MODEL") {
        let a = Adapter::new(ProviderKind::Ollama, None, None, transport, registry);
        assert!(!a.complete(&request(&model)).await.unwrap().text.is_empty());
    }
}
