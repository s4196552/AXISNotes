use super::model::Target;
use serde::Serialize;
#[cfg(not(windows))]
use std::path::Path;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledApp {
    pub name: String,
    pub target: Target,
    pub icon: Option<String>,
}

#[cfg(windows)]
mod windows;

#[cfg(windows)]
pub use windows::{custom_icon, discover_apps, launch, target_icon};

#[cfg(not(windows))]
pub fn discover_apps() -> Result<Vec<InstalledApp>, String> {
    Err("Installed app discovery is available on Windows.".into())
}

#[cfg(not(windows))]
pub fn target_icon(_target: &Target) -> Option<String> {
    None
}

#[cfg(not(windows))]
pub fn custom_icon(_path: &Path) -> Result<String, String> {
    Err("Custom icon import is available on Windows.".into())
}

#[cfg(not(windows))]
pub fn launch(_target: &Target) -> Result<(), String> {
    Err("Opening shortcuts is available on Windows.".into())
}
