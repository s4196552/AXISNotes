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

/// T-281: endpoints crafted to look local are remote, so "local models only" notes never
/// reach them.
#[tokio::test]
async fn crafted_lookalike_endpoints_are_not_local() {
    let crafted = [
        "https://127.0.0.1.evil.com/v1",
        "https://evil.com#.localhost",
        "https://localhost@evil.com/v1",
        "https://localhost./v1",
    ];
    let mut providers = vec![provider("openai", ProviderKind::OpenAi, "OpenAI")];
    for (i, url) in crafted.iter().enumerate() {
        let mut p = provider(&format!("custom-{i}"), ProviderKind::Custom, "Lookalike");
        p.base_url = url.to_string();
        providers.push(p);
    }
    let e = env(
        vec![(200, CHAT_MODELS), (200, CHAT_OK)],
        providers,
        &["openai"],
    );
    let mut s = e.service.settings();
    s.fallback = (0..crafted.len()).map(|i| format!("custom-{i}")).collect();
    e.service.save_settings(s).unwrap();
    assert!(e.service.providers().iter().all(|p| !p.local));
    let (r, _) = run(&e, ask(&["Journal/day.md"])).await;
    assert!(
        matches!(r, Err(AppError::Blocked(ref m)) if m.contains("local")),
        "{r:?}"
    );
    assert!(e.fx.requests.lock().unwrap().is_empty());
}

/// T-281: plain http:// is only for this computer; keys and notes aren't sent unencrypted.
#[tokio::test]
async fn plain_http_endpoints_must_be_on_this_computer() {
    let e = env(vec![], std_providers(), &[]);
    for url in [
        "http://192.168.1.10:11434/v1",
        "http://api.example.com/v1",
        "http://localhost@evil.com/v1",
        "http://127.0.0.1.evil.com/v1",
        "HTTP://Example.com/v1",
    ] {
        let mut s = e.service.settings();
        s.providers[2].base_url = url.into();
        let err = e.service.save_settings(s).unwrap_err().to_string();
        assert!(
            err.contains("Plain http:// is only allowed"),
            "{url}: {err}"
        );
    }
    for url in [
        "http://localhost:11434/v1",
        "http://127.0.0.1:1234/v1",
        "http://[::1]:8080/v1",
        "http://ollama.localhost/v1",
        "https://ollama.example.com/v1",
    ] {
        let mut s = e.service.settings();
        s.providers[2].base_url = url.into();
        e.service.save_settings(s).unwrap();
        assert_eq!(e.service.settings().providers[2].base_url, url);
    }

    // One saved by an older version stays visible (not silently replaced by the default);
    // the transport refuses to send to it.
    let text = std::fs::read_to_string(&e.settings_path).unwrap().replace(
        "https://ollama.example.com/v1",
        "http://192.168.1.10:11434/v1",
    );
    std::fs::write(&e.settings_path, text).unwrap();
    let reopened = AiService::new(
        e.settings_path.clone(),
        e.log_path.clone(),
        Arc::new(Registry::bundled()),
        e.keys.clone(),
        e.fx.clone(),
    );
    let ollama = &reopened.providers()[2];
    assert_eq!(ollama.config.base_url, "http://192.168.1.10:11434/v1");
    assert!(!ollama.local);
}

#[tokio::test]
async fn ai_output_keeps_the_rule_of_what_it_was_made_from() {
    // A note in an open folder, marked by an earlier AI answer about a local-only note.
    let e = env(vec![(200, OPENAI_OK)], std_providers(), &["openai"]);
    e.vault
        .write_file(
            "School/Summary.md",
            "---\nai-access: local\n---\nFrom my journal",
            None,
        )
        .unwrap();
    for (sources, attach) in [
        (vec!["School/Summary.md"], vec![]),
        (vec![], vec!["School/Summary.md"]),
    ] {
        let mut req = ask(&sources);
        req.attach = attach.into_iter().map(String::from).collect();
        let (r, _) = run(&e, req).await;
        assert!(
            matches!(r, Err(AppError::Blocked(ref m)) if m.contains("local")),
            "{r:?}"
        );
    }
    assert!(e.fx.requests.lock().unwrap().is_empty());
    // A mark that can't be read refuses even local models.
    e.vault
        .write_file("School/Odd.md", "---\nai-access: sometimes\n---\nx", None)
        .unwrap();
    let mut req = ask(&["School/Odd.md"]);
    req.provider = Some("ollama".into());
    req.model = Some("llama3.3".into());
    assert!(matches!(run(&e, req).await.0, Err(AppError::Blocked(_))));
    // An answer reports the strictest rule it read, for saving it with the right mark.
    let (r, _) = run(&e, ask(&["School/Bio.md"])).await;
    assert_eq!(r.unwrap().rule, AiRule::Any);
    let e = env(
        vec![(200, CHAT_MODELS), (200, CHAT_OK)],
        std_providers(),
        &["openai"],
    );
    let mut s = e.service.settings();
    s.fallback = vec!["ollama".into()];
    e.service.save_settings(s).unwrap();
    let (r, _) = run(&e, ask(&["Journal/day.md"])).await;
    assert_eq!(r.unwrap().rule, AiRule::Local);
}

#[tokio::test]
async fn folder_model_allowlists_filter_every_provider_including_fallbacks() {
    let e = env(
        vec![(200, ANTHROPIC_OK)],
        std_providers(),
        &["openai", "claude"],
    );
    e.vault
        .write_file(
            ".axisnotes/config.json",
            r#"{"ai":{"folders":{},"models":{"School":["claude/*"]}}}"#,
            None,
        )
        .unwrap();
    let mut s = e.service.settings();
    s.fallback = vec!["claude".into()];
    e.service.save_settings(s).unwrap();
    // The chat task's OpenAI model isn't allowed for School notes: Claude answers.
    let (r, _) = run(&e, ask(&["School/Bio.md"])).await;
    assert_eq!(r.unwrap().provider_id, "claude");
    assert!(e
        .fx
        .requests
        .lock()
        .unwrap()
        .iter()
        .all(|r| r.url.contains("anthropic")));
    // Planning picks the same provider.
    let plan = e
        .service
        .plan(Some(&e.vault), &ask(&["School/Bio.md"]))
        .await
        .unwrap();
    assert_eq!(plan.provider_id, "claude");

    // Lists that leave nothing (here: School allows Claude, Lab only Ollama) refuse the
    // request, name the folders, send nothing and log it.
    let e = env(
        vec![(200, OPENAI_OK)],
        std_providers(),
        &["openai", "claude"],
    );
    e.vault
        .write_file(
            ".axisnotes/config.json",
            r#"{"ai":{"models":{"School":["claude/*"],"Lab":["ollama/llama3.3"]}}}"#,
            None,
        )
        .unwrap();
    e.vault.write_file("Lab/run.md", "data", None).unwrap();
    let mut s = e.service.settings();
    s.fallback = vec!["claude".into(), "ollama".into()];
    e.service.save_settings(s).unwrap();
    let (r, _) = run(&e, ask(&["School/Bio.md", "Lab/run.md"])).await;
    assert!(
        matches!(r, Err(AppError::Blocked(ref m)) if m.contains("\"Lab\" allows ollama/llama3.3") && m.contains("\"School\" allows claude/*")),
        "{r:?}"
    );
    // (Ollama's model list may be looked up; no note is sent anywhere.)
    assert!(e
        .fx
        .requests
        .lock()
        .unwrap()
        .iter()
        .all(|r| r.body.is_none()));
    assert_eq!(e.service.read_log(1)[0].status, "blocked");
    // An allowlist that isn't a list of names allows nothing.
    e.vault
        .write_file(
            ".axisnotes/config.json",
            r#"{"ai":{"models":{"School":"claude"}}}"#,
            None,
        )
        .unwrap();
    let (r, _) = run(&e, ask(&["School/Bio.md"])).await;
    assert!(
        matches!(r, Err(AppError::Blocked(ref m)) if m.contains("no models")),
        "{r:?}"
    );
}

fn last_body(e: &Env) -> serde_json::Value {
    e.fx.requests
        .lock()
        .unwrap()
        .last()
        .unwrap()
        .body
        .clone()
        .unwrap()
}

#[tokio::test]
async fn passages_are_read_by_rust_held_to_their_rules_and_cited() {
    let e = env(vec![(200, OPENAI_OK)], std_providers(), &["openai"]);
    e.vault
        .write_file(
            "School/Bio.md",
            "---\ntags: [bio]\n---\nIntro\n# Energy\nMitochondria make \"ATP\".\n# Other\nNot sent\n",
            None,
        )
        .unwrap();
    let mut req = ask(&[]);
    req.passages = vec![
        PassageRef {
            path: "School/Bio.md".into(),
            heading: Some("Energy".into()),
        },
        PassageRef {
            path: "School/Bio.md".into(),
            heading: Some("Gone since".into()),
        },
    ];
    let (r, _) = run(&e, req).await;
    assert_eq!(r.unwrap().rule, AiRule::Any);
    let body = last_body(&e).to_string();
    assert!(
        body.contains("cite=\\\"[[School/Bio#Energy]]\\\""),
        "{body}"
    );
    assert!(body.contains("Mitochondria make \\\"ATP\\\""));
    assert!(!body.contains("Not sent") && !body.contains("Gone since") && !body.contains("tags"));
    assert_eq!(e.service.read_log(1)[0].sources, 2);

    // A passage from an "AI: never" folder blocks the request; a local-only one needs a
    // local model.
    for (path, blocked_word) in [("Medical/scan.md", "never"), ("Journal/day.md", "local")] {
        let mut req = ask(&[]);
        req.passages = vec![PassageRef {
            path: path.into(),
            heading: None,
        }];
        let (r, _) = run(&e, req).await;
        assert!(
            matches!(r, Err(AppError::Blocked(ref m)) if m.contains(blocked_word)),
            "{path}: {r:?}"
        );
    }
}

#[tokio::test]
async fn a_conversations_rule_floor_only_makes_requests_stricter() {
    let e = env(vec![(200, OPENAI_OK)], std_providers(), &["openai"]);
    let mut req = ask(&["School/Bio.md"]);
    req.at_least = Some(AiRule::Local);
    let (r, _) = run(&e, req).await;
    assert!(
        matches!(r, Err(AppError::Blocked(ref m)) if m.contains("local")),
        "{r:?}"
    );
    let mut req = ask(&["Medical/scan.md"]);
    req.at_least = Some(AiRule::Any);
    assert!(matches!(run(&e, req).await.0, Err(AppError::Blocked(_))));
    assert!(e.fx.requests.lock().unwrap().is_empty());
}

#[tokio::test]
async fn attached_notes_come_first_so_follow_ups_share_a_cached_opening() {
    let e = env(vec![(200, OPENAI_OK)], std_providers(), &["openai"]);
    let mut req = ask(&[]);
    req.messages = vec![
        Message::text(Role::System, "Be brief."),
        Message::text(Role::User, "First?"),
        Message::text(Role::Assistant, "One."),
        Message::text(Role::User, "Second?"),
    ];
    req.attach = vec!["School/Bio.md".into()];
    run(&e, req).await.0.unwrap();
    let body = last_body(&e);
    let input = body["input"].as_array().unwrap();
    let text = |i: usize| {
        input[i]["content"][0]["text"]
            .as_str()
            .unwrap_or("")
            .to_string()
    };
    assert!(
        text(1).starts_with("<note path=\"School/Bio.md\">"),
        "{body}"
    );
    assert_eq!(text(2), "First?");
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

#[tokio::test]
async fn a_key_pasted_as_the_endpoint_is_refused_and_cleared_from_disk() {
    let e = env(vec![], std_providers(), &[]);
    // Saving a key in the endpoint box is refused with a message that says so.
    let mut s = e.service.settings();
    s.providers[0].base_url = "sk-proj-abcdefghijklmnopqrstuvwxyz0123456789".into();
    let err = e.service.save_settings(s).unwrap_err().to_string();
    assert!(err.contains("looks like an API key"), "{err}");
    let mut s = e.service.settings();
    s.providers[0].base_url = "api.example.com/v1".into();
    assert!(e.service.save_settings(s).is_err());
    // Real endpoints, with surrounding spaces trimmed, still save.
    let mut s = e.service.settings();
    s.providers[0].base_url = "  http://localhost:11434/v1 ".into();
    e.service.save_settings(s).unwrap();
    assert_eq!(
        e.service.settings().providers[0].base_url,
        "http://localhost:11434/v1"
    );

    // A file written by an older version, with the key as the endpoint, is cleaned on load.
    let text = std::fs::read_to_string(&e.settings_path)
        .unwrap()
        .replace("http://localhost:11434/v1", "sk-proj-leaked-secret-value");
    std::fs::write(&e.settings_path, text).unwrap();
    let reopened = AiService::new(
        e.settings_path.clone(),
        e.log_path.clone(),
        Arc::new(Registry::bundled()),
        e.keys.clone(),
        e.fx.clone(),
    );
    assert_eq!(reopened.settings().providers[0].base_url, "");
    assert!(!std::fs::read_to_string(&e.settings_path)
        .unwrap()
        .contains("sk-proj-leaked"));
}

#[tokio::test]
async fn keys_with_spaces_or_line_breaks_inside_are_refused() {
    let e = env(vec![], std_providers(), &[]);
    assert!(e.service.set_key("openai", "sk-abc\ndef").is_err());
    assert!(e.service.set_key("openai", "sk-abc def").is_err());
    assert!(e.service.set_key("openai", "sk-abc\u{200b}def").is_err());
    assert_eq!(e.keys.get("openai").unwrap(), None);
    e.service.set_key("openai", "  sk-abc-def\n").unwrap();
    assert_eq!(e.keys.get("openai").unwrap().as_deref(), Some("sk-abc-def"));
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

fn plan_env(responses: Vec<(u16, &str)>) -> Env {
    let mut providers = std_providers();
    providers.insert(0, provider("plan", ProviderKind::ChatGpt, "ChatGPT plan"));
    let e = env(responses, providers, &["openai"]);
    let mut settings = e.service.settings();
    settings.tasks.insert(
        Task::Chat,
        TaskChoice {
            provider: "plan".into(),
            model: "account-model".into(),
        },
    );
    settings.fallback = vec!["openai".into()];
    e.service.save_settings(settings).unwrap();
    e
}
fn connect_plan(e: &Env) {
    // Offline fixture credential; never a real account or API key.
    e.keys.set("chatgpt-session:plan", &serde_json::json!({"client_id":"oaiapp_test","subject":"test-user","access_token":"fixture-only", "scope":"resource.invoke chatgpt.tokens.use.direct","expires_at":u64::MAX}).to_string()).unwrap();
}
#[tokio::test]
async fn plan_auth_quota_and_disconnection_never_use_paid_fallback() {
    for response in [
        "{\"error\":{\"message\":\"unauthorized\"}}",
        "{\"error\":{\"code\":\"subscription_sharing_usage_limit_exceeded\"}}",
    ] {
        let e = plan_env(vec![(429, response), (200, OPENAI_OK)]);
        connect_plan(&e);
        let (result, _) = run(&e, ask(&[])).await;
        assert!(result.is_err());
        assert_eq!(e.fx.requests.lock().unwrap().len(), 1);
    }
    let e = plan_env(vec![(200, OPENAI_OK)]);
    assert!(run(&e, ask(&[])).await.0.is_err());
    assert!(e.fx.requests.lock().unwrap().is_empty());
    let mut settings = e.service.settings();
    settings.providers[0].enabled = false;
    e.service.save_settings(settings).unwrap();
    assert!(run(&e, ask(&[])).await.0.is_err());
    assert!(e.fx.requests.lock().unwrap().is_empty());
}
#[tokio::test]
async fn plan_respects_source_rules_and_cannot_masquerade_as_local() {
    let e = plan_env(vec![(200, OPENAI_OK)]);
    connect_plan(&e);
    assert!(run(&e, ask(&["Medical/scan.md"])).await.0.is_err());
    assert!(run(&e, ask(&["Journal/day.md"])).await.0.is_err());
    assert!(e.fx.requests.lock().unwrap().is_empty());
    let mut cfg = provider("p", ProviderKind::ChatGpt, "Plan");
    cfg.base_url = "http://localhost:1234".into();
    assert!(!is_local(&cfg));
    let mut settings = e.service.settings();
    settings.providers[0].base_url = cfg.base_url;
    assert!(e.service.save_settings(settings).is_err());
    assert!(e.service.set_key("plan", "test-key").is_err());
    assert!(e.service.delete_key("plan").is_err());
}
#[tokio::test]
async fn plan_settings_expose_no_tokens_and_model_failure_has_no_api_catalog() {
    let e = plan_env(vec![(401, "{}")]);
    connect_plan(&e);
    let exposed = serde_json::to_string(&e.service.providers()).unwrap();
    assert!(!exposed.contains("fixture-only"));
    assert!(!exposed.contains("resource.invoke"));
    let models = e.service.list_models("plan").await.unwrap();
    assert!(models.models.is_empty());
    assert!(models.error.is_some());
}

#[tokio::test]
async fn privacy_rules_that_cant_be_read_block_before_any_provider_is_contacted() {
    // Invalid JSON (a trailing comma), or a folders/models section of the wrong shape:
    // nothing is sent, not even School notes, and the refusal is logged.
    for config in [
        r#"{"ai":{"folders":{"Medical":"never"},}}"#,
        r#"{"ai":{"folders":["Medical"]}}"#,
        r#"{"ai":{"folders":{},"models":"ollama/*"}}"#,
    ] {
        let e = env(vec![(200, OPENAI_OK)], std_providers(), &["openai"]);
        e.vault
            .write_file(".axisnotes/config.json", config, None)
            .unwrap();
        let (r, _) = run(&e, ask(&["School/Bio.md"])).await;
        assert!(matches!(r, Err(AppError::Blocked(_))), "{config}: {r:?}");
        assert!(
            e.service
                .plan(Some(&e.vault), &ask(&["School/Bio.md"]))
                .await
                .is_err(),
            "{config}"
        );
        assert!(e.fx.requests.lock().unwrap().is_empty(), "{config}");
        assert_eq!(e.service.read_log(1)[0].status, "blocked", "{config}");
    }
}

#[tokio::test]
async fn folder_rules_hold_however_the_rule_or_path_is_spelled() {
    for (config, source) in [
        // A capitalised value isn't dropped.
        (
            r#"{"ai":{"folders":{"Medical":"Never"}}}"#,
            "Medical/scan.md",
        ),
        // An unknown value counts as never.
        (
            r#"{"ai":{"folders":{"Medical":"private"}}}"#,
            "Medical/scan.md",
        ),
        // The rule's case differs from the folder's.
        (
            r#"{"ai":{"folders":{"medical":"never"}}}"#,
            "Medical/scan.md",
        ),
        // The path's case differs from the rule's.
        (
            r#"{"ai":{"folders":{"Medical":"never"}}}"#,
            "MEDICAL/scan.md",
        ),
    ] {
        let e = env(vec![(200, OPENAI_OK)], std_providers(), &["openai"]);
        e.vault
            .write_file(".axisnotes/config.json", config, None)
            .unwrap();
        let (r, _) = run(&e, ask(&[source])).await;
        assert!(
            matches!(r, Err(AppError::Blocked(_))),
            "{config} {source}: {r:?}"
        );
        assert!(e.fx.requests.lock().unwrap().is_empty());
    }
    // A model allowlist set with another case still applies.
    let e = env(vec![(200, OPENAI_OK)], std_providers(), &["openai"]);
    e.vault
        .write_file(
            ".axisnotes/config.json",
            r#"{"ai":{"folders":{},"models":{"school":["ollama/*"]}}}"#,
            None,
        )
        .unwrap();
    let mut s = e.service.settings();
    s.providers.retain(|p| p.id == "openai");
    e.service.save_settings(s).unwrap();
    let (r, _) = run(&e, ask(&["School/Bio.md"])).await;
    assert!(matches!(r, Err(AppError::Blocked(_))), "{r:?}");
    assert!(e.fx.requests.lock().unwrap().is_empty());
}

#[tokio::test]
async fn a_note_that_cant_be_read_to_check_its_mark_blocks_the_request() {
    let e = env(vec![(200, OPENAI_OK)], std_providers(), &["openai"]);
    // A note that exists but can't be read as text (not UTF-8), so its mark can't be checked.
    std::fs::write(
        e.vault.resolve("School/Locked.md").unwrap(),
        [0xffu8, 0xfe, 0x00, 0x61],
    )
    .unwrap();
    let (r, _) = run(&e, ask(&["School/Locked.md"])).await;
    assert!(matches!(r, Err(AppError::Blocked(_))), "{r:?}");
    assert!(e.fx.requests.lock().unwrap().is_empty());
    // A note that isn't there (yet) is held to its folder's rule only.
    let (r, _) = run(&e, ask(&["School/New.md"])).await;
    assert_eq!(r.unwrap().provider_id, "openai");
}
