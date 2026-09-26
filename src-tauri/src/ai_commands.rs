//! Tauri commands for the AI layer. API keys only ever flow *into* Rust (`ai_set_key`);
//! no command returns one. Streaming text arrives as `ai://delta` events.

use std::path::PathBuf;
use std::sync::Arc;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::ai::keys::{KeyStore, Keychain, MemoryKeys};
use crate::ai::log::LogEntry;
use crate::ai::registry::{Registry, BUNDLED};
use crate::ai::service::{AiService, ModelList, Plan, ProviderStatus, RunRequest, RunResult, Runs};
use crate::ai::settings::AiSettings;
use crate::ai::transport::ReqwestTransport;
use crate::commands::AppState;
use crate::error::{AppError, AppResult};

pub const DELTA_EVENT: &str = "ai://delta";

/// Overrides the folder for AI settings, the model registry and the request log (the
/// E2E tests use a throwaway folder so they never touch the user's settings).
const CONFIG_DIR_ENV: &str = "AXIS_CONFIG_DIR";
/// Keep API keys in memory instead of the OS keychain (E2E tests only).
const MEMORY_KEYS_ENV: &str = "AXIS_AI_MEMORY_KEYS";

pub struct AiState {
    service: Arc<AiService>,
    runs: Runs,
}

impl AiState {
    pub fn init(app: &AppHandle) -> AppResult<Self> {
        let (config, data) = match std::env::var(CONFIG_DIR_ENV) {
            Ok(dir) => (PathBuf::from(&dir), PathBuf::from(dir)),
            Err(_) => {
                let p = app.path();
                (
                    p.app_config_dir()
                        .map_err(|e| AppError::Io(e.to_string()))?,
                    p.app_data_dir().map_err(|e| AppError::Io(e.to_string()))?,
                )
            }
        };
        std::fs::create_dir_all(&config)?;
        // An editable copy of the model defaults, written once.
        let models = config.join("ai-models.json");
        if !models.exists() {
            let _ = std::fs::write(&models, BUNDLED);
        }
        let keys: Arc<dyn KeyStore> = if std::env::var_os(MEMORY_KEYS_ENV).is_some() {
            Arc::new(MemoryKeys::default())
        } else {
            Arc::new(Keychain)
        };
        let transport = ReqwestTransport::new().map_err(|e| AppError::Ai(e.to_string()))?;
        Ok(AiState {
            service: Arc::new(AiService::new(
                config.join("ai-settings.json"),
                data.join("ai-requests.jsonl"),
                Arc::new(Registry::load(Some(&models))),
                keys,
                Arc::new(transport),
            )),
            runs: Runs::default(),
        })
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiSettingsView {
    settings: AiSettings,
    providers: Vec<ProviderStatus>,
}

fn view(ai: &AiState) -> AiSettingsView {
    AiSettingsView {
        settings: ai.service.settings(),
        providers: ai.service.providers(),
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DeltaPayload<'a> {
    run_id: &'a str,
    delta: &'a str,
}

#[tauri::command]
pub fn ai_settings(ai: State<AiState>) -> AiSettingsView {
    view(&ai)
}

#[tauri::command]
pub fn ai_save_settings(ai: State<AiState>, settings: AiSettings) -> AppResult<AiSettingsView> {
    ai.service.save_settings(settings)?;
    Ok(view(&ai))
}

/// Store a provider's key in the OS keychain (an empty key deletes it).
#[tauri::command]
pub fn ai_set_key(ai: State<AiState>, provider_id: String, key: String) -> AppResult<()> {
    ai.service.set_key(&provider_id, &key)
}

#[tauri::command]
pub fn ai_delete_key(ai: State<AiState>, provider_id: String) -> AppResult<()> {
    ai.service.delete_key(&provider_id)
}

/// Check endpoint and key; returns how many models the provider offers.
#[tauri::command]
pub async fn ai_test_provider(ai: State<'_, AiState>, provider_id: String) -> AppResult<usize> {
    let svc = ai.service.clone();
    svc.test_provider(&provider_id).await
}

#[tauri::command]
pub async fn ai_list_models(ai: State<'_, AiState>, provider_id: String) -> AppResult<ModelList> {
    let svc = ai.service.clone();
    svc.list_models(&provider_id).await
}

/// Where a request would go and roughly how big it is, before sending it.
#[tauri::command]
pub async fn ai_plan(
    ai: State<'_, AiState>,
    state: State<'_, AppState>,
    request: RunRequest,
) -> AppResult<Plan> {
    let svc = ai.service.clone();
    let vault = state.current().ok();
    svc.plan(vault.as_ref(), &request).await
}

#[tauri::command]
pub async fn ai_run(
    app: AppHandle,
    ai: State<'_, AiState>,
    state: State<'_, AppState>,
    run_id: String,
    request: RunRequest,
) -> AppResult<RunResult> {
    let svc = ai.service.clone();
    let vault = state.current().ok();
    let cancel = ai.runs.start(&run_id);
    let mut on_delta = |delta: &str| {
        let _ = app.emit(
            DELTA_EVENT,
            DeltaPayload {
                run_id: &run_id,
                delta,
            },
        );
    };
    let result = svc
        .run(vault.as_ref(), request, cancel, &mut on_delta)
        .await;
    ai.runs.finish(&run_id);
    result
}

#[tauri::command]
pub fn ai_cancel(ai: State<AiState>, run_id: String) {
    ai.runs.cancel(&run_id);
}

/// Recent AI requests (metadata only), newest first.
#[tauri::command]
pub fn ai_log(ai: State<AiState>, limit: Option<usize>) -> Vec<LogEntry> {
    ai.service.read_log(limit.unwrap_or(200))
}

pub fn manage(app: &AppHandle) {
    match AiState::init(app) {
        Ok(state) => {
            app.manage(state);
        }
        Err(e) => eprintln!("AI layer disabled: {e}"),
    }
}
