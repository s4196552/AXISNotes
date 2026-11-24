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
//!
//! **Signed manifests (T-282).** A checksum in the same folder as the installer proves
//! nothing to someone who can write to that folder, so the script also writes
//! `latest.json.sig`: an Ed25519 signature (base64) of `latest.json`'s exact bytes, made
//! with a private key kept outside the repository. The app checks it with
//! [`UPDATE_PUBLIC_KEY`], built in. The signature covers the version, file name and SHA-256
//! together. A manifest whose signature is missing or doesn't match is still offered, marked
//! as not verified, but only for a manual install: it is never installed automatically.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use base64::Engine;
use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

pub const MANIFEST: &str = "latest.json";
pub const SIGNATURE: &str = "latest.json.sig";

/// The AXISNotes release key: base64 of the raw 32-byte Ed25519 public key whose private
/// half signs `latest.json` (`scripts/publish-update.ps1 -NewKey` made it; see
/// `.agents/handoffs/T-282.md`). Changing it means installed apps stop verifying releases
/// signed with the old key.
pub const UPDATE_PUBLIC_KEY: &str = "EaALuC1U5QEDFOpDXUIrQM9iPSdCDTvg8m+jehtu15w=";

/// The built-in release key's bytes. An unparseable constant yields an empty key, which
/// verifies nothing (fails closed).
pub fn release_key() -> Vec<u8> {
    base64::engine::general_purpose::STANDARD
        .decode(UPDATE_PUBLIC_KEY)
        .unwrap_or_default()
}

/// Device-local update settings (`updates.json` in the app's settings folder).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct UpdateSettings {
    /// Look for a newer version each time the app starts.
    pub check_on_launch: bool,
    /// Install what the launch check finds without asking. On by default, including for
    /// settings saved before this option existed (a missing field takes the default).
    /// It applies only to updates whose manifest is signed by the release key (T-282).
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
    /// The manifest is signed by the AXISNotes release key. Only a verified update is
    /// installed without the user asking for it.
    pub verified: bool,
    /// Why it isn't verified, e.g. no signature file; `None` when verified.
    pub unverified_reason: Option<String>,
    #[serde(skip)]
    sha256: String,
}

/// Checks `latest.json.sig` against `manifest` (the bytes as read) and `key`. The error is
/// a short reason for the user.
fn verify_manifest(folder: &Path, manifest: &[u8], key: &[u8]) -> Result<(), String> {
    let text = match fs::read_to_string(folder.join(SIGNATURE)) {
        Ok(t) => t,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Err(format!(
                "The updates folder has no signature ({SIGNATURE})."
            ))
        }
        Err(e) => return Err(format!("Its signature couldn’t be read: {e}")),
    };
    let signature = base64::engine::general_purpose::STANDARD
        .decode(text.trim_start_matches('\u{feff}').trim())
        .map_err(|_| format!("{SIGNATURE} isn’t a valid signature."))?;
    ring::signature::UnparsedPublicKey::new(&ring::signature::ED25519, key)
        .verify(manifest, &signature)
        .map_err(|_| {
            format!("{MANIFEST} isn’t signed by the AXISNotes release key, or was changed after signing.")
        })
}

/// The manifest key for this build, e.g. `windows-x86_64`.
pub fn platform() -> String {
    format!("{}-{}", std::env::consts::OS, std::env::consts::ARCH)
}

fn parse_version(v: &str, what: &str) -> AppResult<semver::Version> {
    semver::Version::parse(v.trim().trim_start_matches('v'))
        .map_err(|_| AppError::Io(format!("{what} has an invalid version: “{v}”")))
}

/// What the updates folder offers for `platform`, if it is newer than `current`, and
/// whether its manifest is signed with `key` (normally [`release_key`]).
/// A folder or manifest that doesn't exist yet means there is nothing to install.
pub fn check(
    folder: &Path,
    current: &str,
    platform: &str,
    key: &[u8],
) -> AppResult<Option<Available>> {
    // The bytes are read once: the signature is checked over exactly what is parsed.
    let bytes = match fs::read(folder.join(MANIFEST)) {
        Ok(b) => b,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e.into()),
    };
    let text = std::str::from_utf8(&bytes)
        .map_err(|_| AppError::Io(format!("{MANIFEST} in the updates folder isn’t UTF-8 text")))?;
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
    let unverified_reason = verify_manifest(folder, &bytes, key).err();
    Ok(Some(Available {
        version: latest.to_string(),
        notes: manifest.notes,
        pub_date: manifest.pub_date,
        file: asset.file.clone(),
        verified: unverified_reason.is_none(),
        unverified_reason,
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
///
/// The manifest is read and its signature checked again here. An unverified manifest is
/// refused unless `allow_unverified` (the user chose to install one shown as not verified).
pub fn prepare(
    folder: &Path,
    current: &str,
    platform: &str,
    version: &str,
    staging: &Path,
    key: &[u8],
    allow_unverified: bool,
) -> AppResult<PathBuf> {
    let update = check(folder, current, platform, key)?
        .ok_or_else(|| AppError::NotFound("a newer version in the updates folder".into()))?;
    if update.version != parse_version(version, "The requested update")?.to_string() {
        return Err(AppError::Conflict(format!(
            "the updates folder now offers {} instead of {version}",
            update.version
        )));
    }
    if !update.verified && !allow_unverified {
        return Err(AppError::Io(format!(
            "AXISNotes {} wasn’t installed because it isn’t verified. {}",
            update.version,
            update.unverified_reason.as_deref().unwrap_or_default()
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
    use std::sync::LazyLock;

    use ring::signature::{Ed25519KeyPair, KeyPair};

    use super::*;

    const PLATFORM: &str = "windows-x86_64";

    fn new_key() -> Ed25519KeyPair {
        let rng = ring::rand::SystemRandom::new();
        let pkcs8 = Ed25519KeyPair::generate_pkcs8(&rng).unwrap();
        Ed25519KeyPair::from_pkcs8(pkcs8.as_ref()).unwrap()
    }

    /// Stands in for the release key in these tests.
    static KEY: LazyLock<Ed25519KeyPair> = LazyLock::new(new_key);

    fn public() -> Vec<u8> {
        KEY.public_key().as_ref().to_vec()
    }

    /// Signs `latest.json` as it is on disk now, like `publish-update.ps1` does.
    fn sign_with(dir: &Path, key: &Ed25519KeyPair) {
        let bytes = fs::read(dir.join(MANIFEST)).unwrap();
        let sig = base64::engine::general_purpose::STANDARD.encode(key.sign(&bytes).as_ref());
        fs::write(dir.join(SIGNATURE), format!("{sig}\n")).unwrap();
    }

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
        sign_with(dir, &KEY);
    }

    fn check_signed(dir: &Path, current: &str) -> Option<Available> {
        check(dir, current, PLATFORM, &public()).unwrap()
    }

    /// Edits the published manifest's text without signing it again.
    fn tamper(dir: &Path, from: &str, to: &str) {
        let text = fs::read_to_string(dir.join(MANIFEST)).unwrap();
        assert!(text.contains(from), "{text}");
        fs::write(dir.join(MANIFEST), text.replacen(from, to, 1)).unwrap();
    }

    #[test]
    fn nothing_to_do_without_a_folder_or_manifest() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(check_signed(dir.path(), "0.1.0"), None);
        assert_eq!(check_signed(&dir.path().join("missing"), "0.1.0"), None);
    }

    #[test]
    fn offers_only_newer_versions() {
        let dir = tempfile::tempdir().unwrap();
        publish(dir.path(), "0.2.0", "setup.exe", b"installer", None);
        let found = check_signed(dir.path(), "0.1.0").unwrap();
        assert_eq!(found.version, "0.2.0");
        assert_eq!(found.notes, "New things");
        assert_eq!(found.file, "setup.exe");
        assert_eq!(check_signed(dir.path(), "0.2.0"), None);
        assert_eq!(check_signed(dir.path(), "0.10.0"), None);
        // Versions compare as numbers, not text, and a leading "v" is allowed.
        publish(dir.path(), "v0.10.0", "setup.exe", b"installer", None);
        assert!(check_signed(dir.path(), "0.9.0").is_some());
        // A manifest saved with a byte-order mark still reads, and its signature covers
        // the mark too.
        let text = fs::read_to_string(dir.path().join(MANIFEST)).unwrap();
        fs::write(dir.path().join(MANIFEST), format!("\u{feff}{text}")).unwrap();
        assert!(!check_signed(dir.path(), "0.9.0").unwrap().verified);
        sign_with(dir.path(), &KEY);
        assert!(check_signed(dir.path(), "0.9.0").unwrap().verified);
    }

    #[test]
    fn a_missing_platform_or_installer_is_an_error() {
        let dir = tempfile::tempdir().unwrap();
        publish(dir.path(), "0.2.0", "setup.exe", b"installer", None);
        assert!(check(dir.path(), "0.1.0", "linux-x86_64", &public()).is_err());
        fs::remove_file(dir.path().join("setup.exe")).unwrap();
        assert!(check(dir.path(), "0.1.0", PLATFORM, &public()).is_err());
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
            // Even a correctly signed manifest can't point outside the folder.
            sign_with(dir.path(), &KEY);
            let err = check(dir.path(), "0.1.0", PLATFORM, &public()).unwrap_err();
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
        assert!(check(dir.path(), "0.1.0", PLATFORM, &public()).is_err());
        fs::write(dir.path().join(MANIFEST), r#"{"version":"soon"}"#).unwrap();
        assert!(check(dir.path(), "0.1.0", PLATFORM, &public()).is_err());
        fs::write(dir.path().join(MANIFEST), b"{\"version\":\"0.2.0\xff\"}").unwrap();
        assert!(check(dir.path(), "0.1.0", PLATFORM, &public()).is_err());
    }

    // ---- Signatures (T-282) ----

    #[test]
    fn a_signed_manifest_is_verified() {
        let dir = tempfile::tempdir().unwrap();
        publish(dir.path(), "0.2.0", "setup.exe", b"installer", None);
        let found = check_signed(dir.path(), "0.1.0").unwrap();
        assert!(found.verified);
        assert_eq!(found.unverified_reason, None);
    }

    #[test]
    fn a_tampered_version_is_not_verified() {
        let dir = tempfile::tempdir().unwrap();
        publish(dir.path(), "0.2.0", "setup.exe", b"installer", None);
        tamper(dir.path(), "0.2.0", "0.9.0");
        let found = check_signed(dir.path(), "0.1.0").unwrap();
        assert_eq!(found.version, "0.9.0");
        assert!(!found.verified);
        assert!(
            found
                .unverified_reason
                .as_deref()
                .unwrap()
                .contains("release key"),
            "{found:?}"
        );
    }

    #[test]
    fn a_tampered_hash_is_not_verified() {
        let dir = tempfile::tempdir().unwrap();
        publish(dir.path(), "0.2.0", "setup.exe", b"installer", None);
        let good = sha256_hex(&dir.path().join("setup.exe")).unwrap();
        // Someone swaps in another installer and changes the checksum to match it.
        fs::write(dir.path().join("setup.exe"), b"evil").unwrap();
        let evil = sha256_hex(&dir.path().join("setup.exe")).unwrap();
        tamper(dir.path(), &good, &evil);
        let found = check_signed(dir.path(), "0.1.0").unwrap();
        assert!(!found.verified);
        // So it isn't installed without the user asking, though its checksum matches.
        let staging = tempfile::tempdir().unwrap();
        assert!(prepare_signed(dir.path(), "0.2.0", staging.path()).is_err());
        assert!(!staging.path().join("setup.exe").exists());
    }

    #[test]
    fn a_missing_signature_is_not_verified() {
        let dir = tempfile::tempdir().unwrap();
        publish(dir.path(), "0.2.0", "setup.exe", b"installer", None);
        fs::remove_file(dir.path().join(SIGNATURE)).unwrap();
        let found = check_signed(dir.path(), "0.1.0").unwrap();
        assert!(!found.verified);
        assert!(
            found
                .unverified_reason
                .as_deref()
                .unwrap()
                .contains("no signature"),
            "{found:?}"
        );
    }

    #[test]
    fn a_garbled_signature_is_not_verified() {
        let dir = tempfile::tempdir().unwrap();
        publish(dir.path(), "0.2.0", "setup.exe", b"installer", None);
        for sig in ["not base64!", "", "AAAA"] {
            fs::write(dir.path().join(SIGNATURE), sig).unwrap();
            assert!(
                !check_signed(dir.path(), "0.1.0").unwrap().verified,
                "{sig}"
            );
        }
    }

    #[test]
    fn a_signature_from_another_key_is_not_verified() {
        let dir = tempfile::tempdir().unwrap();
        publish(dir.path(), "0.2.0", "setup.exe", b"installer", None);
        sign_with(dir.path(), &new_key());
        assert!(!check_signed(dir.path(), "0.1.0").unwrap().verified);
        // Nor does a correct signature verify against a different (or empty) trusted key.
        sign_with(dir.path(), &KEY);
        let other = new_key().public_key().as_ref().to_vec();
        for key in [other, Vec::new()] {
            let found = check(dir.path(), "0.1.0", PLATFORM, &key).unwrap().unwrap();
            assert!(!found.verified);
        }
    }

    #[test]
    fn verifies_a_signature_made_by_the_publish_script() {
        // Made with `node scripts/update-signing.mjs sign` and a throwaway key, so the
        // script's signatures and the app's check agree.
        let dir = tempfile::tempdir().unwrap();
        let manifest = r#"{"version":"0.2.0","platforms":{"windows-x86_64":{"file":"setup.exe","sha256":"abc"}}}"#;
        fs::write(dir.path().join(MANIFEST), manifest).unwrap();
        fs::write(dir.path().join("setup.exe"), b"x").unwrap();
        fs::write(
            dir.path().join(SIGNATURE),
            "YCYJSUT2uoh1QJZtUStJF3tu+j5UXzoVXRy8dqeDHvgrOt12OGVebVC5IQnjVLVTBPN5hZHn5Y99CWMiIxOnBg==\n",
        )
        .unwrap();
        let key = base64::engine::general_purpose::STANDARD
            .decode("inhjWbcpVRArRUmpANSKzNcn+MOs4Zh1uTrRcZXdvmY=")
            .unwrap();
        let found = check(dir.path(), "0.1.0", PLATFORM, &key).unwrap().unwrap();
        assert!(found.verified, "{found:?}");
        // The built-in key is a well-formed Ed25519 public key, and isn't this test key.
        assert_eq!(release_key().len(), 32);
        assert_ne!(release_key(), key);
    }

    // ---- Installing ----

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

    fn prepare_signed(dir: &Path, version: &str, staging: &Path) -> AppResult<PathBuf> {
        prepare(dir, "0.1.0", PLATFORM, version, staging, &public(), false)
    }

    #[test]
    fn prepare_copies_and_verifies_the_installer() {
        let dir = tempfile::tempdir().unwrap();
        let staging = tempfile::tempdir().unwrap();
        publish(dir.path(), "0.2.0", "setup.exe", b"installer", None);
        let copy = prepare_signed(dir.path(), "0.2.0", staging.path()).unwrap();
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
        let err = prepare_signed(dir.path(), "0.2.0", staging.path()).unwrap_err();
        assert!(err.to_string().contains("checksum"), "{err}");
        assert!(!staging.path().join("setup.exe").exists());
    }

    #[test]
    fn prepare_refuses_a_different_version_than_was_offered() {
        let dir = tempfile::tempdir().unwrap();
        let staging = tempfile::tempdir().unwrap();
        publish(dir.path(), "0.3.0", "setup.exe", b"installer", None);
        let err = prepare_signed(dir.path(), "0.2.0", staging.path()).unwrap_err();
        assert!(matches!(err, AppError::Conflict(_)), "{err:?}");
    }

    #[test]
    fn prepare_installs_an_unverified_update_only_when_asked() {
        let dir = tempfile::tempdir().unwrap();
        let staging = tempfile::tempdir().unwrap();
        publish(dir.path(), "0.2.0", "setup.exe", b"installer", None);
        fs::remove_file(dir.path().join(SIGNATURE)).unwrap();
        let err = prepare_signed(dir.path(), "0.2.0", staging.path()).unwrap_err();
        assert!(err.to_string().contains("isn’t verified"), "{err}");
        assert!(!staging.path().join("setup.exe").exists());
        // The user chose to install it anyway: the checksum is still checked.
        let copy = prepare(
            dir.path(),
            "0.1.0",
            PLATFORM,
            "0.2.0",
            staging.path(),
            &public(),
            true,
        )
        .unwrap();
        assert_eq!(fs::read(copy).unwrap(), b"installer");
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
