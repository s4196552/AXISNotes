//! Icon and image packs: sets of images the user uploads from a folder or a `.zip`, kept
//! in the vault's hidden `.axisnotes/packs/icons/<Pack>/` and `.axisnotes/packs/images/<Pack>/`
//! so they travel with the vault without showing in the file tree. Icon packs feed the icon
//! picker, image packs the cover gallery. Notes refer to pack files by their vault path.
//!
//! Importing flattens the pack into one folder of images: other files are skipped, an icon
//! pack that has SVGs keeps only those (packs often repeat each icon as PNGs in several
//! sizes), and when names repeat the shallowest copy wins. Only the base name of a zip entry
//! is used, so entries can't escape the pack folder, and sizes are checked while reading.

use std::collections::HashSet;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::vault::{is_hidden_name, Vault, IMAGE_EXTENSIONS, MAX_IMAGE_BYTES, META_DIR};

/// The most images one pack may hold.
pub const MAX_PACK_FILES: usize = 10_000;
/// The most bytes one pack may hold, all images together.
pub const MAX_PACK_BYTES: u64 = 500 * 1024 * 1024;
/// Zip archives with more entries than this aren't read at all.
const MAX_ZIP_ENTRIES: usize = 100_000;
/// How deep a source folder is searched for images.
const MAX_DEPTH: usize = 12;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PackKind {
    Icons,
    Images,
}

impl PackKind {
    fn dir(self) -> &'static str {
        match self {
            PackKind::Icons => "icons",
            PackKind::Images => "images",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Pack {
    pub kind: PackKind,
    pub name: String,
    /// Vault path of the pack's folder.
    pub dir: String,
    /// Vault paths of its images, sorted by name.
    pub files: Vec<String>,
    /// An icon pack of one-colour SVGs: drawn in the text colour, or any colour chosen.
    pub monochrome: bool,
}

/// Facts about a pack worked out when it was imported, kept beside its images.
const PACK_INFO: &str = ".pack.json";

/// Vault path of the folder holding packs of `kind`.
fn kind_rel(kind: PackKind) -> String {
    format!("{META_DIR}/packs/{}", kind.dir())
}

fn kind_abs(vault: &Vault, kind: PackKind) -> PathBuf {
    vault.root().join(META_DIR).join("packs").join(kind.dir())
}

fn is_image_name(name: &str) -> bool {
    Path::new(name)
        .extension()
        .map(|e| IMAGE_EXTENSIONS.contains(&e.to_string_lossy().to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

fn read_pack(vault: &Vault, kind: PackKind, name: &str) -> AppResult<Pack> {
    let dir = format!("{}/{name}", kind_rel(kind));
    let mut files: Vec<String> = fs::read_dir(kind_abs(vault, kind).join(name))?
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().map(|t| t.is_file()).unwrap_or(false))
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .filter(|n| !is_hidden_name(n) && is_image_name(n))
        .collect();
    files.sort_by_key(|n| n.to_lowercase());
    let info = fs::read_to_string(kind_abs(vault, kind).join(name).join(PACK_INFO))
        .ok()
        .and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok());
    Ok(Pack {
        kind,
        name: name.to_string(),
        files: files.into_iter().map(|f| format!("{dir}/{f}")).collect(),
        dir,
        monochrome: info
            .and_then(|i| i.get("monochrome").and_then(|m| m.as_bool()))
            .unwrap_or(false),
    })
}

/// Every pack in the vault, icon packs first, each kind sorted by name.
pub fn list_packs(vault: &Vault) -> AppResult<Vec<Pack>> {
    let mut out = Vec::new();
    for kind in [PackKind::Icons, PackKind::Images] {
        let Ok(entries) = fs::read_dir(kind_abs(vault, kind)) else {
            continue;
        };
        let mut names: Vec<String> = entries
            .filter_map(|e| e.ok())
            .filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false))
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .filter(|n| !is_hidden_name(n))
            .collect();
        names.sort_by_key(|n| n.to_lowercase());
        for name in names {
            out.push(read_pack(vault, kind, &name)?);
        }
    }
    Ok(out)
}

/// A pack name from a folder or zip name: no characters that can't be in a file name, no
/// leading dot (that would hide it), at most 60 characters.
pub fn clean_pack_name(raw: &str) -> String {
    const BAD: &[char] = &['<', '>', ':', '"', '/', '\\', '|', '?', '*'];
    let replaced: String = raw
        .chars()
        .map(|c| {
            if BAD.contains(&c) || c.is_control() {
                ' '
            } else {
                c
            }
        })
        .collect();
    let words: Vec<&str> = replaced.split_whitespace().collect();
    let joined = words.join(" ");
    let trimmed = joined.trim_start_matches('.').trim_end_matches('.').trim();
    let short: String = trimmed.chars().take(60).collect();
    let short = short.trim_end_matches('.').trim().to_string();
    if short.is_empty() {
        "Pack".to_string()
    } else {
        short
    }
}

/// An image found in the source, before choosing which ones to keep.
struct Found {
    /// Path inside the source, `/`-separated.
    rel: String,
    name: String,
    size: u64,
    /// Where to read it: a file on disk or a zip entry index.
    from: Source,
}

enum Source {
    File(PathBuf),
    Zip(usize),
}

/// Which images to copy: images only, SVGs only for an icon pack that has any, and one
/// file per name (the shallowest, then the first by path).
fn choose(kind: PackKind, found: Vec<Found>) -> Vec<Found> {
    let mut found: Vec<Found> = found
        .into_iter()
        .filter(|f| is_image_name(&f.name) && !is_hidden_name(&f.name))
        .filter(|f| {
            !f.rel
                .split('/')
                .any(|part| is_hidden_name(part) || part == "__MACOSX")
        })
        .collect();
    let svg = |f: &Found| f.name.to_ascii_lowercase().ends_with(".svg");
    if kind == PackKind::Icons && found.iter().any(svg) {
        found.retain(svg);
    }
    found.sort_by(|a, b| {
        let depth = |f: &Found| f.rel.matches('/').count();
        depth(a)
            .cmp(&depth(b))
            .then_with(|| a.rel.to_lowercase().cmp(&b.rel.to_lowercase()))
    });
    let mut seen = HashSet::new();
    found.retain(|f| seen.insert(f.name.to_lowercase()));
    found
}

fn walk(root: &Path, dir: &Path, depth: usize, out: &mut Vec<Found>) -> AppResult<()> {
    if depth > MAX_DEPTH {
        return Ok(());
    }
    for entry in fs::read_dir(dir)?.filter_map(|e| e.ok()) {
        let name = entry.file_name().to_string_lossy().into_owned();
        if is_hidden_name(&name) {
            continue;
        }
        // symlink_metadata: links are skipped, so a pack can't pull in files from elsewhere.
        let Ok(meta) = fs::symlink_metadata(entry.path()) else {
            continue;
        };
        if meta.is_dir() {
            walk(root, &entry.path(), depth + 1, out)?;
        } else if meta.is_file() && is_image_name(&name) {
            let rel = entry
                .path()
                .strip_prefix(root)
                .map(|p| p.to_string_lossy().replace('\\', "/"))
                .unwrap_or_else(|_| name.clone());
            out.push(Found {
                rel,
                name,
                size: meta.len(),
                from: Source::File(entry.path()),
            });
        }
    }
    Ok(())
}

fn too_big() -> AppError {
    AppError::Io(format!(
        "the pack is larger than {} MB of images",
        MAX_PACK_BYTES / 1024 / 1024
    ))
}

/// Copy the chosen images into `into`; returns how many were written.
fn copy_files(
    chosen: Vec<Found>,
    into: &Path,
    zip: &mut Option<zip::ZipArchive<fs::File>>,
) -> AppResult<usize> {
    if chosen.len() > MAX_PACK_FILES {
        return Err(AppError::Io(format!(
            "the pack has more than {MAX_PACK_FILES} images"
        )));
    }
    let mut total = 0u64;
    let mut written = 0;
    for f in chosen {
        // Images over the single-image limit are skipped, as uploads refuse them.
        if f.size > MAX_IMAGE_BYTES {
            continue;
        }
        let bytes = match f.from {
            Source::File(path) => fs::read(path)?,
            Source::Zip(index) => {
                let archive = zip.as_mut().expect("zip entries come from an open archive");
                let entry = archive.by_index(index).map_err(zip_error)?;
                // Read one byte past the limit: an entry may claim a smaller size than it has.
                let mut bytes = Vec::new();
                entry.take(MAX_IMAGE_BYTES + 1).read_to_end(&mut bytes)?;
                bytes
            }
        };
        if bytes.len() as u64 > MAX_IMAGE_BYTES {
            continue;
        }
        total += bytes.len() as u64;
        if total > MAX_PACK_BYTES {
            return Err(too_big());
        }
        fs::write(into.join(&f.name), bytes)?;
        written += 1;
    }
    Ok(written)
}

fn zip_error(e: zip::result::ZipError) -> AppError {
    AppError::Io(format!("couldn't read the zip file: {e}"))
}

/// Images in the zip at `source`, by entry index.
fn zip_entries(archive: &mut zip::ZipArchive<fs::File>) -> AppResult<Vec<Found>> {
    if archive.len() > MAX_ZIP_ENTRIES {
        return Err(AppError::Io(format!(
            "the zip file has more than {MAX_ZIP_ENTRIES} entries"
        )));
    }
    let mut out = Vec::new();
    for i in 0..archive.len() {
        let entry = archive.by_index_raw(i).map_err(zip_error)?;
        if entry.is_dir() {
            continue;
        }
        // `enclosed_name` drops entries with `..` or absolute paths.
        let Some(path) = entry.enclosed_name() else {
            continue;
        };
        let rel = path.to_string_lossy().replace('\\', "/");
        let name = rel.rsplit('/').next().unwrap_or_default().to_string();
        if name.is_empty() {
            continue;
        }
        out.push(Found {
            rel,
            name,
            size: entry.size(),
            from: Source::Zip(i),
        });
    }
    Ok(out)
}

/// Whether an SVG draws in one colour: every fill/stroke/colour it names is black,
/// `currentColor` or none (no colours at all means black). Gradients count as colour.
pub fn svg_is_monochrome(svg: &str) -> bool {
    const KEYS: &[&str] = &["fill", "stroke", "stop-color", "flood-color", "color"];
    const PLAIN: &[&str] = &[
        "none",
        "currentcolor",
        "black",
        "#000",
        "#000f",
        "#000000",
        "#000000ff",
        "rgb(0,0,0)",
        "inherit",
        "transparent",
        "context-fill",
        "context-stroke",
    ];
    let text = svg.to_ascii_lowercase();
    let bytes = text.as_bytes();
    for key in KEYS {
        let mut from = 0;
        while let Some(i) = text[from..].find(key) {
            let start = from + i;
            from = start + key.len();
            // A whole word: `fill`, not `fill-opacity` or `-color` inside `stop-color`.
            if start > 0 && (bytes[start - 1].is_ascii_alphanumeric() || bytes[start - 1] == b'-') {
                continue;
            }
            let rest = text[from..].trim_start();
            let Some(rest) = rest.strip_prefix('=').or_else(|| rest.strip_prefix(':')) else {
                continue;
            };
            let rest = rest.trim_start().trim_start_matches(['"', '\'']);
            let end = rest
                .find(['"', '\'', ';', '>', '\n', '}'])
                .unwrap_or(rest.len());
            let value: String = rest[..end]
                .replace("!important", "")
                .chars()
                .filter(|c| !c.is_whitespace())
                .collect();
            if !value.is_empty() && !PLAIN.contains(&value.as_str()) {
                return false;
            }
        }
    }
    true
}

/// An icon pack is one-colour when all its images are one-colour SVGs.
fn pack_is_monochrome(dir: &Path) -> bool {
    let Ok(entries) = fs::read_dir(dir) else {
        return false;
    };
    let mut any = false;
    for e in entries.filter_map(|e| e.ok()) {
        let name = e.file_name().to_string_lossy().into_owned();
        if is_hidden_name(&name) {
            continue;
        }
        if !name.to_ascii_lowercase().ends_with(".svg") {
            return false;
        }
        match fs::read_to_string(e.path()) {
            Ok(svg) if svg_is_monochrome(&svg) => any = true,
            _ => return false,
        }
    }
    any
}

/// A free pack name of `kind`: `name`, else `name 2`, `name 3`, …
fn free_name(vault: &Vault, kind: PackKind, name: &str) -> AppResult<String> {
    let dir = kind_abs(vault, kind);
    let taken = |n: &str| {
        fs::read_dir(&dir)
            .map(|entries| {
                entries
                    .filter_map(|e| e.ok())
                    .any(|e| e.file_name().to_string_lossy().eq_ignore_ascii_case(n))
            })
            .unwrap_or(false)
    };
    for n in 1..10_000 {
        let candidate = if n == 1 {
            name.to_string()
        } else {
            format!("{name} {n}")
        };
        if !taken(&candidate) {
            return Ok(candidate);
        }
    }
    Err(AppError::AlreadyExists(name.to_string()))
}

/// Import the folder or `.zip` at `source` as a new pack of `kind`, named after it.
pub fn import_pack(vault: &Vault, kind: PackKind, source: &Path) -> AppResult<Pack> {
    let meta =
        fs::metadata(source).map_err(|_| AppError::NotFound(source.display().to_string()))?;
    let is_zip = meta.is_file()
        && source
            .extension()
            .map(|e| e.eq_ignore_ascii_case("zip"))
            .unwrap_or(false);
    if !meta.is_dir() && !is_zip {
        return Err(AppError::InvalidName(format!(
            "{} is not a folder or a .zip file",
            source.display()
        )));
    }
    let raw = if is_zip {
        source.file_stem()
    } else {
        source.file_name()
    };
    let name = clean_pack_name(&raw.map(|n| n.to_string_lossy()).unwrap_or_default());

    let (found, mut archive) = if is_zip {
        let mut archive = zip::ZipArchive::new(fs::File::open(source)?).map_err(zip_error)?;
        (zip_entries(&mut archive)?, Some(archive))
    } else {
        let mut found = Vec::new();
        walk(source, source, 0, &mut found)?;
        (found, None)
    };
    let chosen = choose(kind, found);
    if chosen.is_empty() {
        return Err(AppError::NotFound(format!(
            "no images in {}",
            source.display()
        )));
    }

    // Copy into a hidden folder first, so a failed import leaves no half-made pack.
    let parent = kind_abs(vault, kind);
    fs::create_dir_all(&parent)?;
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or_default();
    let staging = parent.join(format!(".importing-{}-{stamp}", std::process::id()));
    fs::create_dir(&staging)?;
    let written = copy_files(chosen, &staging, &mut archive).and_then(|n| {
        if n == 0 {
            Err(AppError::Io(
                "every image in the pack is larger than 25 MB".into(),
            ))
        } else {
            Ok(n)
        }
    });
    if let Err(e) = written {
        let _ = fs::remove_dir_all(&staging);
        return Err(e);
    }
    let monochrome = kind == PackKind::Icons && pack_is_monochrome(&staging);
    let info = serde_json::json!({ "monochrome": monochrome }).to_string();
    if let Err(e) = fs::write(staging.join(PACK_INFO), info) {
        let _ = fs::remove_dir_all(&staging);
        return Err(e.into());
    }
    let name = free_name(vault, kind, &name)?;
    if let Err(e) = fs::rename(&staging, parent.join(&name)) {
        let _ = fs::remove_dir_all(&staging);
        return Err(e.into());
    }
    read_pack(vault, kind, &name)
}

/// Move the pack `name` of `kind` to the OS trash (its images can be restored from there).
pub fn remove_pack(vault: &Vault, kind: PackKind, name: &str) -> AppResult<()> {
    if name.is_empty() || name != clean_pack_name(name) {
        return Err(AppError::InvalidName(name.to_string()));
    }
    let dir = kind_abs(vault, kind).join(name);
    if !dir.is_dir() {
        return Err(AppError::NotFound(format!("{}/{name}", kind_rel(kind))));
    }
    trash::delete(&dir).map_err(|e| AppError::Io(e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn vault() -> (tempfile::TempDir, Vault) {
        let dir = tempfile::tempdir().unwrap();
        let v = Vault::open(dir.path()).unwrap();
        (dir, v)
    }

    fn write(path: &Path, bytes: &[u8]) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, bytes).unwrap();
    }

    fn names(p: &Pack) -> Vec<&str> {
        p.files
            .iter()
            .map(|f| f.rsplit('/').next().unwrap())
            .collect()
    }

    #[test]
    fn imports_a_folder_as_a_flat_pack_of_images() {
        let (_d, v) = vault();
        let src = tempfile::tempdir().unwrap();
        let root = src.path().join("Sunsets");
        write(&root.join("beach.jpg"), b"jpg");
        write(&root.join("more/hills.png"), b"png");
        write(&root.join("more/beach.jpg"), b"deeper copy");
        write(&root.join("readme.txt"), b"not an image");
        write(&root.join(".hidden/secret.png"), b"hidden");

        let pack = import_pack(&v, PackKind::Images, &root).unwrap();
        assert_eq!(pack.name, "Sunsets");
        assert_eq!(pack.dir, ".axisnotes/packs/images/Sunsets");
        assert_eq!(names(&pack), ["beach.jpg", "hills.png"]);
        // The shallowest beach.jpg won.
        let beach = v.root().join(".axisnotes/packs/images/Sunsets/beach.jpg");
        assert_eq!(fs::read(beach).unwrap(), b"jpg");
        assert_eq!(list_packs(&v).unwrap(), vec![pack]);
    }

    #[test]
    fn keeps_only_svgs_in_an_icon_pack_that_has_them() {
        let (_d, v) = vault();
        let src = tempfile::tempdir().unwrap();
        let root = src.path().join("Feather");
        write(&root.join("svg/star.svg"), b"<svg/>");
        write(&root.join("png/16/star.png"), b"png");
        write(&root.join("png/16/moon.png"), b"png");
        let pack = import_pack(&v, PackKind::Icons, &root).unwrap();
        assert_eq!(names(&pack), ["star.svg"]);
        // Without SVGs, PNGs are kept.
        let only_png = src.path().join("Pixel");
        write(&only_png.join("a.png"), b"png");
        let pack = import_pack(&v, PackKind::Icons, &only_png).unwrap();
        assert_eq!(names(&pack), ["a.png"]);
    }

    fn make_zip(path: &Path, entries: &[(&str, &[u8])]) {
        let file = fs::File::create(path).unwrap();
        let mut zip = zip::ZipWriter::new(file);
        let opts = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);
        for (name, bytes) in entries {
            zip.start_file(*name, opts).unwrap();
            zip.write_all(bytes).unwrap();
        }
        zip.finish().unwrap();
    }

    #[test]
    fn imports_a_zip_and_never_writes_outside_the_pack() {
        let (_d, v) = vault();
        let src = tempfile::tempdir().unwrap();
        let zip_path = src.path().join("My Icons.zip");
        make_zip(
            &zip_path,
            &[
                ("icons/rocket.svg", b"<svg/>"),
                ("../escape.svg", b"<svg/>"),
                ("__MACOSX/icons/._rocket.svg", b"junk"),
                ("icons/notes.txt", b"text"),
            ],
        );
        let pack = import_pack(&v, PackKind::Icons, &zip_path).unwrap();
        assert_eq!(pack.name, "My Icons");
        assert_eq!(names(&pack), ["rocket.svg"]);
        assert!(!v.root().join(".axisnotes/packs/escape.svg").exists());
        assert!(!src.path().join("escape.svg").exists());
        assert!(!v.root().join("escape.svg").exists());
    }

    #[test]
    fn names_packs_freely_and_refuses_empty_or_wrong_sources() {
        let (_d, v) = vault();
        let src = tempfile::tempdir().unwrap();
        let root = src.path().join("Set");
        write(&root.join("a.png"), b"png");
        assert_eq!(
            import_pack(&v, PackKind::Images, &root).unwrap().name,
            "Set"
        );
        assert_eq!(
            import_pack(&v, PackKind::Images, &root).unwrap().name,
            "Set 2"
        );
        // The same name is fine for the other kind.
        assert_eq!(import_pack(&v, PackKind::Icons, &root).unwrap().name, "Set");

        let empty = src.path().join("Empty");
        write(&empty.join("notes.md"), b"# no images");
        assert!(matches!(
            import_pack(&v, PackKind::Images, &empty),
            Err(AppError::NotFound(_))
        ));
        let text = src.path().join("file.txt");
        write(&text, b"text");
        assert!(matches!(
            import_pack(&v, PackKind::Images, &text),
            Err(AppError::InvalidName(_))
        ));
        // No staging folders are left behind.
        let leftovers: Vec<_> = fs::read_dir(v.root().join(".axisnotes/packs/images"))
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().starts_with(".importing"))
            .collect();
        assert!(leftovers.is_empty());
    }

    #[test]
    fn skips_images_that_are_too_large_even_when_a_zip_understates_them() {
        let (_d, v) = vault();
        let src = tempfile::tempdir().unwrap();
        let zip_path = src.path().join("big.zip");
        let huge = vec![0u8; (MAX_IMAGE_BYTES + 1) as usize];
        make_zip(&zip_path, &[("ok.png", b"png"), ("huge.png", &huge)]);
        let pack = import_pack(&v, PackKind::Images, &zip_path).unwrap();
        assert_eq!(names(&pack), ["ok.png"]);
    }

    #[test]
    fn tells_one_colour_svgs_from_coloured_ones() {
        assert!(svg_is_monochrome(
            r#"<svg fill="none" stroke="currentColor" stroke-width="2"><path d="M1 1"/></svg>"#
        ));
        assert!(svg_is_monochrome(r#"<svg><path d="M1 1"/></svg>"#));
        assert!(svg_is_monochrome(
            r#"<svg style="fill: #000000 !important"><path fill-opacity=".5"/></svg>"#
        ));
        assert!(!svg_is_monochrome(r##"<svg><path fill="#e5484d"/></svg>"##));
        assert!(!svg_is_monochrome(
            r#"<svg><path style="stroke:rgb(1, 2, 3)"/></svg>"#
        ));
        assert!(!svg_is_monochrome(
            r##"<svg><stop stop-color="#fff"/><path fill="url(#g)"/></svg>"##
        ));
    }

    #[test]
    fn marks_one_colour_icon_packs() {
        let (_d, v) = vault();
        let src = tempfile::tempdir().unwrap();
        let line = src.path().join("Line");
        write(&line.join("a.svg"), br#"<svg stroke="currentColor"/>"#);
        assert!(import_pack(&v, PackKind::Icons, &line).unwrap().monochrome);
        let colour = src.path().join("Colour");
        write(&colour.join("a.svg"), br#"<svg stroke="currentColor"/>"#);
        write(&colour.join("b.svg"), br##"<svg fill="#0090ff"/>"##);
        assert!(
            !import_pack(&v, PackKind::Icons, &colour)
                .unwrap()
                .monochrome
        );
        // Image packs never are, and the info file stays out of the image list.
        let pack = import_pack(&v, PackKind::Images, &line).unwrap();
        assert!(!pack.monochrome);
        assert_eq!(names(&pack), ["a.svg"]);
    }

    #[test]
    fn cleans_pack_names() {
        assert_eq!(clean_pack_name("  My:Icons?  "), "My Icons");
        assert_eq!(clean_pack_name(".hidden"), "hidden");
        assert_eq!(clean_pack_name("..."), "Pack");
        assert_eq!(clean_pack_name(&"x".repeat(80)).len(), 60);
    }

    #[test]
    fn removes_only_real_packs() {
        let (_d, v) = vault();
        assert!(matches!(
            remove_pack(&v, PackKind::Icons, "../../notes"),
            Err(AppError::InvalidName(_))
        ));
        assert!(matches!(
            remove_pack(&v, PackKind::Icons, "Missing"),
            Err(AppError::NotFound(_))
        ));
    }
}
