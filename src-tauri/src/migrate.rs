//! The app was renamed from AXIS to AXISNotes, and its bundle identifier changed with it.
//! The OS folders the app keeps its settings in are named after the identifier: AI settings,
//! paired browsers, the request log, and the webview's storage (recent vaults). On startup,
//! before any window opens, copy each old folder to its new name if the new one doesn't
//! exist yet. The old folders are left in place as a backup.

use std::fs;
use std::path::{Path, PathBuf};

pub const IDENTIFIER: &str = "app.axis.axisnotes";
const LEGACY_IDENTIFIER: &str = "app.axis.desktop";

/// The base folders Tauri puts per-app folders in, for this OS.
fn base_dirs() -> Vec<PathBuf> {
    let env = |k: &str| std::env::var_os(k).map(PathBuf::from);
    let home = env("HOME").or_else(|| env("USERPROFILE"));
    let mut out = Vec::new();
    if cfg!(windows) {
        out.extend(env("APPDATA")); // config and data
        out.extend(env("LOCALAPPDATA")); // local data, including the WebView2 profile
    } else if cfg!(target_os = "macos") {
        if let Some(h) = home {
            out.push(h.join("Library/Application Support"));
            out.push(h.join("Library/WebKit"));
            out.push(h.join("Library/Caches"));
        }
    } else {
        out.push(
            env("XDG_CONFIG_HOME")
                .unwrap_or_else(|| home.clone().unwrap_or_default().join(".config")),
        );
        out.push(
            env("XDG_DATA_HOME").unwrap_or_else(|| home.unwrap_or_default().join(".local/share")),
        );
    }
    out
}

/// Copy `<base>/<legacy>` to `<base>/<new>` for each base folder that has only the old one.
pub fn legacy_app_dirs() {
    for base in base_dirs() {
        let (old, new) = (base.join(LEGACY_IDENTIFIER), base.join(IDENTIFIER));
        if let Err(e) = copy_if_missing(&old, &new) {
            eprintln!("couldn't carry over {}: {e}", old.display());
        }
    }
}

/// Copy the `from` tree to `to`, but only if `from` exists and `to` doesn't.
pub fn copy_if_missing(from: &Path, to: &Path) -> std::io::Result<bool> {
    if !from.is_dir() || to.exists() {
        return Ok(false);
    }
    copy_tree(from, to)?;
    Ok(true)
}

fn copy_tree(from: &Path, to: &Path) -> std::io::Result<()> {
    fs::create_dir_all(to)?;
    for entry in fs::read_dir(from)? {
        let entry = entry?;
        let target = to.join(entry.file_name());
        let kind = entry.file_type()?;
        if kind.is_dir() {
            copy_tree(&entry.path(), &target)?;
        } else if kind.is_file() {
            // A file another program holds open (a webview lock file) is skipped, not fatal.
            if let Err(e) = fs::copy(entry.path(), &target) {
                eprintln!("skipped {}: {e}", entry.path().display());
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identifier_matches_the_tauri_config() {
        let conf: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        assert_eq!(conf["identifier"], IDENTIFIER);
    }

    #[test]
    fn copies_an_old_folder_once_and_keeps_the_original() {
        let dir = tempfile::tempdir().unwrap();
        let old = dir.path().join(LEGACY_IDENTIFIER);
        fs::create_dir_all(old.join("EBWebView/Default")).unwrap();
        fs::write(old.join("ai-settings.json"), "{}").unwrap();
        fs::write(old.join("EBWebView/Default/Local State"), "x").unwrap();
        let new = dir.path().join(IDENTIFIER);

        assert!(copy_if_missing(&old, &new).unwrap());
        assert_eq!(
            fs::read_to_string(new.join("ai-settings.json")).unwrap(),
            "{}"
        );
        assert!(new.join("EBWebView/Default/Local State").is_file());
        assert!(old.join("ai-settings.json").is_file());

        // Once the new folder exists it is never overwritten.
        fs::write(new.join("ai-settings.json"), "{\"changed\":true}").unwrap();
        assert!(!copy_if_missing(&old, &new).unwrap());
        assert_eq!(
            fs::read_to_string(new.join("ai-settings.json")).unwrap(),
            "{\"changed\":true}"
        );
        // Nothing to do without an old folder.
        assert!(!copy_if_missing(&dir.path().join("missing"), &dir.path().join("x")).unwrap());
    }
}
