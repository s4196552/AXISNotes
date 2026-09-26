//! Vault file-system core. All paths crossing the IPC boundary are
//! vault-relative with forward slashes (e.g. `School/Biology.md`).

pub mod watcher;

use std::fs;
use std::path::{Component, Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::Serialize;

use crate::error::{AppError, AppResult};

pub const META_DIR: &str = ".axis";

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

/// Hidden from the tree and from watcher events: dot-entries (`.axis`, `.git`, ...)
/// and our own temp files.
pub fn is_hidden_name(name: &str) -> bool {
    name.starts_with('.') || name.ends_with(".axis-tmp")
}

fn modified_ms(meta: &fs::Metadata) -> u64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn validate_name(name: &str) -> AppResult<()> {
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
    /// Open an existing folder as a vault, creating `.axis/` if missing.
    pub fn open(path: &Path) -> AppResult<Self> {
        let root = dunce::canonicalize(path)
            .map_err(|_| AppError::NotFound(path.display().to_string()))?;
        if !root.is_dir() {
            return Err(AppError::NotFound(root.display().to_string()));
        }
        let meta = root.join(META_DIR);
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

    fn entry_for(&self, abs: &Path, recurse: bool) -> AppResult<VaultEntry> {
        let meta = fs::metadata(abs)?;
        let kind = if meta.is_dir() {
            EntryKind::Dir
        } else {
            EntryKind::File
        };
        let children = if kind == EntryKind::Dir && recurse {
            let mut kids = Vec::new();
            for item in fs::read_dir(abs)? {
                let item = item?;
                let name = item.file_name().to_string_lossy().into_owned();
                if is_hidden_name(&name) {
                    continue;
                }
                kids.push(self.entry_for(&item.path(), true)?);
            }
            kids.sort_by(|a, b| {
                (a.kind != EntryKind::Dir, a.name.to_lowercase())
                    .cmp(&(b.kind != EntryKind::Dir, b.name.to_lowercase()))
            });
            Some(kids)
        } else if kind == EntryKind::Dir {
            Some(Vec::new())
        } else {
            None
        };
        Ok(VaultEntry {
            path: self.to_rel(abs).unwrap_or_default(),
            name: abs
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default(),
            kind,
            modified_ms: modified_ms(&meta),
            children,
        })
    }

    pub fn list_tree(&self) -> AppResult<VaultEntry> {
        let mut root = self.entry_for(&self.root, true)?;
        root.name = self.info().name;
        Ok(root)
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
        let tmp = abs.with_file_name(format!(".{file_name}.axis-tmp"));
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
    fn open_creates_meta_dir() {
        let (dir, _v) = vault();
        assert!(dir.path().join(".axis/config.json").is_file());
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
    fn to_rel_uses_forward_slashes() {
        let (_d, v) = vault();
        let abs = v.root().join("x").join("y.md");
        assert_eq!(v.to_rel(&abs).as_deref(), Some("x/y.md"));
    }
}
