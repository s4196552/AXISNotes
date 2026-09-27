//! Watches the vault for changes made outside the app and reports them as
//! vault-relative `VaultChange`s. Changes the app made itself are suppressed.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use notify::event::{EventKind, ModifyKind, RenameMode};
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

#[derive(Debug, Clone, Copy)]
struct SelfMark {
    at: Instant,
    /// For file writes: the mtime our write produced. While the file still has this
    /// mtime, events for it are our own echo; any other mtime means someone else wrote.
    mtime_ms: Option<u64>,
}

/// Paths the app itself just touched, so their watcher echoes can be ignored.
#[derive(Debug, Clone, Default)]
pub struct SelfWrites(Arc<Mutex<HashMap<PathBuf, SelfMark>>>);

impl SelfWrites {
    /// Mark a path the app is about to change (create/rename/trash, or a write in flight).
    pub fn mark(&self, path: &Path) {
        let mut map = self.0.lock().unwrap();
        let now = Instant::now();
        map.retain(|_, m| now.duration_since(m.at) < SELF_WRITE_WINDOW);
        map.insert(
            path.to_path_buf(),
            SelfMark {
                at: now,
                mtime_ms: None,
            },
        );
    }

    /// Record the mtime a completed write produced, so only that exact version is ignored.
    pub fn record_write(&self, path: &Path, mtime_ms: u64) {
        let mut map = self.0.lock().unwrap();
        map.insert(
            path.to_path_buf(),
            SelfMark {
                at: Instant::now(),
                mtime_ms: Some(mtime_ms),
            },
        );
    }

    fn is_self(&self, path: &Path) -> bool {
        let map = self.0.lock().unwrap();
        let Some(mark) = map.get(path) else {
            return false;
        };
        if mark.at.elapsed() >= SELF_WRITE_WINDOW {
            return false;
        }
        match mark.mtime_ms {
            Some(ours) => std::fs::metadata(path)
                .map(|m| super::modified_ms(&m) == ours)
                .unwrap_or(false),
            None => true,
        }
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

fn gone_or_modified(path: &Path) -> ChangeKind {
    if path.exists() {
        ChangeKind::Modified
    } else {
        ChangeKind::Removed
    }
}

/// Convert a raw notify event into vault changes, dropping hidden paths and self-writes.
///
/// Renames are classified by what happened to each visible path: a rename *onto* a path
/// (including the temp-file-then-rename "atomic save" many editors use) is `modified`,
/// a rename *away from* a path is `removed`, and only a rename between two visible paths
/// is reported as `renamed` with `[from, to]`.
pub fn translate(
    vault: &Vault,
    self_writes: &SelfWrites,
    kind: &EventKind,
    paths: &[PathBuf],
) -> Vec<VaultChange> {
    let visible = |p: &PathBuf| !is_hidden_path(vault, p);
    let mut out = Vec::new();
    let mut emit = |kind: ChangeKind, ps: Vec<&PathBuf>| {
        if ps.is_empty() || ps.iter().all(|p| self_writes.is_self(p)) {
            return;
        }
        let rel: Vec<String> = ps.iter().filter_map(|p| vault.to_rel(p)).collect();
        if !rel.is_empty() {
            out.push(VaultChange { kind, paths: rel });
        }
    };
    match kind {
        EventKind::Create(_) => emit(
            ChangeKind::Created,
            paths.iter().filter(|p| visible(p)).collect(),
        ),
        // Windows reports an atomic replace (rename over an existing file) as a remove of
        // the target. Events are debounced, so a path that exists again was replaced.
        EventKind::Remove(_) | EventKind::Modify(ModifyKind::Name(RenameMode::From)) => {
            for p in paths.iter().filter(|p| visible(p)) {
                emit(gone_or_modified(p), vec![p]);
            }
        }
        EventKind::Modify(ModifyKind::Metadata(_)) => {}
        EventKind::Modify(ModifyKind::Name(mode)) => match (mode, paths) {
            (RenameMode::Both, [from, to]) => match (visible(from), visible(to)) {
                (true, true) => emit(ChangeKind::Renamed, vec![from, to]),
                (false, true) => emit(ChangeKind::Modified, vec![to]),
                (true, false) => emit(ChangeKind::Removed, vec![from]),
                (false, false) => {}
            },
            (RenameMode::To, _) => emit(
                ChangeKind::Modified,
                paths.iter().filter(|p| visible(p)).collect(),
            ),
            // Direction unknown: decide per path by whether it exists now.
            _ => {
                for p in paths.iter().filter(|p| visible(p)) {
                    emit(gone_or_modified(p), vec![p]);
                }
            }
        },
        EventKind::Modify(_) => emit(
            ChangeKind::Modified,
            paths.iter().filter(|p| visible(p)).collect(),
        ),
        _ => {}
    }
    out
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
            for change in translate(&vault, &self_writes, &ev.event.kind, &ev.event.paths) {
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

    fn change(kind: ChangeKind, paths: &[&str]) -> VaultChange {
        VaultChange {
            kind,
            paths: paths.iter().map(|p| p.to_string()).collect(),
        }
    }

    #[test]
    fn translates_and_filters_events() {
        let dir = tempfile::tempdir().unwrap();
        let v = Vault::open(dir.path()).unwrap();
        let sw = SelfWrites::default();
        let note = v.root().join("n.md");

        let created = translate(
            &v,
            &sw,
            &EventKind::Create(CreateKind::File),
            std::slice::from_ref(&note),
        );
        assert_eq!(created, vec![change(ChangeKind::Created, &["n.md"])]);

        let hidden = v.root().join(".axisnotes").join("index.db");
        assert!(translate(&v, &sw, &EventKind::Remove(RemoveKind::File), &[hidden]).is_empty());

        sw.mark(&note);
        let modify = EventKind::Modify(ModifyKind::Data(DataChange::Content));
        assert!(translate(&v, &sw, &modify, &[note]).is_empty());
    }

    #[test]
    fn classifies_renames_by_direction() {
        let dir = tempfile::tempdir().unwrap();
        let v = Vault::open(dir.path()).unwrap();
        let sw = SelfWrites::default();
        let (a, b) = (v.root().join("a.md"), v.root().join("b.md"));
        let tmp = v.root().join(".a.md.axisnotes-tmp");
        let name = |m| EventKind::Modify(ModifyKind::Name(m));

        // Atomic save by another editor: hidden temp file renamed over the note.
        assert_eq!(
            translate(&v, &sw, &name(RenameMode::Both), &[tmp.clone(), a.clone()]),
            vec![change(ChangeKind::Modified, &["a.md"])]
        );
        assert_eq!(
            translate(&v, &sw, &name(RenameMode::Both), &[a.clone(), b.clone()]),
            vec![change(ChangeKind::Renamed, &["a.md", "b.md"])]
        );
        assert_eq!(
            translate(&v, &sw, &name(RenameMode::Both), &[a.clone(), tmp]),
            vec![change(ChangeKind::Removed, &["a.md"])]
        );
        assert_eq!(
            translate(&v, &sw, &name(RenameMode::To), std::slice::from_ref(&b)),
            vec![change(ChangeKind::Modified, &["b.md"])]
        );
        assert_eq!(
            translate(&v, &sw, &name(RenameMode::From), std::slice::from_ref(&a)),
            vec![change(ChangeKind::Removed, &["a.md"])]
        );
        // Unknown direction: decided by existence.
        std::fs::write(&b, "x").unwrap();
        assert_eq!(
            translate(&v, &sw, &name(RenameMode::Any), &[a, b]),
            vec![
                change(ChangeKind::Removed, &["a.md"]),
                change(ChangeKind::Modified, &["b.md"])
            ]
        );
    }

    #[test]
    fn external_write_right_after_our_write_is_not_suppressed() {
        let dir = tempfile::tempdir().unwrap();
        let v = Vault::open(dir.path()).unwrap();
        let sw = SelfWrites::default();
        let note = v.root().join("n.md");
        let modify = EventKind::Modify(ModifyKind::Data(DataChange::Content));

        sw.mark(&note);
        let ours = v.write_file("n.md", "ours", None).unwrap();
        sw.record_write(&note, ours.modified_ms);
        assert!(translate(&v, &sw, &modify, std::slice::from_ref(&note)).is_empty());

        // Another program writes within the suppression window: must be reported.
        std::thread::sleep(Duration::from_millis(30));
        std::fs::write(&note, "theirs").unwrap();
        assert!(!translate(&v, &sw, &modify, std::slice::from_ref(&note)).is_empty());
    }

    #[test]
    fn atomic_replace_by_another_program_is_a_modification() {
        let dir = tempfile::tempdir().unwrap();
        let v = Vault::open(dir.path()).unwrap();
        std::fs::write(v.root().join("n.md"), "old").unwrap();
        let (tx, rx) = std::sync::mpsc::channel();
        let _w = start(v.clone(), SelfWrites::default(), move |c| {
            let _ = tx.send(c);
        })
        .unwrap();
        std::thread::sleep(Duration::from_millis(200));
        let tmp = v.root().join(".n.md.tmp-editor");
        std::fs::write(&tmp, "new").unwrap();
        std::fs::rename(&tmp, v.root().join("n.md")).unwrap();

        let mut seen = Vec::new();
        while let Ok(batch) = rx.recv_timeout(Duration::from_millis(1500)) {
            seen.extend(batch);
        }
        let for_note: Vec<_> = seen
            .iter()
            .filter(|c| c.paths.contains(&"n.md".into()))
            .collect();
        assert!(!for_note.is_empty(), "no event for n.md: {seen:?}");
        assert!(
            for_note
                .iter()
                .all(|c| matches!(c.kind, ChangeKind::Modified | ChangeKind::Created)),
            "atomic replace must not look like a delete/move: {seen:?}"
        );
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
