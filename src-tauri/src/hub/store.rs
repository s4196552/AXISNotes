use super::model::Library;
use fs2::FileExt;
use ring::digest::{digest, SHA256};
use serde::Serialize;
use std::{
    fs::{self, File, OpenOptions},
    io::{self, Read, Write},
    path::Path,
};

pub const MAX_BYTES: u64 = 24 * 1024 * 1024;

#[derive(Serialize)]
pub struct Snapshot {
    pub library: Library,
    pub revision: String,
}

fn revision(bytes: &[u8]) -> String {
    digest(&SHA256, bytes)
        .as_ref()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

pub fn read(directory: &Path) -> Result<Snapshot, String> {
    let path = directory.join("library.json");
    let load = || -> Result<Snapshot, String> {
        let file = match File::open(&path) {
            Ok(file) => file,
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                return Ok(Snapshot {
                    library: Library::default(),
                    revision: "new".into(),
                });
            }
            Err(error) => return Err(error.to_string()),
        };
        let mut bytes = Vec::new();
        file.take(MAX_BYTES + 1)
            .read_to_end(&mut bytes)
            .map_err(|error| error.to_string())?;
        if bytes.len() as u64 > MAX_BYTES {
            return Err("The file exceeds 24 MiB.".into());
        }
        let library: Library = serde_json::from_slice(&bytes).map_err(|error| error.to_string())?;
        library.validate()?;
        Ok(Snapshot {
            library,
            revision: revision(&bytes),
        })
    };
    load().map_err(|error| format!("Could not open {}. {error}", path.display()))
}

pub fn save(directory: &Path, library: &Library, expected: &str) -> Result<String, String> {
    library.validate()?;
    let bytes = serde_json::to_vec(library).map_err(|error| error.to_string())?;
    if bytes.len() as u64 > MAX_BYTES {
        return Err("The library exceeds 24 MiB.".into());
    }
    let write = || -> Result<String, String> {
        fs::create_dir_all(directory).map_err(|error| error.to_string())?;
        let lock = OpenOptions::new()
            .create(true)
            .truncate(false)
            .write(true)
            .open(directory.join("library.lock"))
            .map_err(|error| error.to_string())?;
        lock.try_lock_exclusive()
            .map_err(|_| "The Hub library is busy. Try again in a moment.".to_owned())?;
        if read(directory)?.revision != expected {
            return Err("The Hub library changed. Reopen this dialog and try again.".into());
        }
        let mut temp =
            tempfile::NamedTempFile::new_in(directory).map_err(|error| error.to_string())?;
        temp.write_all(&bytes)
            .and_then(|_| temp.as_file().sync_all())
            .map_err(|error| error.to_string())?;
        temp.persist(directory.join("library.json"))
            .map_err(|error| error.to_string())?;
        Ok(revision(&bytes))
    };
    write().map_err(|error| format!("Could not save the Hub library. {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preserves_shared_library_and_rejects_stale_changes() {
        let dir = tempfile::tempdir().unwrap();
        let first = read(dir.path()).unwrap();
        let mut updated = read(dir.path()).unwrap();
        updated.library.plugins[0].groups[0].name = "Studio".into();
        let saved = save(dir.path(), &updated.library, &updated.revision).unwrap();
        assert!(save(dir.path(), &first.library, &first.revision).is_err());
        let restored = read(dir.path()).unwrap();
        assert_eq!(restored.revision, saved);
        assert_eq!(restored.library.plugins[0].groups[0].name, "Studio");
    }

    #[test]
    fn keeps_invalid_legacy_data_on_disk() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("library.json");
        fs::write(&path, "broken data").unwrap();
        assert!(read(dir.path()).is_err());
        assert!(save(dir.path(), &Library::default(), "new").is_err());
        assert_eq!(fs::read_to_string(path).unwrap(), "broken data");
    }
}
