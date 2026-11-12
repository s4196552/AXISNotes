mod model;
mod platform;
mod store;

use model::{Library, PluginPackage, Target};
use platform::InstalledApp;
use std::path::{Path, PathBuf};
use store::Snapshot;
use tauri::{AppHandle, Manager};

fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    if let Some(config) = std::env::var_os("AXIS_CONFIG_DIR") {
        return Ok(PathBuf::from(config).join("hub"));
    }
    // The embedded plugin owns the same library as the earlier Hub preview.
    app.path()
        .local_data_dir()
        .map(|path| path.join("app.axis.axishub"))
        .map_err(|error| error.to_string())
}

async fn background<T: Send + 'static>(
    run: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(run)
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn hub_load(app: AppHandle) -> Result<Snapshot, String> {
    let path = data_dir(&app)?;
    background(move || store::read(&path)).await
}

#[tauri::command]
pub async fn hub_save(
    app: AppHandle,
    library: Library,
    revision: String,
) -> Result<String, String> {
    let path = data_dir(&app)?;
    background(move || store::save(&path, &library, &revision)).await
}

#[tauri::command]
pub async fn hub_launch(app: AppHandle, shortcut_id: String) -> Result<(), String> {
    let path = data_dir(&app)?;
    background(move || {
        let snapshot = store::read(&path)?;
        let target = snapshot
            .library
            .target(&shortcut_id)
            .ok_or("This shortcut is unavailable. Open the library again and try once more.")?;
        platform::launch(target)
    })
    .await
}

#[tauri::command]
pub async fn hub_apps() -> Result<Vec<InstalledApp>, String> {
    background(platform::discover_apps).await
}

#[tauri::command]
pub async fn hub_target_icon(target: Target) -> Result<Option<String>, String> {
    target.validate()?;
    background(move || Ok(platform::target_icon(&target))).await
}

#[tauri::command]
pub async fn hub_custom_icon(path: String) -> Result<String, String> {
    Target::Path { path: path.clone() }.validate()?;
    background(move || platform::custom_icon(Path::new(&path))).await
}

#[tauri::command]
pub fn hub_validate_plugin(contents: &str) -> Result<PluginPackage, String> {
    if contents.len() as u64 > store::MAX_BYTES {
        return Err("Plugin file exceeds 24 MiB.".into());
    }
    let package: PluginPackage = serde_json::from_str(contents.trim_start_matches('\u{feff}'))
        .map_err(|error| format!("Could not read this plugin file. {error}"))?;
    package.validate()?;
    Ok(package)
}
