//! Tauri commands for updates from a folder (see `updates.rs`).

use std::path::PathBuf;

use serde::Serialize;
use tauri::{AppHandle, Manager};

use crate::error::{AppError, AppResult};
use crate::updates::{self, Available, UpdateSettings};

/// Same override as the AI and clipper settings (E2E tests use a throwaway folder). It also
/// moves the default updates folder there, so a real published update never shows in tests.
const CONFIG_DIR_ENV: &str = "AXIS_CONFIG_DIR";
/// Name of the default updates folder, in the user's home folder.
const DEFAULT_FOLDER: &str = "AXISNotes Updates";

fn config_dir(app: &AppHandle) -> AppResult<(PathBuf, bool)> {
    match std::env::var(CONFIG_DIR_ENV) {
        Ok(d) => Ok((PathBuf::from(d), true)),
        Err(_) => app
            .path()
            .app_config_dir()
            .map(|d| (d, false))
            .map_err(|e| AppError::Io(e.to_string())),
    }
}

fn settings_path(app: &AppHandle) -> AppResult<PathBuf> {
    Ok(config_dir(app)?.0.join("updates.json"))
}

fn default_folder(app: &AppHandle) -> AppResult<PathBuf> {
    let (dir, overridden) = config_dir(app)?;
    if overridden {
        return Ok(dir.join("updates"));
    }
    app.path()
        .home_dir()
        .map(|h| h.join(DEFAULT_FOLDER))
        .map_err(|e| AppError::Io(e.to_string()))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSettingsView {
    check_on_launch: bool,
    auto_install: bool,
    /// Whether this build can install updates (a release build on Windows), so the app
    /// doesn't try, and fail, to install at every start of a development build.
    can_install: bool,
    /// The folder in use: the chosen one, or the default.
    folder: String,
    default_folder: String,
    current_version: String,
}

fn view(app: &AppHandle, s: &UpdateSettings) -> AppResult<UpdateSettingsView> {
    let default = default_folder(app)?.to_string_lossy().into_owned();
    Ok(UpdateSettingsView {
        check_on_launch: s.check_on_launch,
        auto_install: s.auto_install,
        can_install: can_install(),
        folder: s.folder.clone().unwrap_or_else(|| default.clone()),
        default_folder: default,
        current_version: app.package_info().version.to_string(),
    })
}

fn folder(app: &AppHandle) -> AppResult<PathBuf> {
    match UpdateSettings::load(&settings_path(app)?).folder {
        Some(f) => Ok(PathBuf::from(f)),
        None => default_folder(app),
    }
}

/// Installing replaces the installed app, so only a release build on Windows does it.
fn can_install() -> bool {
    !cfg!(debug_assertions) && cfg!(windows)
}

#[tauri::command]
pub fn updates_settings(app: AppHandle) -> AppResult<UpdateSettingsView> {
    view(&app, &UpdateSettings::load(&settings_path(&app)?))
}

/// `folder`: an empty string goes back to the default folder.
#[tauri::command]
pub fn updates_save_settings(
    app: AppHandle,
    check_on_launch: bool,
    auto_install: bool,
    folder: String,
) -> AppResult<UpdateSettingsView> {
    let folder = folder.trim();
    let s = UpdateSettings {
        check_on_launch,
        auto_install,
        folder: (!folder.is_empty()).then(|| folder.to_string()),
    };
    s.save(&settings_path(&app)?)?;
    view(&app, &s)
}

/// A newer version in the updates folder, or `None`.
#[tauri::command]
pub fn updates_check(app: AppHandle) -> AppResult<Option<Available>> {
    updates::check(
        &folder(&app)?,
        &app.package_info().version.to_string(),
        &updates::platform(),
    )
}

/// Verifies the installer for `version`, starts it (it closes this app, installs over it
/// and reopens it) and quits.
#[tauri::command]
pub fn updates_install(app: AppHandle, version: String) -> AppResult<()> {
    if cfg!(debug_assertions) {
        return Err(AppError::Io(
            "Updates install into the installed app, not a development build.".into(),
        ));
    }
    if !cfg!(windows) {
        return Err(AppError::Io(
            "Installing updates from a folder is only supported on Windows so far.".into(),
        ));
    }
    let installer = updates::prepare(
        &folder(&app)?,
        &app.package_info().version.to_string(),
        &updates::platform(),
        &version,
        &std::env::temp_dir().join("AXISNotes-update"),
    )?;
    // The NSIS installer's own flags: passive (progress only), update mode (keeps the
    // user's shortcut choices) and relaunch when done. Arguments, never a shell string.
    std::process::Command::new(&installer)
        .args(["/P", "/UPDATE", "/R"])
        .spawn()
        .map_err(|e| AppError::Io(format!("couldn’t start the installer: {e}")))?;
    app.exit(0);
    Ok(())
}
