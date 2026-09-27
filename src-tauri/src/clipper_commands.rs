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

/// Where the browser extension is: bundled with the installed app, or the source folder
/// (`extension/`) in development builds.
fn extension_dir(app: &AppHandle) -> Option<PathBuf> {
    let bundled = app.path().resource_dir().ok()?.join("extension");
    if bundled.join("manifest.json").is_file() {
        return Some(dunce::simplified(&bundled).to_path_buf());
    }
    let source = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../extension");
    (cfg!(debug_assertions) && source.join("manifest.json").is_file())
        .then(|| dunce::canonicalize(&source).unwrap_or(source))
}

/// Opens the extension's folder in the system file manager (for "Load unpacked") and
/// returns its path.
#[tauri::command]
pub fn clipper_open_extension_folder(app: AppHandle) -> AppResult<String> {
    let dir = extension_dir(&app)
        .ok_or_else(|| AppError::NotFound("the browser extension folder".into()))?;
    let opener = if cfg!(windows) {
        "explorer"
    } else if cfg!(target_os = "macos") {
        "open"
    } else {
        "xdg-open"
    };
    let mut child = std::process::Command::new(opener)
        .arg(&dir)
        .spawn()
        .map_err(|e| AppError::Io(format!("couldn't open {}: {e}", dir.display())))?;
    std::thread::spawn(move || child.wait());
    Ok(dir.to_string_lossy().into_owned())
}
