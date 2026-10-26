//! Images, videos and audio embedded in notes (`![[Pasted image 20261013211845.png]]`):
//! naming them and bringing files from outside into the vault.

use std::fs;
use std::io;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};

use crate::error::{AppError, AppResult};
use crate::vault::{validate_name, Vault};

/// The file types the picker offers (the ones notes show inline). Keep in step with
/// `src/lib/attachments.ts`.
pub const MEDIA_EXTS: &[&str] = &[
    "png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif", // images
    "mp4", "webm", "mov", "m4v", "ogv", // video
    "mp3", "wav", "ogg", "oga", "m4a", "flac", "opus", // audio
];

/// Claim the vault path `dir/file_name`, or `dir/stem 1.ext`, `dir/stem 2.ext`… — the
/// first free one, created empty in a single step (`create_new`), so two imports running
/// at once never get the same file. `dir` is a vault folder ("" for the root). Fill it
/// with `fill`.
pub fn reserve(vault: &Vault, dir: &str, file_name: &str) -> AppResult<String> {
    let file_name = file_name.trim();
    validate_name(file_name)?;
    let (stem, ext) = match file_name.rsplit_once('.') {
        Some((s, e)) if !s.is_empty() => (s, Some(e)),
        _ => (file_name, None),
    };
    let dir = dir.trim_matches('/');
    fs::create_dir_all(vault.resolve(dir)?)?;
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
        match fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(vault.resolve(&rel)?)
        {
            Ok(_) => return Ok(rel),
            Err(e) if e.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(e.into()),
        }
    }
    Err(AppError::AlreadyExists(format!("{dir}/{file_name}")))
}

/// Fill the file `reserve` claimed at `rel`: `write` puts the content in a temporary file
/// of this call's own, which then replaces the empty reservation. If anything fails, both
/// are removed, so no empty or half-written attachment is left behind.
pub fn fill(
    vault: &Vault,
    rel: &str,
    write: impl FnOnce(&Path) -> io::Result<()>,
) -> AppResult<()> {
    static NEXT: AtomicU64 = AtomicU64::new(0);
    let abs = vault.resolve(rel)?;
    let name = abs.file_name().unwrap_or_default().to_string_lossy();
    let tmp = abs.with_file_name(format!(
        ".{name}.{}-{}.axisnotes-tmp",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    ));
    if let Err(e) = write(&tmp).and_then(|()| fs::rename(&tmp, &abs)) {
        let _ = fs::remove_file(&tmp);
        let _ = fs::remove_file(&abs);
        return Err(e.into());
    }
    Ok(())
}

/// The vault path of `file` if it is already inside the vault (so it's linked, not copied).
pub fn in_vault(vault: &Vault, file: &Path) -> Option<String> {
    let abs = dunce::canonicalize(file).ok()?;
    vault.to_rel(&abs).filter(|rel| !rel.is_empty())
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
    fn names_count_up_like_obsidian() {
        let (_d, v) = vault();
        let name = "Pasted image 20261013211845.png";
        assert_eq!(reserve(&v, "", name).unwrap(), name);
        assert_eq!(
            reserve(&v, "/", name).unwrap(),
            "Pasted image 20261013211845 1.png"
        );
        assert_eq!(reserve(&v, "Media/", "clip.mp4").unwrap(), "Media/clip.mp4");
        assert_eq!(
            reserve(&v, "Media", "clip.mp4").unwrap(),
            "Media/clip 1.mp4"
        );
        assert_eq!(reserve(&v, "Media", "README").unwrap(), "Media/README");
        assert!(reserve(&v, "../out", "a.png").is_err());
        assert!(reserve(&v, "", "  ").is_err());
        assert!(reserve(&v, "", "a:b.png").is_err());
    }

    #[test]
    fn imports_at_the_same_time_never_share_a_file() {
        let (_d, v) = vault();
        let names: Vec<String> = std::thread::scope(|s| {
            let handles: Vec<_> = (0..8)
                .map(|i| {
                    let v = &v;
                    s.spawn(move || {
                        let rel = reserve(v, "Media", "clip.mp4").unwrap();
                        fill(v, &rel, |tmp| fs::write(tmp, format!("clip {i}"))).unwrap();
                        rel
                    })
                })
                .collect();
            handles.into_iter().map(|h| h.join().unwrap()).collect()
        });
        let unique: std::collections::HashSet<_> = names.iter().collect();
        assert_eq!(unique.len(), 8, "{names:?}");
        // Each file holds what its own import wrote; no temporary files are left.
        let mut contents: Vec<String> = names
            .iter()
            .map(|n| fs::read_to_string(v.resolve(n).unwrap()).unwrap())
            .collect();
        contents.sort();
        assert_eq!(
            contents,
            (0..8).map(|i| format!("clip {i}")).collect::<Vec<_>>()
        );
        assert_eq!(
            fs::read_dir(v.resolve("Media").unwrap()).unwrap().count(),
            8
        );
    }

    #[test]
    fn copies_outside_files_in_and_recognises_vault_files() {
        let (_d, v) = vault();
        let outside = tempfile::tempdir().unwrap();
        let src = outside.path().join("holiday.jpg");
        fs::write(&src, b"jpeg bytes").unwrap();
        assert_eq!(in_vault(&v, &src), None);
        let rel = reserve(&v, "Attachments", "holiday.jpg").unwrap();
        fill(&v, &rel, |tmp| fs::copy(&src, tmp).map(|_| ())).unwrap();
        let copied = v.resolve("Attachments/holiday.jpg").unwrap();
        assert_eq!(fs::read(&copied).unwrap(), b"jpeg bytes");
        assert_eq!(
            in_vault(&v, &copied).as_deref(),
            Some("Attachments/holiday.jpg")
        );
        // A failed copy leaves neither the reservation nor a temporary file behind.
        let rel = reserve(&v, "Attachments", "gone.jpg").unwrap();
        let missing = outside.path().join("gone.jpg");
        assert!(fill(&v, &rel, |tmp| fs::copy(&missing, tmp).map(|_| ())).is_err());
        assert_eq!(fs::read_dir(copied.parent().unwrap()).unwrap().count(), 1);
    }

    #[test]
    fn decodes_percent_escapes() {
        assert_eq!(
            percent_decode("Pasted%20image%20%C3%A9.png"),
            "Pasted image é.png"
        );
        assert_eq!(percent_decode("100%"), "100%");
        assert_eq!(percent_decode("%zz%4"), "%zz%4");
    }
}
