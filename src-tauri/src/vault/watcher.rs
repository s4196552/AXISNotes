//! Watches the vault for changes made outside the app and reports them as
//! vault-relative `VaultChange`s. Changes the app made itself are suppressed.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use notify::event::{EventKind, ModifyKind};
use notify::{RecommendedWatcher, RecursiveMode};
use notify_debouncer_full::{new_debouncer, DebounceEventResult, Debouncer, RecommendedCache};
use serde::Serialize;

use super::{is_hidden_name, Vault};
use crate::error::{AppError, AppResult};

const DEBOUNCE: Duration = Duration::from_millis(250);
const SELF_WRITE_WINDOW: Duration = Duration::from_millis(2000);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ChangeKind {
    Created,
    Modified,
    Removed,
    Renamed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct VaultChange {
    pub kind: ChangeKind,
    /// Vault-relative paths. For `renamed`, `[from, to]` when both are known.
    pub paths: Vec<String>,
}

/// Paths the app itself just touched, so their watcher echoes can be ignored.
#[derive(Debug, Clone, Default)]
pub struct SelfWrites(Arc<Mutex<HashMap<PathBuf, Instant>>>);

impl SelfWrites {
    pub fn mark(&self, path: &Path) {
        let mut map = self.0.lock().unwrap();
        let now = Instant::now();
        map.retain(|_, t| now.duration_since(*t) < SELF_WRITE_WINDOW);
        map.insert(path.to_path_buf(), now);
    }

    fn is_recent(&self, path: &Path) -> bool {
        let map = self.0.lock().unwrap();
        map.get(path)
            .is_some_and(|t| t.elapsed() < SELF_WRITE_WINDOW)
    }
}

pub type VaultWatcher = Debouncer<RecommendedWatcher, RecommendedCache>;

fn is_hidden_path(vault: &Vault, abs: &Path) -> bool {
    match abs.strip_prefix(vault.root()) {
        Ok(rel) => rel
            .components()
            .any(|c| is_hidden_name(&c.as_os_str().to_string_lossy())),
        Err(_) => true,
    }
}

/// Convert raw notify events into vault changes, dropping hidden paths and self-writes.
pub fn translate(
    vault: &Vault,
    self_writes: &SelfWrites,
    kind: &EventKind,
    paths: &[PathBuf],
) -> Option<VaultChange> {
    let change_kind = match kind {
        EventKind::Create(_) => ChangeKind::Created,
        EventKind::Modify(ModifyKind::Name(_)) => ChangeKind::Renamed,
        EventKind::Modify(ModifyKind::Metadata(_)) => return None,
        EventKind::Modify(_) => ChangeKind::Modified,
        EventKind::Remove(_) => ChangeKind::Removed,
        _ => return None,
    };
    let visible: Vec<&PathBuf> = paths.iter().filter(|p| !is_hidden_path(vault, p)).collect();
    if visible.is_empty() || visible.iter().all(|p| self_writes.is_recent(p)) {
        return None;
    }
    let rel: Vec<String> = visible.iter().filter_map(|p| vault.to_rel(p)).collect();
    if rel.is_empty() {
        return None;
    }
    Some(VaultChange {
        kind: change_kind,
        paths: rel,
    })
}

pub fn start(
    vault: Vault,
    self_writes: SelfWrites,
    on_change: impl Fn(Vec<VaultChange>) + Send + 'static,
) -> AppResult<VaultWatcher> {
    let root = vault.root().to_path_buf();
    let mut debouncer = new_debouncer(DEBOUNCE, None, move |res: DebounceEventResult| {
        let Ok(events) = res else { return };
        let mut changes: Vec<VaultChange> = Vec::new();
        for ev in events {
            if let Some(change) = translate(&vault, &self_writes, &ev.event.kind, &ev.event.paths) {
                if !changes.contains(&change) {
                    changes.push(change);
                }
            }
        }
        if !changes.is_empty() {
            on_change(changes);
        }
    })
    .map_err(|e| AppError::Io(e.to_string()))?;
    debouncer
        .watch(&root, RecursiveMode::Recursive)
        .map_err(|e| AppError::Io(e.to_string()))?;
    Ok(debouncer)
}

#[cfg(test)]
mod tests {
    use super::*;
    use notify::event::{CreateKind, DataChange, RemoveKind};

    #[test]
    fn translates_and_filters_events() {
        let dir = tempfile::tempdir().unwrap();
        let v = Vault::open(dir.path()).unwrap();
        let sw = SelfWrites::default();
        let note = v.root().join("n.md");

        let c = translate(
            &v,
            &sw,
            &EventKind::Create(CreateKind::File),
            std::slice::from_ref(&note),
        )
        .unwrap();
        assert_eq!(
            c,
            VaultChange {
                kind: ChangeKind::Created,
                paths: vec!["n.md".into()]
            }
        );

        let hidden = v.root().join(".axis").join("index.db");
        assert!(translate(&v, &sw, &EventKind::Remove(RemoveKind::File), &[hidden]).is_none());

        sw.mark(&note);
        let modify = EventKind::Modify(ModifyKind::Data(DataChange::Content));
        assert!(translate(&v, &sw, &modify, &[note]).is_none());
    }

    #[test]
    fn reports_external_edits() {
        let dir = tempfile::tempdir().unwrap();
        let v = Vault::open(dir.path()).unwrap();
        let (tx, rx) = std::sync::mpsc::channel();
        let _w = start(v.clone(), SelfWrites::default(), move |c| {
            let _ = tx.send(c);
        })
        .unwrap();
        std::thread::sleep(Duration::from_millis(200));
        std::fs::write(v.root().join("ext.md"), "hi").unwrap();
        let changes = rx
            .recv_timeout(Duration::from_secs(5))
            .expect("no watcher event");
        assert!(changes
            .iter()
            .any(|c| c.paths.contains(&"ext.md".to_string())));
    }
}
