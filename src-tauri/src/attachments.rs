//! Images, videos and audio embedded in notes (`![[Pasted image 20261013211845.png]]`):
//! naming them and bringing files from outside into the vault.

use std::fs;
use std::path::Path;

use crate::error::{AppError, AppResult};
use crate::vault::Vault;

/// The file types the picker offers (the ones notes show inline). Keep in step with
/// `src/lib/attachments.ts`.
pub const MEDIA_EXTS: &[&str] = &[
    "png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif", // images
    "mp4", "webm", "mov", "m4v", "ogv", // video
    "mp3", "wav", "ogg", "oga", "m4a", "flac", "opus", // audio
];

/// The vault path `dir/file_name`, or `dir/stem 1.ext`, `dir/stem 2.ext`… — the first
/// that doesn't exist yet. `dir` is a vault folder ("" for the root).
pub fn free_path(vault: &Vault, dir: &str, file_name: &str) -> AppResult<String> {
    let file_name = file_name.trim();
    if file_name.is_empty() {
        return Err(AppError::InvalidName(file_name.to_string()));
    }
    let (stem, ext) = match file_name.rsplit_once('.') {
        Some((s, e)) if !s.is_empty() => (s, Some(e)),
        _ => (file_name, None),
    };
    let dir = dir.trim_matches('/');
    for n in 0..10_000 {
        let name = match (n, ext) {
            (0, Some(e)) => format!("{stem}.{e}"),
            (0, None) => stem.to_string(),
            (n, Some(e)) => format!("{stem} {n}.{e}"),
            (n, None) => format!("{stem} {n}"),
        };
        let rel = if dir.is_empty() {
            name
        } else {
            format!("{dir}/{name}")
        };
        if !vault.resolve(&rel)?.exists() {
            return Ok(rel);
        }
    }
    Err(AppError::AlreadyExists(format!("{dir}/{file_name}")))
}

/// The vault path of `file` if it is already inside the vault (so it's linked, not copied).
pub fn in_vault(vault: &Vault, file: &Path) -> Option<String> {
    let abs = dunce::canonicalize(file).ok()?;
    vault.to_rel(&abs).filter(|rel| !rel.is_empty())
}

/// Copy `src` to the vault path `rel` (atomically: a hidden temporary file, then a rename).
pub fn copy_into(vault: &Vault, src: &Path, rel: &str) -> AppResult<()> {
    let abs = vault.resolve(rel)?;
    if let Some(parent) = abs.parent() {
        fs::create_dir_all(parent)?;
    }
    let name = abs.file_name().unwrap_or_default().to_string_lossy();
    let tmp = abs.with_file_name(format!(".{name}.axisnotes-tmp"));
    fs::copy(src, &tmp)?;
    if let Err(e) = fs::rename(&tmp, &abs) {
        let _ = fs::remove_file(&tmp);
        return Err(e.into());
    }
    Ok(())
}

/// Decode `%XX` escapes (the page sends folder and file names in headers that way).
pub fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        let hex = |b: u8| (b as char).to_digit(16);
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let (Some(h), Some(l)) = (hex(bytes[i + 1]), hex(bytes[i + 2])) {
                out.push((h * 16 + l) as u8);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn vault() -> (tempfile::TempDir, Vault) {
        let dir = tempfile::tempdir().unwrap();
        let v = Vault::open(dir.path()).unwrap();
        (dir, v)
    }

    #[test]
    fn free_names_count_up_like_obsidian() {
        let (_d, v) = vault();
        let name = "Pasted image 20261013211845.png";
        assert_eq!(free_path(&v, "", name).unwrap(), name);
        v.write_bytes(name, b"x").unwrap();
        assert_eq!(free_path(&v, "/", name).unwrap(), "Pasted image 20261013211845 1.png");
        v.write_bytes("Media/clip.mp4", b"x").unwrap();
        v.write_bytes("Media/clip 1.mp4", b"x").unwrap();
        assert_eq!(free_path(&v, "Media/", "clip.mp4").unwrap(), "Media/clip 2.mp4");
        assert_eq!(free_path(&v, "Media", "README").unwrap(), "Media/README");
        assert!(free_path(&v, "../out", "a.png").is_err());
        assert!(free_path(&v, "", "  ").is_err());
    }

    #[test]
    fn copies_outside_files_in_and_recognises_vault_files() {
        let (_d, v) = vault();
        let outside = tempfile::tempdir().unwrap();
        let src = outside.path().join("holiday.jpg");
        fs::write(&src, b"jpeg bytes").unwrap();
        assert_eq!(in_vault(&v, &src), None);
        copy_into(&v, &src, "Attachments/holiday.jpg").unwrap();
        let copied = v.resolve("Attachments/holiday.jpg").unwrap();
        assert_eq!(fs::read(&copied).unwrap(), b"jpeg bytes");
        assert_eq!(
            in_vault(&v, &copied).as_deref(),
            Some("Attachments/holiday.jpg")
        );
        // No temporary file is left behind.
        let left: Vec<_> = fs::read_dir(copied.parent().unwrap()).unwrap().collect();
        assert_eq!(left.len(), 1);
    }

    #[test]
    fn decodes_percent_escapes() {
        assert_eq!(percent_decode("Pasted%20image%20%C3%A9.png"), "Pasted image é.png");
        assert_eq!(percent_decode("100%"), "100%");
        assert_eq!(percent_decode("%zz%4"), "%zz%4");
    }
}
