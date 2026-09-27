//! Tauri commands for the web clipper settings, and starting the endpoint with the app.

use std::path::PathBuf;
use std::sync::Arc;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::clipper::{Clipper, ClipperStatus, PairingCode};
use crate::commands::AppState;
use crate::error::{AppError, AppResult};

/// Same override as the AI settings (E2E tests use a throwaway folder).
const CONFIG_DIR_ENV: &str = "AXIS_CONFIG_DIR";
/// Listen on this port instead of the configured one (E2E tests).
const PORT_ENV: &str = "AXIS_CLIPPER_PORT";
pub const CLIP_EVENT: &str = "clipper://clipped";

pub struct ClipperState(pub Arc<Clipper>);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ClippedPayload {
    path: String,
    title: String,
}

fn config_path(app: &AppHandle) -> AppResult<PathBuf> {
    let dir = match std::env::var(CONFIG_DIR_ENV) {
        Ok(d) => PathBuf::from(d),
        Err(_) => app
            .path()
            .app_config_dir()
            .map_err(|e| AppError::Io(e.to_string()))?,
    };
    Ok(dir.join("clipper.json"))
}

pub fn manage(app: &AppHandle) {
    let path = match config_path(app) {
        Ok(p) => p,
        Err(e) => {
            eprintln!("web clipper disabled: {e}");
            return;
        }
    };
    let vault_app = app.clone();
    let event_app = app.clone();
    let clipper = Arc::new(Clipper::new(
        path,
        move || vault_app.state::<AppState>().current().ok(),
        move |path, title| {
            let _ = event_app.emit(
                CLIP_EVENT,
                ClippedPayload {
                    path: path.into(),
                    title: title.into(),
                },
            );
        },
    ));
    match std::env::var(PORT_ENV).ok().and_then(|p| p.parse().ok()) {
        Some(port) => clipper.start_on(port),
        None => clipper.start(),
    }
    app.manage(ClipperState(clipper));
}

#[tauri::command]
pub fn clipper_status(c: State<ClipperState>) -> ClipperStatus {
    c.0.status()
}

#[tauri::command]
pub fn clipper_set_enabled(c: State<ClipperState>, enabled: bool) -> AppResult<ClipperStatus> {
    c.0.set_enabled(enabled)?;
    Ok(c.0.status())
}

#[tauri::command]
pub fn clipper_set_folder(c: State<ClipperState>, folder: String) -> AppResult<ClipperStatus> {
    c.0.set_folder(&folder)?;
    Ok(c.0.status())
}

#[tauri::command]
pub fn clipper_start_pairing(c: State<ClipperState>) -> PairingCode {
    c.0.start_pairing()
}

#[tauri::command]
pub fn clipper_cancel_pairing(c: State<ClipperState>) {
    c.0.cancel_pairing()
}

#[tauri::command]
pub fn clipper_revoke(c: State<ClipperState>, id: String) -> AppResult<ClipperStatus> {
    c.0.revoke(&id)?;
    Ok(c.0.status())
}
