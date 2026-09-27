//! Tauri commands. The TypeScript mirror of this contract is `src/ipc/`.
//!
//! Heavier commands are `async` so they run off the main (UI) thread.

use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::error::{AppError, AppResult};
use crate::index::graph::GraphData;
use crate::index::search::SearchHit;
use crate::index::tasks::TaskRef;
use crate::index::time::TimeEntry;
use crate::index::{rename, Backlink, Index, Mention, NoteRef, TagCount};
use crate::vault::watcher::{self, ChangeKind, SelfWrites, VaultChange, VaultWatcher};
use crate::vault::{FileContent, Vault, VaultEntry, VaultInfo, WriteResult};

pub const VAULT_CHANGED_EVENT: &str = "vault://changed";
/// Progress of bringing a newly opened vault's index up to date: `{ done, total, finished }`.
pub const INDEX_PROGRESS_EVENT: &str = "index://progress";

type SharedIndex = Arc<Mutex<Option<Index>>>;

#[derive(Default)]
pub struct AppState {
    vault: Mutex<Option<Vault>>,
    watcher: Mutex<Option<VaultWatcher>>,
    index: SharedIndex,
    self_writes: SelfWrites,
    /// Bumped each time a vault is opened, so a background index sync for the previous
    /// vault stops.
    generation: Arc<AtomicU64>,
}

#[derive(Clone, Serialize)]
struct IndexProgress {
    done: usize,
    total: usize,
    finished: bool,
}

#[derive(Clone, Serialize)]
struct VaultChangedPayload {
    changes: Vec<VaultChange>,
}

/// Apply watcher changes to the index. Index errors are logged, never fatal: it's a cache.
fn apply_to_index(index: &SharedIndex, vault: &Vault, changes: &[VaultChange]) {
    let mut guard = index.lock().unwrap();
    let Some(idx) = guard.as_mut() else { return };
    for c in changes {
        let result = match c.kind {
            ChangeKind::Removed => c.paths.iter().try_for_each(|p| idx.remove_path(p)),
            ChangeKind::Renamed => {
                let (from, to) = (&c.paths[0], c.paths.last().unwrap());
                idx.remove_path(from)
                    .and_then(|_| idx.update_path(vault, to))
            }
            ChangeKind::Created | ChangeKind::Modified => {
                c.paths.iter().try_for_each(|p| idx.update_path(vault, p))
            }
        };
        if let Err(e) = result {
            eprintln!("index update failed: {e}");
        }
    }
}

impl AppState {
    fn vault(&self) -> AppResult<Vault> {
        self.vault.lock().unwrap().clone().ok_or(AppError::NoVault)
    }

    /// The open vault (for other command modules).
    pub(crate) fn current(&self) -> AppResult<Vault> {
        self.vault()
    }

    /// Mark a path as touched by the app so the watcher ignores its echo.
    fn touch(&self, vault: &Vault, rel: &str) -> AppResult<()> {
        self.self_writes.mark(&vault.resolve(rel)?);
        Ok(())
    }

    fn with_index<T>(&self, f: impl FnOnce(&mut Index) -> AppResult<T>) -> AppResult<T> {
        let mut guard = self.index.lock().unwrap();
        f(guard.as_mut().ok_or(AppError::NoVault)?)
    }

    /// Keep the index in step with a change the app itself made (the watcher ignores those).
    fn reindex(&self, vault: &Vault, change: VaultChange) {
        apply_to_index(&self.index, vault, &[change]);
    }

    /// Open `path` as the vault at startup (used by `AXIS_OPEN_VAULT`, e.g. in E2E tests).
    pub fn open_at_startup(&self, app: &AppHandle, path: &str) -> AppResult<VaultInfo> {
        self.activate(app, Vault::open(&PathBuf::from(path))?)
    }

    fn activate(&self, app: &AppHandle, vault: Vault) -> AppResult<VaultInfo> {
        // Drop the old watcher/index before opening the new ones.
        *self.watcher.lock().unwrap() = None;
        // Images in the vault (embeds, clipped screenshots) load through the asset
        // protocol; only the open vault is readable that way.
        let _ = app
            .asset_protocol_scope()
            .allow_directory(vault.root(), true);
        // Open straight away; catching the index up happens in the background, so a big
        // vault opens at once and fills in as it's read.
        *self.index.lock().unwrap() = Some(Index::open_unsynced(&vault)?);
        let generation = self.generation.fetch_add(1, Ordering::SeqCst) + 1;
        spawn_index_sync(
            app.clone(),
            vault.clone(),
            self.generation.clone(),
            generation,
        );

        let emitter = app.clone();
        let index = self.index.clone();
        let for_index = vault.clone();
        let w = watcher::start(vault.clone(), self.self_writes.clone(), move |changes| {
            apply_to_index(&index, &for_index, &changes);
            let _ = emitter.emit(VAULT_CHANGED_EVENT, VaultChangedPayload { changes });
        })?;
        let info = vault.info();
        *self.watcher.lock().unwrap() = Some(w);
        *self.vault.lock().unwrap() = Some(vault);
        Ok(info)
    }
}

/// Bring `vault`'s index up to date on its own thread and connection, reporting progress
/// with `INDEX_PROGRESS_EVENT`. Stops early if another vault is opened meanwhile.
fn spawn_index_sync(app: AppHandle, vault: Vault, current: Arc<AtomicU64>, generation: u64) {
    std::thread::spawn(move || {
        let stale = || current.load(Ordering::SeqCst) != generation;
        let mut last = Instant::now();
        let mut report = |done: usize, total: usize| {
            // At most a few updates a second, and none for a quick catch-up.
            if total > 0 && last.elapsed() >= Duration::from_millis(250) {
                last = Instant::now();
                let _ = app.emit(
                    INDEX_PROGRESS_EVENT,
                    IndexProgress {
                        done,
                        total,
                        finished: false,
                    },
                );
            }
        };
        let result = Index::open_unsynced(&vault)
            .and_then(|mut idx| idx.sync_with_progress(&vault, &stale, &mut report));
        if let Err(e) = result {
            eprintln!("indexing {} failed: {e}", vault.root().display());
        }
        if !stale() {
            let _ = app.emit(
                INDEX_PROGRESS_EVENT,
                IndexProgress {
                    done: 0,
                    total: 0,
                    finished: true,
                },
            );
        }
    });
}

fn change(kind: ChangeKind, paths: &[&str]) -> VaultChange {
    VaultChange {
        kind,
        paths: paths.iter().map(|p| p.to_string()).collect(),
    }
}

#[tauri::command]
pub async fn open_vault(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
) -> AppResult<VaultInfo> {
    let vault = Vault::open(&PathBuf::from(path))?;
    state.activate(&app, vault)
}

#[tauri::command]
pub async fn create_vault(
    app: AppHandle,
    state: State<'_, AppState>,
    parent_dir: String,
    name: String,
) -> AppResult<VaultInfo> {
    let vault = Vault::create(&PathBuf::from(parent_dir), &name)?;
    state.activate(&app, vault)
}

#[tauri::command]
pub fn current_vault(state: State<AppState>) -> Option<VaultInfo> {
    state.vault.lock().unwrap().as_ref().map(Vault::info)
}

#[tauri::command]
pub fn list_tree(state: State<AppState>) -> AppResult<VaultEntry> {
    state.vault()?.list_tree()
}

#[tauri::command]
pub fn read_file(state: State<AppState>, path: String) -> AppResult<FileContent> {
    state.vault()?.read_file(&path)
}

#[tauri::command]
pub fn write_file(
    state: State<AppState>,
    path: String,
    content: String,
    expected_modified_ms: Option<u64>,
) -> AppResult<WriteResult> {
    let v = state.vault()?;
    state.touch(&v, &path)?;
    let res = v.write_file(&path, &content, expected_modified_ms)?;
    state
        .self_writes
        .record_write(&v.resolve(&path)?, res.modified_ms);
    state.reindex(&v, change(ChangeKind::Modified, &[&path]));
    Ok(res)
}

#[tauri::command]
pub fn create_file(
    state: State<AppState>,
    path: String,
    content: Option<String>,
) -> AppResult<VaultEntry> {
    let v = state.vault()?;
    state.touch(&v, &path)?;
    let entry = v.create_file(&path, content.as_deref().unwrap_or(""))?;
    state.reindex(&v, change(ChangeKind::Created, &[&path]));
    Ok(entry)
}

#[tauri::command]
pub fn create_dir(state: State<AppState>, path: String) -> AppResult<VaultEntry> {
    let v = state.vault()?;
    state.touch(&v, &path)?;
    v.create_dir(&path)
}

/// Rename or move, rewriting wikilinks that pointed at the moved notes. Rewritten notes
/// are announced as `modified` so open editors reload them.
#[tauri::command]
pub async fn rename_entry(
    app: AppHandle,
    state: State<'_, AppState>,
    from: String,
    to: String,
) -> AppResult<VaultEntry> {
    let v = state.vault()?;
    state.touch(&v, &from)?;
    state.touch(&v, &to)?;
    let outcome = {
        let mut guard = state.index.lock().unwrap();
        match guard.as_mut() {
            Some(idx) => rename::rename_with_links(&v, idx, &from, &to, |p| {
                if let Ok(abs) = v.resolve(p) {
                    state.self_writes.mark(&abs);
                }
            })?,
            None => rename::RenameOutcome {
                entry: v.rename_entry(&from, &to)?,
                updated: Vec::new(),
            },
        }
    };
    if !outcome.updated.is_empty() {
        let changes = vec![VaultChange {
            kind: ChangeKind::Modified,
            paths: outcome.updated,
        }];
        let _ = app.emit(VAULT_CHANGED_EVENT, VaultChangedPayload { changes });
    }
    Ok(outcome.entry)
}

#[tauri::command]
pub fn trash_entry(state: State<AppState>, path: String) -> AppResult<()> {
    let v = state.vault()?;
    state.touch(&v, &path)?;
    v.trash_entry(&path)?;
    state.reindex(&v, change(ChangeKind::Removed, &[&path]));
    Ok(())
}

#[tauri::command]
pub async fn search(
    state: State<'_, AppState>,
    query: String,
    limit: Option<usize>,
) -> AppResult<Vec<SearchHit>> {
    state.with_index(|idx| idx.search(&query, limit.unwrap_or(50)))
}

#[tauri::command]
pub fn list_tags(state: State<AppState>) -> AppResult<Vec<TagCount>> {
    state.with_index(|idx| idx.tags())
}

#[tauri::command]
pub fn list_tasks(state: State<AppState>) -> AppResult<Vec<TaskRef>> {
    state.with_index(|idx| idx.tasks())
}

#[tauri::command]
pub fn time_entries(state: State<AppState>) -> AppResult<Vec<TimeEntry>> {
    state.with_index(|idx| idx.time_entries())
}

#[tauri::command]
pub fn list_notes(state: State<AppState>) -> AppResult<Vec<NoteRef>> {
    state.with_index(|idx| idx.list_notes())
}

#[tauri::command]
pub fn resolve_link(
    state: State<AppState>,
    target: String,
    from: String,
) -> AppResult<Option<String>> {
    state.with_index(|idx| idx.resolve(&target, &from))
}

#[tauri::command]
pub async fn backlinks(state: State<'_, AppState>, path: String) -> AppResult<Vec<Backlink>> {
    state.with_index(|idx| idx.backlinks(&path))
}

#[tauri::command]
pub async fn unlinked_mentions(
    state: State<'_, AppState>,
    path: String,
) -> AppResult<Vec<Mention>> {
    let v = state.vault()?;
    state.with_index(|idx| idx.unlinked_mentions(&v, &path))
}

#[tauri::command]
pub async fn graph(state: State<'_, AppState>) -> AppResult<GraphData> {
    state.with_index(|idx| idx.graph())
}

/// CSS files in `.axisnotes/themes` or `.axisnotes/snippets` (names without `.css`).
#[tauri::command]
pub fn list_axis_files(state: State<AppState>, subdir: String) -> AppResult<Vec<String>> {
    if subdir != "themes" && subdir != "snippets" {
        return Err(AppError::InvalidName(subdir));
    }
    let v = state.vault()?;
    let dir = v.resolve(&format!(".axisnotes/{subdir}"))?;
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Ok(Vec::new());
    };
    let mut names: Vec<String> = entries
        .flatten()
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().into_owned();
            name.strip_suffix(".css").map(String::from)
        })
        .collect();
    names.sort();
    Ok(names)
}

/// What importing `source` would bring in (shown before importing).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportPreview {
    pub obsidian: bool,
    pub name: String,
}

#[tauri::command]
pub fn inspect_import(source: String) -> AppResult<ImportPreview> {
    let path = PathBuf::from(&source);
    if !path.is_dir() {
        return Err(AppError::NotFound(source));
    }
    Ok(ImportPreview {
        obsidian: crate::import::is_obsidian_vault(&path),
        name: path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default(),
    })
}

/// Copy an Obsidian vault (or any folder of Markdown) into the open vault.
#[tauri::command]
pub async fn import_obsidian(
    state: State<'_, AppState>,
    source: String,
    target: String,
) -> AppResult<crate::import::ImportReport> {
    let vault = state.vault()?;
    let report = crate::import::import_obsidian(&vault, &PathBuf::from(source), &target)?;
    // Thousands of new files at once: rescan instead of relying on watcher events.
    state.with_index(|i| i.sync(&vault))?;
    Ok(report)
}

/// Font families installed on this computer (for Settings → Appearance), read once.
#[tauri::command]
pub async fn list_fonts() -> Vec<String> {
    static FONTS: std::sync::OnceLock<Vec<String>> = std::sync::OnceLock::new();
    FONTS.get_or_init(installed_fonts).clone()
}

fn installed_fonts() -> Vec<String> {
    let mut db = fontdb::Database::new();
    db.load_system_fonts();
    let mut names: Vec<String> = db
        .faces()
        .filter_map(|f| f.families.first().map(|(name, _)| name.trim().to_string()))
        // "@" families are vertical variants of CJK fonts.
        .filter(|n| !n.is_empty() && !n.starts_with('@'))
        .collect();
    names.sort_by_key(|n| n.to_lowercase());
    names.dedup();
    names
}

#[cfg(test)]
mod font_tests {
    #[test]
    fn lists_installed_fonts_sorted_without_duplicates() {
        let fonts = super::installed_fonts();
        // Every desktop OS we ship on has some fonts installed.
        assert!(!fonts.is_empty());
        let mut sorted = fonts.clone();
        sorted.sort_by_key(|n| n.to_lowercase());
        sorted.dedup();
        assert_eq!(fonts, sorted);
        assert!(fonts.iter().all(|f| !f.starts_with('@')));
    }
}
