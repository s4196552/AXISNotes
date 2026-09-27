use std::sync::atomic::AtomicBool;
use std::sync::Arc;

use super::*;
use crate::ai::keys::MemoryKeys;
use crate::ai::settings::TaskChoice;
use crate::ai::transport::fixture::Fixture;
use crate::ai::ProviderKind;

const OPENAI_OK: &str = include_str!("../fixtures/openai_responses.sse");
const CHAT_OK: &str = include_str!("../fixtures/chat.sse");
const ANTHROPIC_OK: &str = include_str!("../fixtures/anthropic.sse");
const CHAT_MODELS: &str = include_str!("../fixtures/chat_models.json");
const OPENAI_HANDWRITING: &str = include_str!("../fixtures/openai_handwriting.sse");
const ANTHROPIC_HANDWRITING: &str = include_str!("../fixtures/anthropic_handwriting.sse");

struct Env {
    _dir: tempfile::TempDir,
    vault: Vault,
    service: AiService,
    fx: Arc<Fixture>,
    keys: Arc<MemoryKeys>,
    settings_path: PathBuf,
    log_path: PathBuf,
}

fn provider(id: &str, kind: ProviderKind, name: &str) -> ProviderConfig {
    ProviderConfig {
        id: id.into(),
        kind,
        name: name.into(),
        base_url: String::new(),
        enabled: true,
    }
}

fn env(responses: Vec<(u16, &str)>, providers: Vec<ProviderConfig>, keys: &[&str]) -> Env {
    let dir = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(dir.path().join("vault")).unwrap();
    let vault = Vault::open(&dir.path().join("vault")).unwrap();
    vault
        .write_file(
            ".axisnotes/config.json",
            r#"{"ai":{"folders":{"Medical":"never","Journal":"local"}}}"#,
            None,
        )
        .unwrap();
    vault
        .write_file("Medical/scan.md", "private", None)
        .unwrap();
    vault
        .write_file("Journal/day.md", "dear diary", None)
        .unwrap();
    vault
        .write_file("School/Bio.md", "Mitochondria notes", None)
        .unwrap();
    let fx = Arc::new(Fixture::new(responses));
    let mem = Arc::new(MemoryKeys::default());
    for id in keys {
        mem.set(id, &format!("key-{id}")).unwrap();
    }
    let settings_path = dir.path().join("config/ai-settings.json");
    let log_path = dir.path().join("data/ai-requests.jsonl");
    let service = AiService::new(
        settings_path.clone(),
        log_path.clone(),
        Arc::new(Registry::bundled()),
        mem.clone(),
        fx.clone(),
    );
    let mut settings = AiSettings {
        providers,
        ..AiSettings::default()
    };
    settings.tasks.insert(
        Task::Chat,
        TaskChoice {
            provider: "openai".into(),
            model: "gpt-6-sol".into(),
        },
    );
    service.save_settings(settings).unwrap();
    Env {
        _dir: dir,
        vault,
        service,
        fx,
        keys: mem,
        settings_path,
        log_path,
    }
}

fn ask(sources: &[&str]) -> RunRequest {
    RunRequest {
        task: Some(Task::Chat),
        messages: vec![Message::text(Role::User, "Summarize.")],
        sources: sources.iter().map(|s| s.to_string()).collect(),
        ..RunRequest::default()
    }
}

async fn run(e: &Env, req: RunRequest) -> (AppResult<RunResult>, String) {
    let mut streamed = String::new();
    let r = e
        .service
        .run(
            Some(&e.vault),
            req,
            Arc::new(AtomicBool::new(false)),
            &mut |d: &str| streamed.push_str(d),
        )
        .await;
    (r, streamed)
}

fn std_providers() -> Vec<ProviderConfig> {
    vec![
        provider("openai", ProviderKind::OpenAi, "OpenAI"),
        provider("claude", ProviderKind::Anthropic, "Claude"),
        provider("ollama", ProviderKind::Ollama, "Ollama"),
    ]
}

#[tokio::test]
async fn streams_from_the_task_provider_and_logs_metadata_only() {
    let e = env(vec![(200, OPENAI_OK)], std_providers(), &["openai"]);
    let (r, streamed) = run(&e, ask(&["School/Bio.md"])).await;
    let r = r.unwrap();
    assert_eq!(
        (r.provider_id.as_str(), r.text.as_str()),
        ("openai", "Mitochondria make ATP.")
    );
    assert_eq!(streamed, r.text);
    assert!(!r.local && r.fallback_from.is_none());
    let log = e.service.read_log(10);
    assert_eq!(log[0].status, "ok");
    assert_eq!(log[0].input_tokens, Some(21));
    let raw = std::fs::read_to_string(&e.log_path).unwrap();
    assert!(!raw.contains("Summarize") && !raw.contains("Mitochondria"));
}

#[tokio::test]
async fn ai_never_folders_are_blocked_before_any_provider_is_contacted() {
    for sources in [
        vec!["Medical/scan.md"],
        vec!["School/Bio.md", "Medical/scan.md"],
    ] {
        let e = env(vec![(200, OPENAI_OK)], std_providers(), &["openai"]);
        let (r, _) = run(&e, ask(&sources)).await;
        assert!(matches!(r, Err(AppError::Blocked(_))), "{r:?}");
        assert!(e.fx.requests.lock().unwrap().is_empty());
        assert_eq!(e.service.read_log(1)[0].status, "blocked");
    }
    // Attached notes are read by Rust and held to the same rule.
    let e = env(vec![(200, OPENAI_OK)], std_providers(), &["openai"]);
    let mut req = ask(&[]);
    req.attach = vec!["Medical/scan.md".into()];
    assert!(matches!(run(&e, req).await.0, Err(AppError::Blocked(_))));
    assert!(e.fx.requests.lock().unwrap().is_empty());
    // ...even when the caller names a provider explicitly.
    let mut req = ask(&["Medical/scan.md"]);
    req.provider = Some("ollama".into());
    req.model = Some("llama3.3".into());
    assert!(matches!(run(&e, req).await.0, Err(AppError::Blocked(_))));
}

#[tokio::test]
async fn local_only_folders_go_to_local_providers() {
    // The chat task uses OpenAI; Ollama is the fallback and gets its model from its live
    // list. A note from a "local" folder skips OpenAI entirely.
    let e = env(
        vec![(200, CHAT_MODELS), (200, CHAT_OK)],
        std_providers(),
        &["openai", "claude"],
    );
    let mut s = e.service.settings();
    s.fallback = vec!["claude".into(), "ollama".into()];
    e.service.save_settings(s).unwrap();
    let (r, _) = run(&e, ask(&["School/Bio.md", "Journal/day.md"])).await;
    let r = r.unwrap();
    assert!(r.local);
    assert_eq!(
        (r.provider_id.as_str(), r.model.as_str()),
        ("ollama", "llama3.3")
    );
    assert!(e
        .fx
        .requests
        .lock()
        .unwrap()
        .iter()
        .all(|r| r.url.starts_with("http://localhost:11434/")));

    // With only cloud providers, the request is refused.
    let cloud: Vec<ProviderConfig> = std_providers()
        .into_iter()
        .filter(|p| p.id != "ollama")
        .collect();
    let e = env(vec![(200, OPENAI_OK)], cloud, &["openai", "claude"]);
    let (r, _) = run(&e, ask(&["Journal/day.md"])).await;
    assert!(
        matches!(r, Err(AppError::Blocked(ref m)) if m.contains("local")),
        "{r:?}"
    );
    assert!(e.fx.requests.lock().unwrap().is_empty());
}

#[tokio::test]
async fn falls_back_when_a_provider_is_down() {
    let e = env(
        vec![(503, "overloaded"), (200, ANTHROPIC_OK)],
        std_providers(),
        &["openai", "claude"],
    );
    let mut s = e.service.settings();
    s.fallback = vec!["claude".into()];
    e.service.save_settings(s).unwrap();
    let (r, _) = run(&e, ask(&[])).await;
    let r = r.unwrap();
    assert_eq!(r.provider_id, "claude");
    assert_eq!(r.model, "claude-sonnet-5"); // the registry's chat default
    assert_eq!(r.fallback_from.as_deref(), Some("OpenAI"));
    let log = e.service.read_log(5);
    assert_eq!(
        log.iter().map(|l| l.status.as_str()).collect::<Vec<_>>(),
        vec!["ok", "error"]
    );
}

#[tokio::test]
async fn does_not_fall_back_on_a_rejected_request() {
    let bad = r#"{"error":{"message":"Invalid prompt"}}"#;
    let e = env(
        vec![(400, bad), (200, ANTHROPIC_OK)],
        std_providers(),
        &["openai", "claude"],
    );
    let mut s = e.service.settings();
    s.fallback = vec!["claude".into()];
    e.service.save_settings(s).unwrap();
    let (r, _) = run(&e, ask(&[])).await;
    assert!(
        matches!(r, Err(AppError::Ai(ref m)) if m.contains("Invalid prompt")),
        "{r:?}"
    );
    assert_eq!(e.fx.requests.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn skips_providers_without_keys_and_models_without_vision() {
    let e = env(vec![(200, ANTHROPIC_OK)], std_providers(), &["claude"]);
    let mut s = e.service.settings();
    s.fallback = vec!["claude".into()];
    e.service.save_settings(s).unwrap();
    let (r, _) = run(&e, ask(&[])).await; // openai has no key
    assert_eq!(r.unwrap().provider_id, "claude");

    let e = env(
        vec![(200, ANTHROPIC_OK)],
        std_providers(),
        &["openai", "claude"],
    );
    let mut s = e.service.settings();
    s.tasks.insert(
        Task::Handwriting,
        TaskChoice {
            provider: "openai".into(),
            model: "gpt-6-luna".into(), // no vision
        },
    );
    s.fallback = vec!["claude".into()];
    e.service.save_settings(s).unwrap();
    let mut req = ask(&[]);
    req.task = Some(Task::Handwriting);
    req.messages[0].content.push(Part::Image {
        mime: "image/png".into(),
        data: "iVBOR".into(),
    });
    let (r, _) = run(&e, req).await;
    assert_eq!(r.unwrap().provider_id, "claude");
}

#[tokio::test]
async fn enforces_the_token_cap_and_plans_before_sending() {
    let e = env(vec![], std_providers(), &["openai"]);
    let mut s = e.service.settings();
    s.max_input_tokens = Some(50);
    s.confirm_above_tokens = 10;
    e.service.save_settings(s).unwrap();
    let mut req = ask(&[]);
    req.messages = vec![Message::text(Role::User, "word ".repeat(100))];
    let plan = e.service.plan(Some(&e.vault), &req).await.unwrap();
    assert_eq!(plan.provider_id, "openai");
    assert_eq!(plan.model, "gpt-6-sol");
    assert_eq!(plan.estimated_input_tokens, 125);
    assert!(plan.needs_confirm);
    assert!(plan.estimated_cost.unwrap() > 0.0);
    let (r, _) = run(&e, req).await;
    assert!(
        matches!(r, Err(AppError::Blocked(ref m)) if m.contains("limit")),
        "{r:?}"
    );
    assert!(e.fx.requests.lock().unwrap().is_empty());
}

#[tokio::test]
async fn cancels_a_running_request() {
    let e = env(vec![(200, OPENAI_OK)], std_providers(), &["openai"]);
    let cancel = Arc::new(AtomicBool::new(false));
    let flag = cancel.clone();
    let r = e
        .service
        .run(Some(&e.vault), ask(&[]), cancel, &mut |_d: &str| {
            flag.store(true, std::sync::atomic::Ordering::Relaxed)
        })
        .await;
    assert!(matches!(r, Err(AppError::Cancelled)), "{r:?}");
    assert_eq!(e.service.read_log(1)[0].status, "cancelled");
}

#[tokio::test]
async fn keys_stay_in_the_keystore() {
    let e = env(vec![], std_providers(), &[]);
    e.service.set_key("openai", "sk-secret-123").unwrap();
    assert!(e
        .service
        .providers()
        .iter()
        .any(|p| p.config.id == "openai" && p.has_key));
    let json = serde_json::to_string(&e.service.providers()).unwrap();
    assert!(!json.contains("sk-secret"));
    let mut s = e.service.settings();
    s.max_input_tokens = Some(1000);
    e.service.save_settings(s).unwrap();
    assert!(!std::fs::read_to_string(&e.settings_path)
        .unwrap()
        .contains("sk-secret"));
    // Removing a provider deletes its key.
    let mut s = e.service.settings();
    s.providers.retain(|p| p.id != "openai");
    e.service.save_settings(s).unwrap();
    assert_eq!(e.keys.get("openai").unwrap(), None);
    assert!(e.service.settings().task(Task::Chat).is_none());
    assert!(e.service.set_key("nope", "x").is_err());
}

/// Phase 5: handwriting goes to a vision model as an image in JSON mode, and the same
/// request works with two different vision providers (recorded answers).
#[tokio::test]
async fn handwriting_reads_an_image_on_two_vision_providers() {
    let cases = [
        ("openai", "gpt-6-sol", OPENAI_HANDWRITING),
        ("claude", "claude-sonnet-5", ANTHROPIC_HANDWRITING),
    ];
    for (provider, model, fixture) in cases {
        let e = env(vec![(200, fixture)], std_providers(), &["openai", "claude"]);
        let mut s = e.service.settings();
        s.tasks.insert(
            Task::Handwriting,
            TaskChoice {
                provider: provider.into(),
                model: model.into(),
            },
        );
        e.service.save_settings(s).unwrap();
        let req = RunRequest {
            task: Some(Task::Handwriting),
            json: true,
            sources: vec!["School/Board.axcanvas".into()],
            messages: vec![Message {
                role: Role::User,
                content: vec![
                    Part::Image {
                        mime: "image/png".into(),
                        data: "iVBORw0KGgo".into(),
                    },
                    Part::Text {
                        text: "Transcribe as JSON.".into(),
                    },
                ],
            }],
            ..RunRequest::default()
        };
        let (r, streamed) = run(&e, req).await;
        let r = r.unwrap();
        assert_eq!(
            (r.provider_id.as_str(), streamed.as_str()),
            (provider, r.text.as_str())
        );
        let answer: serde_json::Value = serde_json::from_str(&r.text).unwrap();
        assert_eq!(
            answer["text"], "Mitochondria make ATP\nthe powerhouse of the cel",
            "{provider}"
        );
        assert!(answer["uncertain"]
            .as_array()
            .unwrap()
            .iter()
            .any(|u| u["word"] == "cel" && u["alternatives"][0] == "cell"));

        let sent = e.fx.requests.lock().unwrap()[0].clone();
        let body = sent.body.unwrap().to_string();
        assert!(body.contains("iVBORw0KGgo"), "{provider}: image sent");
        match provider {
            "openai" => assert!(body.contains("json_object")),
            _ => assert!(body.contains("JSON")),
        }
        assert_eq!(e.service.read_log(1)[0].task, Task::Handwriting);
    }
}
