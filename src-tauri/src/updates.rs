//! Updates from a folder (T-066).
//!
//! A release is published by `scripts/publish-update.ps1`, which copies the installer into the
//! updates folder next to a `latest.json`:
//!
//! ```json
//! { "version": "0.2.0", "notes": "…", "pubDate": "2026-10-07T10:00:00Z",
//!   "platforms": { "windows-x86_64": { "file": "AXISNotes_0.2.0_x64-setup.exe",
//!                                      "sha256": "…" } } }
//! ```
//!
//! The app reads it, offers anything newer than itself, and before running an installer
//! copies it out of the folder and checks its SHA-256 against the manifest.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

pub const MANIFEST: &str = "latest.json";

/// Device-local update settings (`updates.json` in the app's settings folder).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct UpdateSettings {
    /// Look for a newer version each time the app starts.
    pub check_on_launch: bool,
    /// Install what the launch check finds without asking. On by default, including for
    /// settings saved before this option existed (a missing field takes the default).
    pub auto_install: bool,
    /// The updates folder; `None` uses the default.
    pub folder: Option<String>,
}

impl Default for UpdateSettings {
    fn default() -> Self {
        Self {
            check_on_launch: true,
            auto_install: true,
            folder: None,
        }
    }
}

impl UpdateSettings {
    /// Missing or unreadable settings fall back to the defaults.
    pub fn load(path: &Path) -> Self {
        fs::read_to_string(path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    }

    pub fn save(&self, path: &Path) -> AppResult<()> {
        if let Some(dir) = path.parent() {
            fs::create_dir_all(dir)?;
        }
        let json = serde_json::to_string_pretty(self).map_err(|e| AppError::Io(e.to_string()))?;
        fs::write(path, json)?;
        Ok(())
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Manifest {
    version: String,
    #[serde(default)]
    notes: String,
    #[serde(default)]
    pub_date: Option<String>,
    #[serde(default)]
    platforms: HashMap<String, Asset>,
}

#[derive(Debug, Deserialize)]
struct Asset {
    file: String,
    sha256: String,
}

/// A newer version that can be installed.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Available {
    pub version: String,
    pub notes: String,
    pub pub_date: Option<String>,
    /// The installer's file name inside the updates folder.
    pub file: String,
    #[serde(skip)]
    sha256: String,
}

/// The manifest key for this build, e.g. `windows-x86_64`.
pub fn platform() -> String {
    format!("{}-{}", std::env::consts::OS, std::env::consts::ARCH)
}

fn parse_version(v: &str, what: &str) -> AppResult<semver::Version> {
    semver::Version::parse(v.trim().trim_start_matches('v'))
        .map_err(|_| AppError::Io(format!("{what} has an invalid version: “{v}”")))
}

/// What the updates folder offers for `platform`, if it is newer than `current`.
/// A folder or manifest that doesn't exist yet means there is nothing to install.
pub fn check(folder: &Path, current: &str, platform: &str) -> AppResult<Option<Available>> {
    let text = match fs::read_to_string(folder.join(MANIFEST)) {
        Ok(t) => t,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e.into()),
    };
    // Tolerate a byte-order mark (Windows PowerShell 5.1 writes one by default).
    let manifest: Manifest = serde_json::from_str(text.trim_start_matches('\u{feff}'))
        .map_err(|e| AppError::Io(format!("{MANIFEST} in the updates folder is invalid: {e}")))?;
    let latest = parse_version(&manifest.version, MANIFEST)?;
    if latest <= parse_version(current, "This app")? {
        return Ok(None);
    }
    let asset = manifest.platforms.get(platform).ok_or_else(|| {
        AppError::NotFound(format!(
            "an installer for {platform} in AXISNotes {}",
            manifest.version
        ))
    })?;
    // Only a plain file name inside the folder, never a path elsewhere.
    let name = Path::new(&asset.file);
    if asset.file.is_empty()
        || name.components().count() != 1
        || name
            .file_name()
            .map(|n| n != name.as_os_str())
            .unwrap_or(true)
    {
        return Err(AppError::InvalidName(asset.file.clone()));
    }
    if !folder.join(&asset.file).is_file() {
        return Err(AppError::NotFound(format!(
            "{} in the updates folder",
            asset.file
        )));
    }
    Ok(Some(Available {
        version: latest.to_string(),
        notes: manifest.notes,
        pub_date: manifest.pub_date,
        file: asset.file.clone(),
        sha256: asset.sha256.trim().to_ascii_lowercase(),
    }))
}

fn sha256_hex(path: &Path) -> AppResult<String> {
    use std::io::Read;
    let mut file = fs::File::open(path)?;
    let mut ctx = ring::digest::Context::new(&ring::digest::SHA256);
    let mut buf = vec![0; 1 << 16];
    loop {
        let n = file.read(&mut buf)?;
        if n == 0 {
            break;
        }
        ctx.update(&buf[..n]);
    }
    Ok(ctx
        .finish()
        .as_ref()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect())
}

/// Clears out the staging folder: installers from earlier updates, and the files 0.3.20–
/// 0.3.22 left there for their update window. Anything that can't be removed (in use, or
/// held by antivirus software) is left alone.
pub fn tidy_staging(staging: &Path) {
    let Ok(entries) = fs::read_dir(staging) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let _ = if path.is_dir() {
            fs::remove_dir_all(&path)
        } else {
            fs::remove_file(&path)
        };
    }
}

/// Copies the installer for `version` into `staging` and checks it against the manifest.
/// Returns the verified copy, which is the file to run. Checking the copy (not the
/// original) means a file changed in the folder after the check is never run.
pub fn prepare(
    folder: &Path,
    current: &str,
    platform: &str,
    version: &str,
    staging: &Path,
) -> AppResult<PathBuf> {
    let update = check(folder, current, platform)?
        .ok_or_else(|| AppError::NotFound("a newer version in the updates folder".into()))?;
    if update.version != parse_version(version, "The requested update")?.to_string() {
        return Err(AppError::Conflict(format!(
            "the updates folder now offers {} instead of {version}",
            update.version
        )));
    }
    fs::create_dir_all(staging)?;
    let copy = staging.join(&update.file);
    fs::copy(folder.join(&update.file), &copy)?;
    if sha256_hex(&copy)? != update.sha256 {
        let _ = fs::remove_file(&copy);
        return Err(AppError::Io(format!(
            "{} doesn’t match the checksum in {MANIFEST}, so it was not installed",
            update.file
        )));
    }
    Ok(copy)
}

#[cfg(test)]
mod tests {
    use super::*;

    const PLATFORM: &str = "windows-x86_64";

    fn publish(dir: &Path, version: &str, file: &str, contents: &[u8], sha: Option<&str>) {
        fs::write(dir.join(file), contents).unwrap();
        let sha = match sha {
            Some(s) => s.to_string(),
            None => sha256_hex(&dir.join(file)).unwrap(),
        };
        let manifest = serde_json::json!({
            "version": version,
            "notes": "New things",
            "platforms": { PLATFORM: { "file": file, "sha256": sha } },
        });
        fs::write(dir.join(MANIFEST), manifest.to_string()).unwrap();
    }

    #[test]
    fn nothing_to_do_without_a_folder_or_manifest() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(check(dir.path(), "0.1.0", PLATFORM).unwrap(), None);
        assert_eq!(
            check(&dir.path().join("missing"), "0.1.0", PLATFORM).unwrap(),
            None
        );
    }

    #[test]
    fn offers_only_newer_versions() {
        let dir = tempfile::tempdir().unwrap();
        publish(dir.path(), "0.2.0", "setup.exe", b"installer", None);
        let found = check(dir.path(), "0.1.0", PLATFORM).unwrap().unwrap();
        assert_eq!(found.version, "0.2.0");
        assert_eq!(found.notes, "New things");
        assert_eq!(found.file, "setup.exe");
        assert_eq!(check(dir.path(), "0.2.0", PLATFORM).unwrap(), None);
        assert_eq!(check(dir.path(), "0.10.0", PLATFORM).unwrap(), None);
        // Versions compare as numbers, not text, and a leading "v" is allowed.
        publish(dir.path(), "v0.10.0", "setup.exe", b"installer", None);
        assert!(check(dir.path(), "0.9.0", PLATFORM).unwrap().is_some());
        // A manifest saved with a byte-order mark still reads.
        let text = fs::read_to_string(dir.path().join(MANIFEST)).unwrap();
        fs::write(dir.path().join(MANIFEST), format!("\u{feff}{text}")).unwrap();
        assert!(check(dir.path(), "0.9.0", PLATFORM).unwrap().is_some());
    }

    #[test]
    fn a_missing_platform_or_installer_is_an_error() {
        let dir = tempfile::tempdir().unwrap();
        publish(dir.path(), "0.2.0", "setup.exe", b"installer", None);
        assert!(check(dir.path(), "0.1.0", "linux-x86_64").is_err());
        fs::remove_file(dir.path().join("setup.exe")).unwrap();
        assert!(check(dir.path(), "0.1.0", PLATFORM).is_err());
    }

    #[test]
    fn rejects_paths_outside_the_folder() {
        let dir = tempfile::tempdir().unwrap();
        for file in [
            "../evil.exe",
            "sub/setup.exe",
            "sub\\setup.exe",
            "C:\\evil.exe",
            "",
        ] {
            let manifest = serde_json::json!({
                "version": "0.2.0",
                "platforms": { PLATFORM: { "file": file, "sha256": "00" } },
            });
            fs::write(dir.path().join(MANIFEST), manifest.to_string()).unwrap();
            let err = check(dir.path(), "0.1.0", PLATFORM).unwrap_err();
            assert!(
                matches!(err, AppError::InvalidName(_) | AppError::NotFound(_)),
                "{file}: {err:?}"
            );
        }
    }

    #[test]
    fn invalid_manifests_are_reported() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join(MANIFEST), "{ not json").unwrap();
        assert!(check(dir.path(), "0.1.0", PLATFORM).is_err());
        fs::write(dir.path().join(MANIFEST), r#"{"version":"soon"}"#).unwrap();
        assert!(check(dir.path(), "0.1.0", PLATFORM).is_err());
    }

    #[test]
    fn tidy_staging_clears_old_downloads() {
        let staging = tempfile::tempdir().unwrap();
        fs::write(staging.path().join("AXISNotes_0.1.0_x64-setup.exe"), b"old").unwrap();
        fs::write(staging.path().join("update-job.json"), b"{}").unwrap();
        fs::create_dir(staging.path().join("updater-webview")).unwrap();
        fs::write(staging.path().join("updater-webview").join("x"), b"x").unwrap();
        tidy_staging(staging.path());
        assert_eq!(fs::read_dir(staging.path()).unwrap().count(), 0);
        // A folder that doesn't exist yet is fine.
        tidy_staging(&staging.path().join("missing"));
    }

    #[test]
    fn prepare_copies_and_verifies_the_installer() {
        let dir = tempfile::tempdir().unwrap();
        let staging = tempfile::tempdir().unwrap();
        publish(dir.path(), "0.2.0", "setup.exe", b"installer", None);
        let copy = prepare(dir.path(), "0.1.0", PLATFORM, "0.2.0", staging.path()).unwrap();
        assert_eq!(copy, staging.path().join("setup.exe"));
        assert_eq!(fs::read(copy).unwrap(), b"installer");
    }

    #[test]
    fn prepare_refuses_a_changed_installer() {
        let dir = tempfile::tempdir().unwrap();
        let staging = tempfile::tempdir().unwrap();
        publish(
            dir.path(),
            "0.2.0",
            "setup.exe",
            b"tampered",
            Some(&"ab".repeat(32)),
        );
        let err = prepare(dir.path(), "0.1.0", PLATFORM, "0.2.0", staging.path()).unwrap_err();
        assert!(err.to_string().contains("checksum"), "{err}");
        assert!(!staging.path().join("setup.exe").exists());
    }

    #[test]
    fn prepare_refuses_a_different_version_than_was_offered() {
        let dir = tempfile::tempdir().unwrap();
        let staging = tempfile::tempdir().unwrap();
        publish(dir.path(), "0.3.0", "setup.exe", b"installer", None);
        let err = prepare(dir.path(), "0.1.0", PLATFORM, "0.2.0", staging.path()).unwrap_err();
        assert!(matches!(err, AppError::Conflict(_)), "{err:?}");
    }

    #[test]
    fn settings_default_and_round_trip() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("sub/updates.json");
        assert_eq!(UpdateSettings::load(&path), UpdateSettings::default());
        assert!(UpdateSettings::default().check_on_launch);
        assert!(UpdateSettings::default().auto_install);
        let s = UpdateSettings {
            check_on_launch: false,
            auto_install: false,
            folder: Some("D:\\Builds".into()),
        };
        s.save(&path).unwrap();
        assert_eq!(UpdateSettings::load(&path), s);
        fs::write(&path, "garbage").unwrap();
        assert_eq!(UpdateSettings::load(&path), UpdateSettings::default());
    }

    #[test]
    fn settings_saved_before_auto_install_existed_turn_it_on() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("updates.json");
        fs::write(
            &path,
            r#"{ "checkOnLaunch": false, "folder": "D:/Builds" }"#,
        )
        .unwrap();
        let s = UpdateSettings::load(&path);
        assert!(!s.check_on_launch);
        assert!(s.auto_install);
        assert_eq!(s.folder.as_deref(), Some("D:/Builds"));
    }
}
