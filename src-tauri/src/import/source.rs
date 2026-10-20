//! What an import reads from: a folder on disk or a `.zip` (including Notion's big exports,
//! a zip of `Part-N.zip` zips). Entries are listed up front with forward-slash paths and
//! read one at a time, so a large export never has to be unpacked first (Notion's long
//! names with IDs can also be too long to unpack on Windows).

use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

use crate::error::{AppError, AppResult};

/// More entries than this is not a note export (or is a zip bomb).
const MAX_ENTRIES: usize = 200_000;
/// A single note, table or attachment bigger than this is skipped.
pub(crate) const MAX_FILE_BYTES: u64 = 512 * 1024 * 1024;

enum Loc {
    File(PathBuf),
    Zip { archive: usize, index: usize },
}

pub(crate) struct Entry {
    /// Path inside the export, with `/` separators and no leading `/`.
    pub path: String,
    pub size: u64,
    loc: Loc,
}

/// A folder of temporary files, deleted when dropped (inner zips of a multi-part export).
struct TempDir(PathBuf);

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

pub(crate) struct Input {
    pub entries: Vec<Entry>,
    archives: Vec<zip::ZipArchive<fs::File>>,
    _temp: Option<TempDir>,
}

pub(crate) fn is_zip(path: &Path) -> bool {
    path.is_file()
        && path
            .extension()
            .is_some_and(|e| e.eq_ignore_ascii_case("zip"))
}

fn zip_error(e: zip::result::ZipError) -> AppError {
    AppError::Io(format!("couldn't read the zip file: {e}"))
}

/// Folders and files an import never brings in: hidden ones (`.obsidian`, `.trash`, `.git`),
/// macOS zip debris and package folders.
pub(crate) fn ignored_name(name: &str) -> bool {
    name.starts_with('.') || name == "__MACOSX" || name == "node_modules" || name == "Thumbs.db"
}

impl Input {
    /// Open a folder or a `.zip` file.
    pub fn open(source: &Path) -> AppResult<Input> {
        if source.is_dir() {
            Self::folder(source)
        } else if is_zip(source) {
            Self::zip(source)
        } else if source.is_file() {
            // A single file (an `.enex` notebook): an export of one entry.
            let name = source
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default();
            Ok(Input {
                entries: vec![Entry {
                    path: name,
                    size: fs::metadata(source)?.len(),
                    loc: Loc::File(source.to_path_buf()),
                }],
                archives: Vec::new(),
                _temp: None,
            })
        } else {
            Err(AppError::NotFound(source.display().to_string()))
        }
    }

    fn folder(source: &Path) -> AppResult<Input> {
        let mut entries = Vec::new();
        let mut stack = vec![PathBuf::new()];
        while let Some(rel) = stack.pop() {
            let mut children: Vec<_> = fs::read_dir(source.join(&rel))?
                .filter_map(Result::ok)
                .collect();
            children.sort_by_key(|e| e.file_name());
            for e in children {
                let name = e.file_name().to_string_lossy().into_owned();
                if ignored_name(&name) {
                    continue;
                }
                let child = rel.join(&name);
                let ft = e.file_type()?;
                if ft.is_dir() {
                    stack.push(child);
                } else if ft.is_file() {
                    entries.push(Entry {
                        path: child.to_string_lossy().replace('\\', "/"),
                        size: e.metadata().map(|m| m.len()).unwrap_or(0),
                        loc: Loc::File(source.join(&child)),
                    });
                    if entries.len() > MAX_ENTRIES {
                        return Err(AppError::Io(format!(
                            "the folder has more than {MAX_ENTRIES} files"
                        )));
                    }
                }
            }
        }
        entries.sort_by(|a, b| a.path.cmp(&b.path));
        Ok(Input {
            entries,
            archives: Vec::new(),
            _temp: None,
        })
    }

    fn zip(source: &Path) -> AppResult<Input> {
        let outer = zip::ZipArchive::new(fs::File::open(source)?).map_err(zip_error)?;
        let mut input = Input {
            entries: Vec::new(),
            archives: vec![outer],
            _temp: None,
        };
        let listed = input.list_archive(0)?;
        // Notion splits big exports into `…-Part-1.zip`, `…-Part-2.zip` inside one zip: when
        // the zip holds only zips, read those instead.
        let only_zips = !listed.is_empty()
            && listed
                .iter()
                .all(|e| e.path.to_lowercase().ends_with(".zip"));
        if !only_zips {
            input.entries = listed;
        } else {
            let temp = std::env::temp_dir().join(format!(
                "axisnotes-import-{}-{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_nanos())
                    .unwrap_or(0)
            ));
            fs::create_dir_all(&temp)?;
            input._temp = Some(TempDir(temp.clone()));
            for (n, part) in listed.iter().enumerate() {
                let file = temp.join(format!("part-{n}.zip"));
                let Loc::Zip { index, .. } = part.loc else {
                    continue;
                };
                {
                    let mut entry = input.archives[0].by_index(index).map_err(zip_error)?;
                    let mut out = fs::File::create(&file)?;
                    std::io::copy(&mut entry, &mut out)?;
                }
                let archive = zip::ZipArchive::new(fs::File::open(&file)?).map_err(zip_error)?;
                input.archives.push(archive);
                let at = input.archives.len() - 1;
                let inner = input.list_archive(at)?;
                input.entries.extend(inner);
                if input.entries.len() > MAX_ENTRIES {
                    return Err(AppError::Io(format!(
                        "the export has more than {MAX_ENTRIES} files"
                    )));
                }
            }
        }
        input.entries.sort_by(|a, b| a.path.cmp(&b.path));
        // The same path in two parts: keep the first.
        input.entries.dedup_by(|b, a| a.path == b.path);
        input.strip_wrapper();
        Ok(input)
    }

    fn list_archive(&mut self, at: usize) -> AppResult<Vec<Entry>> {
        let archive = &mut self.archives[at];
        if archive.len() > MAX_ENTRIES {
            return Err(AppError::Io(format!(
                "the zip file has more than {MAX_ENTRIES} entries"
            )));
        }
        let mut out = Vec::new();
        for index in 0..archive.len() {
            let entry = archive.by_index_raw(index).map_err(zip_error)?;
            if entry.is_dir() {
                continue;
            }
            // `enclosed_name` drops entries with `..` or absolute paths.
            let Some(path) = entry.enclosed_name() else {
                continue;
            };
            let path = path.to_string_lossy().replace('\\', "/");
            if path.is_empty() || path.split('/').any(ignored_name) {
                continue;
            }
            out.push(Entry {
                path,
                size: entry.size(),
                loc: Loc::Zip { archive: at, index },
            });
        }
        Ok(out)
    }

    /// A zip of one folder (`My Export/…`) imports that folder's contents.
    fn strip_wrapper(&mut self) {
        let Some(first) = self.entries.first() else {
            return;
        };
        let Some((top, _)) = first.path.split_once('/') else {
            return;
        };
        let prefix = format!("{top}/");
        if self.entries.iter().all(|e| e.path.starts_with(&prefix)) {
            for e in &mut self.entries {
                e.path = e.path[prefix.len()..].to_string();
            }
        }
    }

    /// The bytes of entry `i`.
    pub fn read(&mut self, i: usize) -> AppResult<Vec<u8>> {
        let entry = &self.entries[i];
        if entry.size > MAX_FILE_BYTES {
            return Err(AppError::Io("too large to import".into()));
        }
        match &entry.loc {
            Loc::File(p) => Ok(fs::read(p)?),
            Loc::Zip { archive, index } => {
                let mut file = self.archives[*archive]
                    .by_index(*index)
                    .map_err(zip_error)?;
                let mut bytes = Vec::with_capacity(entry.size.min(MAX_FILE_BYTES) as usize);
                file.by_ref()
                    .take(MAX_FILE_BYTES + 1)
                    .read_to_end(&mut bytes)?;
                Ok(bytes)
            }
        }
    }

    /// Entry `i` as text (invalid UTF-8 replaced, a byte-order mark dropped).
    pub fn read_text(&mut self, i: usize) -> AppResult<String> {
        let bytes = self.read(i)?;
        let text = String::from_utf8_lossy(&bytes);
        Ok(text.strip_prefix('\u{feff}').unwrap_or(&text).to_string())
    }
}
