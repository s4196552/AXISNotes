//! Vault file-system core. All paths crossing the IPC boundary are
//! vault-relative with forward slashes (e.g. `School/Biology.md`).

pub mod watcher;

use std::collections::HashSet;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::Serialize;

use crate::error::{AppError, AppResult};

pub const META_DIR: &str = ".axisnotes";
/// The folder's name before the app was renamed AXISNotes; moved to `META_DIR` on open.
const LEGACY_META_DIR: &str = ".axis";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum EntryKind {
    File,
    Dir,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultEntry {
    /// Vault-relative path; `""` for the vault root.
    pub path: String,
    pub name: String,
    pub kind: EntryKind,
    pub modified_ms: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub children: Option<Vec<VaultEntry>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultInfo {
    pub root: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileContent {
    pub content: String,
    pub modified_ms: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteResult {
    pub modified_ms: u64,
}

/// Hidden from the tree and from watcher events: dot-entries (`.axisnotes`, `.git`, ...)
/// and our own temp files.
pub fn is_hidden_name(name: &str) -> bool {
    name.starts_with('.') || name.ends_with(".axisnotes-tmp")
}

/// A visible item in a folder, with the metadata of what it points to.
pub(crate) struct Child {
    pub name: String,
    pub path: PathBuf,
    pub is_dir: bool,
    pub meta: fs::Metadata,
    /// Where a folder really is (its link target for a folder link); walks pass it down.
    pub real: PathBuf,
}

/// The canonical form of a folder, used to recognise one reached twice through links.
fn canonical(dir: &Path) -> PathBuf {
    dunce::canonicalize(dir).unwrap_or_else(|_| dir.to_path_buf())
}

/// A walk through a vault: `seen` holds the targets of folder links already followed.
pub(crate) struct Walk {
    seen: HashSet<PathBuf>,
}

impl Walk {
    /// Start at `root`; returns the walk and the root's real location.
    pub fn new(root: &Path) -> (Self, PathBuf) {
        (
            Self {
                seen: HashSet::new(),
            },
            canonical(root),
        )
    }

    /// The visible items in `dir` (really at `real`). Never fails: an unreadable folder
    /// has no children, and items that can't be read (a broken link, no permission) are
    /// skipped. A folder link is followed unless it points at a folder the walk is already
    /// inside (a loop) or has already followed a link to.
    pub fn children(&mut self, dir: &Path, real: &Path) -> Vec<Child> {
        let Ok(entries) = fs::read_dir(dir) else {
            return Vec::new();
        };
        let mut out = Vec::new();
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if is_hidden_name(&name) {
                continue;
            }
            let path = entry.path();
            let Ok(kind) = entry.file_type() else {
                continue;
            };
            let (meta, real_child) = if kind.is_symlink() {
                // Follow the link; a broken one fails here and is skipped.
                let Ok(meta) = fs::metadata(&path) else {
                    continue;
                };
                let target = canonical(&path);
                if meta.is_dir() && (real.starts_with(&target) || !self.seen.insert(target.clone()))
                {
                    continue;
                }
                (meta, target)
            } else {
                // Cheap: comes from the folder listing itself on Windows.
                let Ok(meta) = entry.metadata() else { continue };
                (meta, real.join(&name))
            };
            out.push(Child {
                name,
                is_dir: meta.is_dir(),
                path,
                meta,
                real: real_child,
            });
        }
        out
    }
}

pub(crate) fn modified_ms(meta: &fs::Metadata) -> u64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

pub(crate) fn validate_name(name: &str) -> AppResult<()> {
    const BAD: &[char] = &['<', '>', ':', '"', '/', '\\', '|', '?', '*'];
    let trimmed = name.trim();
    if trimmed.is_empty()
        || trimmed != name
        || name.ends_with('.')
        || name.chars().any(|c| BAD.contains(&c) || c.is_control())
    {
        return Err(AppError::InvalidName(name.to_string()));
    }
    Ok(())
}

#[derive(Debug, Clone)]
pub struct Vault {
    root: PathBuf,
}

impl Vault {
    /// Open an existing folder as a vault, creating `.axisnotes/` if missing.
    pub fn open(path: &Path) -> AppResult<Self> {
        let root = dunce::canonicalize(path)
            .map_err(|_| AppError::NotFound(path.display().to_string()))?;
        if !root.is_dir() {
            return Err(AppError::NotFound(root.display().to_string()));
        }
        let meta = root.join(META_DIR);
        let legacy = root.join(LEGACY_META_DIR);
        if !meta.exists() && legacy.is_dir() {
            // Vaults made before the rename keep their settings, themes and index.
            fs::rename(&legacy, &meta)?;
        }
        fs::create_dir_all(&meta)?;
        let config = meta.join("config.json");
        if !config.exists() {
            fs::write(&config, "{}\n")?;
        }
        Ok(Self { root })
    }

    /// Create `parent/name` as a new vault folder and open it.
    pub fn create(parent: &Path, name: &str) -> AppResult<Self> {
        validate_name(name)?;
        let dir = parent.join(name);
        if dir.exists() {
            return Err(AppError::AlreadyExists(dir.display().to_string()));
        }
        fs::create_dir_all(&dir)?;
        Self::open(&dir)
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn info(&self) -> VaultInfo {
        VaultInfo {
            root: self.root.display().to_string(),
            name: self
                .root
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default(),
        }
    }

    /// Resolve a vault-relative path to an absolute one, rejecting escapes.
    pub fn resolve(&self, rel: &str) -> AppResult<PathBuf> {
        let rel_path = Path::new(rel);
        let mut out = self.root.clone();
        for c in rel_path.components() {
            match c {
                Component::Normal(part) => out.push(part),
                Component::CurDir => {}
                _ => return Err(AppError::OutsideVault(rel.to_string())),
            }
        }
        Ok(out)
    }

    /// Like `resolve`, but rejects the vault root itself.
    fn resolve_entry(&self, rel: &str) -> AppResult<PathBuf> {
        let abs = self.resolve(rel)?;
        if abs == self.root {
            return Err(AppError::OutsideVault(rel.to_string()));
        }
        Ok(abs)
    }

    /// Absolute path -> vault-relative path, or `None` if outside the vault.
    pub fn to_rel(&self, abs: &Path) -> Option<String> {
        let stripped = abs.strip_prefix(&self.root).ok()?;
        let parts: Vec<String> = stripped
            .components()
            .map(|c| c.as_os_str().to_string_lossy().into_owned())
            .collect();
        Some(parts.join("/"))
    }

    /// The whole vault as a tree. Items that can't be read (no permission, a link to
    /// something that no longer exists) are left out instead of failing the vault, and
    /// folder links are followed only once, so a link back up the tree can't loop.
    pub fn list_tree(&self) -> AppResult<VaultEntry> {
        let mut root = self.entry_for(&self.root, true)?;
        root.name = self.info().name;
        Ok(root)
    }

    /// One entry; with `recurse`, its whole subtree.
    fn entry_for(&self, abs: &Path, recurse: bool) -> AppResult<VaultEntry> {
        let meta = fs::metadata(abs)?;
        let children = meta.is_dir().then(|| {
            if recurse {
                let (mut walk, real) = Walk::new(abs);
                self.tree_children(abs, &real, &mut walk)
            } else {
                Vec::new()
            }
        });
        Ok(VaultEntry {
            path: self.to_rel(abs).unwrap_or_default(),
            name: abs
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default(),
            kind: if meta.is_dir() {
                EntryKind::Dir
            } else {
                EntryKind::File
            },
            modified_ms: modified_ms(&meta),
            children,
        })
    }

    fn tree_children(&self, dir: &Path, real: &Path, walk: &mut Walk) -> Vec<VaultEntry> {
        let mut kids: Vec<VaultEntry> = walk
            .children(dir, real)
            .into_iter()
            .map(|c| {
                let children = c.is_dir.then(|| self.tree_children(&c.path, &c.real, walk));
                VaultEntry {
                    path: self.to_rel(&c.path).unwrap_or_default(),
                    name: c.name,
                    kind: if c.is_dir {
                        EntryKind::Dir
                    } else {
                        EntryKind::File
                    },
                    modified_ms: modified_ms(&c.meta),
                    children,
                }
            })
            .collect();
        kids.sort_by(|a, b| {
            (a.kind != EntryKind::Dir, a.name.to_lowercase())
                .cmp(&(b.kind != EntryKind::Dir, b.name.to_lowercase()))
        });
        kids
    }

    pub fn read_file(&self, rel: &str) -> AppResult<FileContent> {
        let abs = self.resolve_entry(rel)?;
        if !abs.is_file() {
            return Err(AppError::NotFound(rel.to_string()));
        }
        let content = fs::read_to_string(&abs)?;
        let meta = fs::metadata(&abs)?;
        Ok(FileContent {
            content,
            modified_ms: modified_ms(&meta),
        })
    }

    /// Atomic write (temp file + rename). If `expected_modified_ms` is given and the
    /// file on disk has a different mtime, returns `Conflict` without writing.
    pub fn write_file(
        &self,
        rel: &str,
        content: &str,
        expected_modified_ms: Option<u64>,
    ) -> AppResult<WriteResult> {
        let abs = self.resolve_entry(rel)?;
        if let Some(expected) = expected_modified_ms {
            if let Ok(meta) = fs::metadata(&abs) {
                if modified_ms(&meta) != expected {
                    return Err(AppError::Conflict(rel.to_string()));
                }
            }
        }
        if let Some(parent) = abs.parent() {
            fs::create_dir_all(parent)?;
        }
        let file_name = abs
            .file_name()
            .ok_or_else(|| AppError::InvalidName(rel.to_string()))?
            .to_string_lossy()
            .into_owned();
        let tmp = abs.with_file_name(format!(".{file_name}.axisnotes-tmp"));
        fs::write(&tmp, content)?;
        if let Err(e) = fs::rename(&tmp, &abs) {
            let _ = fs::remove_file(&tmp);
            return Err(e.into());
        }
        let meta = fs::metadata(&abs)?;
        Ok(WriteResult {
            modified_ms: modified_ms(&meta),
        })
    }

    /// Write binary data (screenshots, imported attachments), atomically.
    pub fn write_bytes(&self, rel: &str, bytes: &[u8]) -> AppResult<()> {
        let abs = self.resolve_entry(rel)?;
        validate_name(&abs.file_name().unwrap_or_default().to_string_lossy())?;
        if let Some(parent) = abs.parent() {
            fs::create_dir_all(parent)?;
        }
        let file_name = abs
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned();
        let tmp = abs.with_file_name(format!(".{file_name}.axisnotes-tmp"));
        fs::write(&tmp, bytes)?;
        if let Err(e) = fs::rename(&tmp, &abs) {
            let _ = fs::remove_file(&tmp);
            return Err(e.into());
        }
        Ok(())
    }

    pub fn create_file(&self, rel: &str, content: &str) -> AppResult<VaultEntry> {
        let abs = self.resolve_entry(rel)?;
        validate_name(&abs.file_name().unwrap_or_default().to_string_lossy())?;
        if abs.exists() {
            return Err(AppError::AlreadyExists(rel.to_string()));
        }
        if let Some(parent) = abs.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(&abs, content)?;
        self.entry_for(&abs, false)
    }

    pub fn create_dir(&self, rel: &str) -> AppResult<VaultEntry> {
        let abs = self.resolve_entry(rel)?;
        validate_name(&abs.file_name().unwrap_or_default().to_string_lossy())?;
        if abs.exists() {
            return Err(AppError::AlreadyExists(rel.to_string()));
        }
        fs::create_dir_all(&abs)?;
        self.entry_for(&abs, true)
    }

    /// Rename or move a file/folder. Fails if the destination exists.
    pub fn rename_entry(&self, from: &str, to: &str) -> AppResult<VaultEntry> {
        let src = self.resolve_entry(from)?;
        let dst = self.resolve_entry(to)?;
        validate_name(&dst.file_name().unwrap_or_default().to_string_lossy())?;
        if !src.exists() {
            return Err(AppError::NotFound(from.to_string()));
        }
        if dst.starts_with(&src) {
            return Err(AppError::InvalidName(format!(
                "cannot move {from} into itself"
            )));
        }
        // Allow case-only renames on case-insensitive file systems.
        let same_entry =
            src.to_string_lossy().to_lowercase() == dst.to_string_lossy().to_lowercase();
        if dst.exists() && !same_entry {
            return Err(AppError::AlreadyExists(to.to_string()));
        }
        if let Some(parent) = dst.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::rename(&src, &dst)?;
        self.entry_for(&dst, true)
    }

    /// Move to the OS trash / recycle bin (never a hard delete).
    pub fn trash_entry(&self, rel: &str) -> AppResult<()> {
        let abs = self.resolve_entry(rel)?;
        if !abs.exists() {
            return Err(AppError::NotFound(rel.to_string()));
        }
        trash::delete(&abs).map_err(|e| AppError::Io(e.to_string()))
    }

    /// Put items this vault moved to the system trash back where they were (undo of a
    /// delete). For each vault path, the newest trash item deleted from exactly there at
    /// or after `since_secs` (Unix seconds) is restored. Nothing is restored unless every
    /// path is found and its place is free.
    #[cfg(any(
        target_os = "windows",
        all(
            unix,
            not(target_os = "macos"),
            not(target_os = "ios"),
            not(target_os = "android")
        )
    ))]
    pub fn restore_from_trash(&self, rels: &[String], since_secs: i64) -> AppResult<()> {
        let same = |a: &Path, b: &Path| {
            let (a, b) = (dunce::simplified(a), dunce::simplified(b));
            if cfg!(windows) {
                a.to_string_lossy().to_lowercase() == b.to_string_lossy().to_lowercase()
            } else {
                a == b
            }
        };
        let items = trash::os_limited::list().map_err(|e| AppError::Io(e.to_string()))?;
        let mut chosen = Vec::new();
        for rel in rels {
            let abs = self.resolve_entry(rel)?;
            if abs.exists() {
                return Err(AppError::AlreadyExists(rel.clone()));
            }
            let found = items
                .iter()
                .filter(|i| i.time_deleted >= since_secs)
                .filter(|i| same(&i.original_parent.join(&i.name), &abs))
                .max_by_key(|i| i.time_deleted)
                .ok_or_else(|| {
                    AppError::NotFound(format!("{rel} (it isn't in the trash any more)"))
                })?;
            chosen.push(found.clone());
        }
        trash::os_limited::restore_all(chosen).map_err(|e| AppError::Io(e.to_string()))
    }

    #[cfg(not(any(
        target_os = "windows",
        all(
            unix,
            not(target_os = "macos"),
            not(target_os = "ios"),
            not(target_os = "android")
        )
    )))]
    pub fn restore_from_trash(&self, _rels: &[String], _since_secs: i64) -> AppResult<()> {
        Err(AppError::Io(
            "Restoring from the trash isn't supported on this system; restore it from the Trash in Finder.".into(),
        ))
    }

    /// Copy a file or folder into the folder `dir` ("" is the vault root), returning the
    /// copy. It keeps its name when that is free there, else becomes `Name copy`,
    /// `Name copy 2`, … (before any extension), so nothing is ever overwritten. A folder
    /// can't be copied into itself. Folder links inside a copied folder are skipped.
    pub fn copy_entry(&self, from: &str, dir: &str) -> AppResult<VaultEntry> {
        let src = self.resolve_entry(from)?;
        let meta = fs::metadata(&src).map_err(|_| AppError::NotFound(from.to_string()))?;
        let dir_abs = self.resolve(dir)?;
        if !dir_abs.is_dir() {
            return Err(AppError::NotFound(dir.to_string()));
        }
        // Compared as the file system spells them, so `notes/Sub` is inside `Notes` on
        // Windows and macOS too.
        if meta.is_dir() && same_or_inside(&dir_abs, &src) {
            return Err(AppError::InvalidName(format!(
                "cannot copy {from} into itself"
            )));
        }
        let name = src
            .file_name()
            .ok_or_else(|| AppError::InvalidName(from.to_string()))?
            .to_string_lossy()
            .into_owned();
        let dst = dir_abs.join(self.free_copy_name(&dir_abs, &name, meta.is_dir())?);
        // The copy is made with `create_new`/`create_dir`, so something that appears at
        // `dst` meanwhile is never overwritten, and only what this call made is removed
        // if the copy fails part way.
        if meta.is_dir() {
            fs::create_dir(&dst)?;
            if let Err(e) = copy_dir_into(&src, &dst) {
                let _ = fs::remove_dir_all(&dst);
                return Err(e.into());
            }
        } else {
            let mut out = fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&dst)?;
            let copied =
                fs::File::open(&src).and_then(|mut input| std::io::copy(&mut input, &mut out));
            drop(out);
            if let Err(e) = copied {
                let _ = fs::remove_file(&dst);
                return Err(e.into());
            }
        }
        self.entry_for(&dst, true)
    }

    /// `name` if nothing in `dir_abs` has it, else `stem copy.ext`, `stem copy 2.ext`, …
    /// (a folder's name is never split at a dot).
    fn free_copy_name(&self, dir_abs: &Path, name: &str, is_dir: bool) -> AppResult<String> {
        validate_name(name)?;
        let (stem, ext) = match name.rfind('.') {
            Some(i) if i > 0 && !is_dir => (&name[..i], &name[i..]),
            _ => (name, ""),
        };
        for n in 0..10_000 {
            let candidate = match n {
                0 => name.to_string(),
                1 => format!("{stem} copy{ext}"),
                _ => format!("{stem} copy {n}{ext}"),
            };
            if fs::symlink_metadata(dir_abs.join(&candidate)).is_err() {
                return Ok(candidate);
            }
        }
        Err(AppError::AlreadyExists(name.to_string()))
    }

    /// A free vault path for `file_name` inside `folder` ("" is the vault root):
    /// `photo.png`, else `photo 1.png`, `photo 2.png`, …
    pub fn free_path(&self, folder: &str, file_name: &str) -> AppResult<String> {
        validate_name(file_name)?;
        let folder = folder.trim_matches('/');
        let join = |name: &str| {
            if folder.is_empty() {
                name.to_string()
            } else {
                format!("{folder}/{name}")
            }
        };
        let (stem, ext) = match file_name.rfind('.') {
            Some(i) if i > 0 => (&file_name[..i], &file_name[i..]),
            _ => (file_name, ""),
        };
        for n in 0..10_000 {
            let name = if n == 0 {
                file_name.to_string()
            } else {
                format!("{stem} {n}{ext}")
            };
            let rel = join(&name);
            if !self.resolve_entry(&rel)?.exists() {
                return Ok(rel);
            }
        }
        Err(AppError::AlreadyExists(join(file_name)))
    }

    /// Copy an image from anywhere on disk to the free vault path `rel` (see `free_path`).
    pub fn copy_image_in(&self, source: &Path, rel: &str) -> AppResult<VaultEntry> {
        image_file_name(source)?;
        if self.resolve_entry(rel)?.exists() {
            return Err(AppError::AlreadyExists(rel.to_string()));
        }
        let bytes = fs::read(source)?;
        if bytes.len() as u64 > MAX_IMAGE_BYTES {
            return Err(too_large());
        }
        self.write_bytes(rel, &bytes)?;
        self.entry_for(&self.resolve_entry(rel)?, false)
    }

    /// Copy a font file from anywhere on disk to the free vault path `rel` (see `free_path`).
    pub fn copy_font_in(&self, source: &Path, rel: &str) -> AppResult<VaultEntry> {
        font_file_name(source)?;
        if self.resolve_entry(rel)?.exists() {
            return Err(AppError::AlreadyExists(rel.to_string()));
        }
        let bytes = fs::read(source)?;
        if bytes.len() as u64 > MAX_FONT_BYTES {
            return Err(AppError::Io("the font is larger than 25 MB".into()));
        }
        self.write_bytes(rel, &bytes)?;
        self.entry_for(&self.resolve_entry(rel)?, false)
    }
}

/// Font files that can be copied into the vault (Settings → Appearance → Typography).
pub const FONT_EXTENSIONS: &[&str] = &["ttf", "otf", "woff", "woff2"];
/// The largest font that can be copied in.
pub const MAX_FONT_BYTES: u64 = 25 * 1024 * 1024;

/// The file name of `source` if it is a font file that may be copied into the vault.
pub fn font_file_name(source: &Path) -> AppResult<String> {
    let meta =
        fs::metadata(source).map_err(|_| AppError::NotFound(source.display().to_string()))?;
    if !meta.is_file() {
        return Err(AppError::NotFound(source.display().to_string()));
    }
    let name = source
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    let ext = Path::new(&name)
        .extension()
        .map(|e| e.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default();
    if !FONT_EXTENSIONS.contains(&ext.as_str()) {
        return Err(AppError::InvalidName(format!("{name} is not a font file")));
    }
    if meta.len() > MAX_FONT_BYTES {
        return Err(AppError::Io("the font is larger than 25 MB".into()));
    }
    Ok(name)
}

/// The most files, and the largest one, copied in from a skill folder (Settings → AI →
/// Skills → Import).
pub const MAX_SKILL_FILES: usize = 40;
pub const MAX_SKILL_FILE_BYTES: u64 = 512 * 1024;
/// Text files of a skill folder that are copied in; scripts and other files are not.
const SKILL_TEXT_EXTENSIONS: &[&str] = &["md", "markdown", "txt"];

/// A skill folder in the Agent Skills layout, read from outside the vault: the folder's
/// name and its text files (`SKILL.md` and the reference files beside it, plus those one
/// folder down), as paths relative to the folder with their text.
pub struct SkillFolder {
    pub name: String,
    pub files: Vec<(String, String)>,
}

/// Read the skill whose `SKILL.md` is `skill_md`, for copying into the vault.
pub fn read_skill_folder(skill_md: &Path) -> AppResult<SkillFolder> {
    let meta =
        fs::metadata(skill_md).map_err(|_| AppError::NotFound(skill_md.display().to_string()))?;
    let file_name = skill_md
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    if !meta.is_file() || !file_name.eq_ignore_ascii_case("SKILL.md") {
        return Err(AppError::InvalidName(format!(
            "{file_name} is not a skill: pick the SKILL.md file in the skill's folder"
        )));
    }
    let folder = skill_md.parent().unwrap_or(Path::new(""));
    let raw = folder
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    let cleaned: String = raw
        .chars()
        .map(|c| {
            if "<>:\"/\\|?*".contains(c) || c.is_control() {
                '-'
            } else {
                c
            }
        })
        .collect();
    let cleaned = cleaned.trim().trim_end_matches('.').to_string();
    let name = if cleaned.is_empty() || cleaned.starts_with('.') {
        "Imported skill".to_string()
    } else {
        cleaned
    };
    let text_file = |p: &Path, n: &str| {
        !n.starts_with('.')
            && p.is_file()
            && Path::new(n)
                .extension()
                .map(|e| e.to_string_lossy().to_ascii_lowercase())
                .is_some_and(|e| SKILL_TEXT_EXTENSIONS.contains(&e.as_str()))
    };
    let sorted = |dir: &Path| -> Vec<(String, PathBuf)> {
        let mut out: Vec<(String, PathBuf)> = fs::read_dir(dir)
            .map(|rd| {
                rd.flatten()
                    .map(|e| (e.file_name().to_string_lossy().into_owned(), e.path()))
                    .collect()
            })
            .unwrap_or_default();
        out.sort();
        out
    };
    let mut found: Vec<(String, PathBuf)> = Vec::new();
    for (n, p) in sorted(folder) {
        if text_file(&p, &n) && validate_name(&n).is_ok() {
            found.push((n, p));
        } else if p.is_dir() && !n.starts_with('.') && validate_name(&n).is_ok() {
            for (m, q) in sorted(&p) {
                if text_file(&q, &m) && validate_name(&m).is_ok() {
                    found.push((format!("{n}/{m}"), q));
                }
            }
        }
    }
    if found.len() > MAX_SKILL_FILES {
        return Err(AppError::Io(format!(
            "the skill folder has more than {MAX_SKILL_FILES} text files"
        )));
    }
    let mut files = Vec::new();
    for (rel, p) in found {
        if fs::metadata(&p)?.len() > MAX_SKILL_FILE_BYTES {
            return Err(AppError::Io(format!("{rel} is larger than 512 KB")));
        }
        // Text that isn't UTF-8 is left out rather than garbled.
        if let Ok(text) = String::from_utf8(fs::read(&p)?) {
            files.push((rel, text));
        }
    }
    if !files
        .iter()
        .any(|(r, _)| r.eq_ignore_ascii_case("SKILL.md"))
    {
        return Err(AppError::Io("SKILL.md couldn't be read as text".into()));
    }
    Ok(SkillFolder { name, files })
}

/// Image types that can be copied into the vault (page covers and icons).
pub const IMAGE_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif"];
/// The largest image that can be copied in.
pub const MAX_IMAGE_BYTES: u64 = 25 * 1024 * 1024;

/// Whether `path` is `folder` or inside it, comparing the paths as the file system
/// resolves them (so a different capitalisation of the same folder still counts).
fn same_or_inside(path: &Path, folder: &Path) -> bool {
    match (dunce::canonicalize(path), dunce::canonicalize(folder)) {
        (Ok(p), Ok(f)) => p.starts_with(f),
        _ => {
            if cfg!(any(windows, target_os = "macos")) {
                let lower = |p: &Path| PathBuf::from(p.to_string_lossy().to_lowercase());
                lower(path).starts_with(lower(folder))
            } else {
                path.starts_with(folder)
            }
        }
    }
}

/// Copy what's in the folder `from` into the new, empty folder `to`. Linked folders inside
/// are skipped, so a link back up the tree can't make the copy endless; linked files are
/// copied.
fn copy_dir_into(from: &Path, to: &Path) -> std::io::Result<()> {
    for entry in fs::read_dir(from)? {
        let entry = entry?;
        let target = to.join(entry.file_name());
        let kind = entry.file_type()?;
        if kind.is_dir() {
            fs::create_dir(&target)?;
            copy_dir_into(&entry.path(), &target)?;
        } else if kind.is_file() || (kind.is_symlink() && entry.path().is_file()) {
            fs::copy(entry.path(), &target)?;
        }
    }
    Ok(())
}

fn too_large() -> AppError {
    AppError::Io("the image is larger than 25 MB".into())
}

/// The file name of `source` if it is an image file that may be copied into the vault.
pub fn image_file_name(source: &Path) -> AppResult<String> {
    let meta =
        fs::metadata(source).map_err(|_| AppError::NotFound(source.display().to_string()))?;
    if !meta.is_file() {
        return Err(AppError::NotFound(source.display().to_string()));
    }
    let name = source
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    let ext = Path::new(&name)
        .extension()
        .map(|e| e.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default();
    if !IMAGE_EXTENSIONS.contains(&ext.as_str()) {
        return Err(AppError::InvalidName(format!("{name} is not an image")));
    }
    if meta.len() > MAX_IMAGE_BYTES {
        return Err(too_large());
    }
    Ok(name)
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    fn vault() -> (tempfile::TempDir, Vault) {
        let dir = tempfile::tempdir().unwrap();
        let v = Vault::open(dir.path()).unwrap();
        (dir, v)
    }

    #[test]
    fn open_creates_meta_dir() {
        let (dir, _v) = vault();
        assert!(dir.path().join(".axisnotes/config.json").is_file());
    }

    #[test]
    fn open_moves_the_legacy_meta_dir() {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir_all(dir.path().join(".axis/themes")).unwrap();
        fs::write(dir.path().join(".axis/config.json"), "{\"theme\":\"dark\"}").unwrap();
        Vault::open(dir.path()).unwrap();
        assert!(!dir.path().join(".axis").exists());
        assert_eq!(
            fs::read_to_string(dir.path().join(".axisnotes/config.json")).unwrap(),
            "{\"theme\":\"dark\"}"
        );
        assert!(dir.path().join(".axisnotes/themes").is_dir());
    }

    /// A folder link: a junction on Windows (no admin rights needed), a symlink elsewhere.
    pub(crate) fn link_dir(target: &Path, link: &Path) {
        #[cfg(windows)]
        {
            let ok = std::process::Command::new("cmd")
                .args(["/C", "mklink", "/J"])
                .arg(link)
                .arg(target)
                .output()
                .unwrap()
                .status
                .success();
            assert!(ok, "mklink /J failed");
        }
        #[cfg(unix)]
        std::os::unix::fs::symlink(target, link).unwrap();
    }

    fn names(e: &VaultEntry, out: &mut Vec<String>) {
        if !e.path.is_empty() {
            out.push(e.path.clone());
        }
        for c in e.children.iter().flatten() {
            names(c, out);
        }
    }

    #[test]
    fn tree_survives_broken_links_and_link_loops() {
        let (dir, v) = vault();
        fs::write(dir.path().join("a.md"), "a").unwrap();
        fs::create_dir(dir.path().join("sub")).unwrap();
        fs::write(dir.path().join("sub/b.md"), "b").unwrap();
        // A link back to the vault itself, and one to a folder that's since been deleted.
        link_dir(dir.path(), &dir.path().join("loop"));
        fs::create_dir(dir.path().join("gone")).unwrap();
        link_dir(&dir.path().join("gone"), &dir.path().join("broken"));
        fs::remove_dir(dir.path().join("gone")).unwrap();

        let mut got = Vec::new();
        names(&v.list_tree().unwrap(), &mut got);
        got.sort();
        assert_eq!(got, ["a.md", "sub", "sub/b.md"]);
    }

    #[test]
    fn tree_follows_a_link_to_a_folder_outside_the_vault() {
        let (dir, v) = vault();
        let outside = tempfile::tempdir().unwrap();
        fs::write(outside.path().join("shared.md"), "s").unwrap();
        link_dir(outside.path(), &dir.path().join("Shared"));
        let mut got = Vec::new();
        names(&v.list_tree().unwrap(), &mut got);
        assert!(got.contains(&"Shared/shared.md".to_string()), "{got:?}");
    }

    #[test]
    fn rejects_paths_outside_vault() {
        let (_d, v) = vault();
        assert!(matches!(
            v.resolve("../x.md"),
            Err(AppError::OutsideVault(_))
        ));
        assert!(matches!(
            v.resolve("a/../../x.md"),
            Err(AppError::OutsideVault(_))
        ));
        assert!(v.resolve("a/b.md").is_ok());
        assert!(matches!(v.read_file(""), Err(AppError::OutsideVault(_))));
    }

    #[test]
    fn create_read_write_roundtrip() {
        let (_d, v) = vault();
        let e = v.create_file("School/Bio.md", "# Bio").unwrap();
        assert_eq!(e.path, "School/Bio.md");
        let r = v.read_file("School/Bio.md").unwrap();
        assert_eq!(r.content, "# Bio");
        let w = v
            .write_file("School/Bio.md", "# Bio 2", Some(r.modified_ms))
            .unwrap();
        assert!(w.modified_ms > 0);
        assert_eq!(v.read_file("School/Bio.md").unwrap().content, "# Bio 2");
        assert!(matches!(
            v.create_file("School/Bio.md", ""),
            Err(AppError::AlreadyExists(_))
        ));
    }

    #[test]
    fn write_detects_conflict() {
        let (_d, v) = vault();
        v.create_file("a.md", "one").unwrap();
        let err = v.write_file("a.md", "two", Some(1)).unwrap_err();
        assert!(matches!(err, AppError::Conflict(_)));
        assert_eq!(v.read_file("a.md").unwrap().content, "one");
    }

    #[test]
    fn tree_hides_dot_entries_and_sorts_dirs_first() {
        let (_d, v) = vault();
        v.create_file("b.md", "").unwrap();
        v.create_file("A.md", "").unwrap();
        v.create_dir("zeta").unwrap();
        v.create_file(".hidden.md", "").unwrap();
        let tree = v.list_tree().unwrap();
        let names: Vec<_> = tree.children.unwrap().into_iter().map(|e| e.name).collect();
        assert_eq!(names, vec!["zeta", "A.md", "b.md"]);
    }

    #[test]
    fn rename_and_move() {
        let (_d, v) = vault();
        v.create_file("a.md", "x").unwrap();
        v.create_dir("folder").unwrap();
        let e = v.rename_entry("a.md", "folder/b.md").unwrap();
        assert_eq!(e.path, "folder/b.md");
        assert!(matches!(v.read_file("a.md"), Err(AppError::NotFound(_))));
        v.create_file("c.md", "").unwrap();
        assert!(matches!(
            v.rename_entry("c.md", "folder/b.md"),
            Err(AppError::AlreadyExists(_))
        ));
        assert!(matches!(
            v.rename_entry("folder", "folder/sub"),
            Err(AppError::InvalidName(_))
        ));
        // Case-only rename is allowed.
        v.rename_entry("c.md", "C.md").unwrap();
    }

    #[test]
    fn copies_files_and_folders_under_free_names() {
        let (_d, v) = vault();
        v.create_file("Biology.md", "cells").unwrap();
        v.create_file("School/Maths.md", "sums").unwrap();
        v.create_file("School/Week 1/Notes.md", "w1").unwrap();
        v.create_dir("Archive").unwrap();

        // Into another folder: same name. Into its own folder: "copy", then "copy 2".
        assert_eq!(
            v.copy_entry("Biology.md", "Archive").unwrap().path,
            "Archive/Biology.md"
        );
        assert_eq!(
            v.copy_entry("Biology.md", "").unwrap().path,
            "Biology copy.md"
        );
        assert_eq!(
            v.copy_entry("Biology.md", "").unwrap().path,
            "Biology copy 2.md"
        );
        assert_eq!(v.read_file("Biology copy 2.md").unwrap().content, "cells");
        assert_eq!(v.read_file("Biology.md").unwrap().content, "cells");

        // A folder comes with everything in it; a dotted folder name isn't split.
        let e = v.copy_entry("School", "").unwrap();
        assert_eq!(e.path, "School copy");
        assert_eq!(e.children.as_ref().map(Vec::len), Some(2));
        assert_eq!(
            v.read_file("School copy/Week 1/Notes.md").unwrap().content,
            "w1"
        );
        v.create_dir("v1.2").unwrap();
        assert_eq!(v.copy_entry("v1.2", "").unwrap().path, "v1.2 copy");
        // Into a sibling folder of itself is fine; into itself or below is not.
        assert_eq!(
            v.copy_entry("School", "Archive").unwrap().path,
            "Archive/School"
        );
        for dir in ["School", "School/Week 1"] {
            assert!(matches!(
                v.copy_entry("School", dir),
                Err(AppError::InvalidName(_))
            ));
        }
        // However the folder is spelled, it still can't go into itself (Windows and macOS
        // find "school/Week 1" inside "School").
        if cfg!(any(windows, target_os = "macos")) {
            assert!(matches!(
                v.copy_entry("School", "school/Week 1"),
                Err(AppError::InvalidName(_))
            ));
        }
        assert!(matches!(
            v.copy_entry("missing.md", ""),
            Err(AppError::NotFound(_))
        ));
        assert!(matches!(
            v.copy_entry("Biology.md", "nope"),
            Err(AppError::NotFound(_))
        ));
        assert!(matches!(
            v.copy_entry("../x", ""),
            Err(AppError::OutsideVault(_))
        ));
        assert!(matches!(
            v.copy_entry("Biology.md", "../x"),
            Err(AppError::OutsideVault(_))
        ));
    }

    #[test]
    fn rejects_invalid_names() {
        let (_d, v) = vault();
        assert!(matches!(
            v.create_file("bad:name.md", ""),
            Err(AppError::InvalidName(_))
        ));
        assert!(matches!(
            v.create_dir(" spaced"),
            Err(AppError::InvalidName(_))
        ));
    }

    #[test]
    fn copies_a_font_in_and_refuses_other_files() {
        let (_d, v) = vault();
        let outside = tempfile::tempdir().unwrap();
        let src = outside.path().join("Atkinson Hyperlegible.WOFF2");
        fs::write(&src, b"wOF2 fake").unwrap();
        let name = font_file_name(&src).unwrap();
        let rel = v.free_path("Attachments/Fonts", &name).unwrap();
        assert_eq!(rel, "Attachments/Fonts/Atkinson Hyperlegible.WOFF2");
        let entry = v.copy_font_in(&src, &rel).unwrap();
        assert_eq!(entry.path, rel);
        assert_eq!(fs::read(v.resolve(&rel).unwrap()).unwrap(), b"wOF2 fake");
        assert!(matches!(
            v.copy_font_in(&src, &rel),
            Err(AppError::AlreadyExists(_))
        ));
        let script = outside.path().join("font.exe");
        fs::write(&script, b"MZ").unwrap();
        assert!(matches!(
            font_file_name(&script),
            Err(AppError::InvalidName(_))
        ));
        assert!(matches!(
            font_file_name(&outside.path().join("missing.ttf")),
            Err(AppError::NotFound(_))
        ));
    }

    #[test]
    fn reads_a_skill_folder_with_its_reference_files_only() {
        let outside = tempfile::tempdir().unwrap();
        let dir = outside.path().join("grill-me");
        fs::create_dir_all(dir.join("agents")).unwrap();
        fs::create_dir_all(dir.join("scripts")).unwrap();
        fs::create_dir_all(dir.join("refs/deeper")).unwrap();
        fs::write(dir.join("SKILL.md"), "---\nname: grill-me\n---\nAsk.").unwrap();
        fs::write(dir.join("TESTS.md"), "More").unwrap();
        fs::write(dir.join("agents/openai.yaml"), "x: 1").unwrap();
        fs::write(dir.join("scripts/run.sh"), "echo hi").unwrap();
        fs::write(dir.join("refs/notes.md"), "Notes").unwrap();
        fs::write(dir.join("refs/deeper/too-deep.md"), "No").unwrap();
        fs::write(dir.join(".hidden.md"), "No").unwrap();
        let skill = read_skill_folder(&dir.join("SKILL.md")).unwrap();
        assert_eq!(skill.name, "grill-me");
        let paths: Vec<&str> = skill.files.iter().map(|(p, _)| p.as_str()).collect();
        assert_eq!(paths, ["SKILL.md", "TESTS.md", "refs/notes.md"]);
        // Only a SKILL.md is accepted.
        assert!(matches!(
            read_skill_folder(&dir.join("TESTS.md")),
            Err(AppError::InvalidName(_))
        ));
        assert!(matches!(
            read_skill_folder(&dir.join("missing/SKILL.md")),
            Err(AppError::NotFound(_))
        ));
        // A huge file is refused.
        fs::write(dir.join("BIG.md"), vec![b'a'; 600 * 1024]).unwrap();
        assert!(read_skill_folder(&dir.join("SKILL.md")).is_err());
    }

    #[test]
    fn copies_an_image_in_under_a_free_name() {
        let (_d, v) = vault();
        let outside = tempfile::tempdir().unwrap();
        let src = outside.path().join("Sunset.PNG");
        fs::write(&src, b"\x89PNG fake").unwrap();

        let name = image_file_name(&src).unwrap();
        assert_eq!(name, "Sunset.PNG");
        let rel = v.free_path("Notes/attachments", &name).unwrap();
        assert_eq!(rel, "Notes/attachments/Sunset.PNG");
        let entry = v.copy_image_in(&src, &rel).unwrap();
        assert_eq!(entry.path, rel);
        assert_eq!(
            fs::read(v.resolve(&rel).unwrap()).unwrap(),
            b"\x89PNG fake".to_vec()
        );

        // A second copy gets the next free name; the root folder works too.
        assert_eq!(
            v.free_path("/Notes/attachments/", &name).unwrap(),
            "Notes/attachments/Sunset 1.PNG"
        );
        assert_eq!(v.free_path("", "x.png").unwrap(), "x.png");
        // Never overwrites.
        assert!(matches!(
            v.copy_image_in(&src, &rel),
            Err(AppError::AlreadyExists(_))
        ));
    }

    #[test]
    fn refuses_non_images_missing_files_and_escapes() {
        let (_d, v) = vault();
        let outside = tempfile::tempdir().unwrap();
        let txt = outside.path().join("notes.txt");
        fs::write(&txt, "hi").unwrap();
        assert!(matches!(
            image_file_name(&txt),
            Err(AppError::InvalidName(_))
        ));
        assert!(matches!(
            image_file_name(&outside.path().join("gone.png")),
            Err(AppError::NotFound(_))
        ));
        assert!(matches!(
            image_file_name(outside.path()),
            Err(AppError::NotFound(_))
        ));
        assert!(matches!(
            v.free_path("../elsewhere", "x.png"),
            Err(AppError::OutsideVault(_))
        ));
        assert!(matches!(
            v.free_path("a", "bad:name.png"),
            Err(AppError::InvalidName(_))
        ));
    }

    #[test]
    fn refuses_images_over_the_size_cap() {
        let outside = tempfile::tempdir().unwrap();
        let big = outside.path().join("big.jpg");
        let f = fs::File::create(&big).unwrap();
        f.set_len(MAX_IMAGE_BYTES + 1).unwrap();
        assert!(matches!(image_file_name(&big), Err(AppError::Io(_))));
    }

    #[test]
    fn to_rel_uses_forward_slashes() {
        let (_d, v) = vault();
        let abs = v.root().join("x").join("y.md");
        assert_eq!(v.to_rel(&abs).as_deref(), Some("x/y.md"));
    }

    /// Uses the real system trash (Recycle Bin): the files are restored, so nothing is left.
    #[cfg(windows)]
    #[test]
    fn deleted_items_come_back_from_the_trash() {
        let (dir, v) = vault();
        fs::create_dir_all(dir.path().join("Notes/Sub")).unwrap();
        fs::write(dir.path().join("Notes/Sub/a.md"), "folder note").unwrap();
        fs::write(dir.path().join("loose.md"), "loose").unwrap();
        let since = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64
            - 2;
        v.trash_entry("Notes").unwrap();
        v.trash_entry("loose.md").unwrap();
        assert!(!dir.path().join("Notes").exists());
        // Nothing is restored unless every path is found.
        let missing = v.restore_from_trash(&["loose.md".into(), "never-deleted.md".into()], since);
        assert!(matches!(missing, Err(AppError::NotFound(_))), "{missing:?}");
        assert!(!dir.path().join("loose.md").exists());
        v.restore_from_trash(&["Notes".into(), "loose.md".into()], since)
            .unwrap();
        assert_eq!(
            fs::read_to_string(dir.path().join("Notes/Sub/a.md")).unwrap(),
            "folder note"
        );
        assert_eq!(
            fs::read_to_string(dir.path().join("loose.md")).unwrap(),
            "loose"
        );
        // A path that's taken again isn't overwritten.
        v.trash_entry("loose.md").unwrap();
        fs::write(dir.path().join("loose.md"), "new").unwrap();
        let taken = v.restore_from_trash(&["loose.md".into()], since);
        assert!(
            matches!(taken, Err(AppError::AlreadyExists(_))),
            "{taken:?}"
        );
        assert_eq!(
            fs::read_to_string(dir.path().join("loose.md")).unwrap(),
            "new"
        );
        // Tidy up: the second copy goes back next to it under another name, then away.
        fs::remove_file(dir.path().join("loose.md")).unwrap();
        v.restore_from_trash(&["loose.md".into()], since).unwrap();
    }
}
