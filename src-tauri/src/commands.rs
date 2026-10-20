//! Tauri commands. The TypeScript mirror of this contract is `src/ipc/`.
//!
//! Heavier commands are `async` so they run off the main (UI) thread.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::attachments;
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
/// Files from outside were dropped on the window: `{ x, y, count }` (physical pixels).
pub const FILES_DROPPED_EVENT: &str = "attachments://dropped";

/// The files most recently dropped onto the window from outside (set in `lib.rs`). The
/// page can import only these, or what the user picks in `pick_attachments`: never a
/// path it names itself.
#[derive(Default)]
pub struct DroppedFiles(pub Mutex<Vec<PathBuf>>);

/// What an import of dropped or picked files did: the vault paths of those that made it in,
/// and the ones that didn't, with why.
#[derive(Default, Serialize)]
pub struct Imported {
    paths: Vec<String>,
    failed: Vec<ImportFailure>,
}

#[derive(Serialize)]
pub struct ImportFailure {
    name: String,
    error: String,
}

#[derive(Clone, Serialize)]
pub struct FilesDropped {
    pub x: f64,
    pub y: f64,
    pub count: usize,
}

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

    /// The open vault, provided it is the one at `expected_root` (when given). A write
    /// sent for one vault must never land in another that was opened meanwhile (T-073).
    fn vault_at(&self, expected_root: Option<&str>) -> AppResult<Vault> {
        let v = self.vault()?;
        ensure_vault(&v, expected_root)?;
        Ok(v)
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

    /// Bring files the user dropped or picked into the vault's `dir` (vault files are
    /// linked where they are; folders are skipped). Each file succeeds or fails on its
    /// own: the ones that made it in are always reported, so they get embedded.
    fn import_files(
        &self,
        files: &[PathBuf],
        dir: &str,
        vault_root: Option<&str>,
    ) -> AppResult<Imported> {
        let v = self.vault_at(vault_root)?;
        let mut out = Imported::default();
        for src in files.iter().filter(|f| f.is_file()) {
            let name = src.file_name().unwrap_or_default().to_string_lossy();
            match self.import_file(&v, src, dir, &name) {
                Ok(rel) => out.paths.push(rel),
                Err(e) => out.failed.push(ImportFailure {
                    name: name.into_owned(),
                    error: e.to_string(),
                }),
            }
        }
        Ok(out)
    }

    fn import_file(&self, v: &Vault, src: &Path, dir: &str, name: &str) -> AppResult<String> {
        if let Some(rel) = attachments::in_vault(v, src) {
            return Ok(rel);
        }
        let rel = attachments::reserve(v, dir, name)?;
        self.touch(v, &rel)?;
        attachments::fill(v, &rel, |tmp| fs::copy(src, tmp).map(|_| ()))?;
        self.reindex(v, change(ChangeKind::Created, &[&rel]));
        Ok(rel)
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
        // Icon and image packs sit in the hidden `.axisnotes/packs/`. Scope globs skip
        // dot-folders on macOS and Linux unless the dot is written out, so name it.
        let _ = app.asset_protocol_scope().allow_directory(
            vault.root().join(crate::vault::META_DIR).join("packs"),
            true,
        );
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
    vault_root: Option<String>,
) -> AppResult<WriteResult> {
    let v = state.vault_at(vault_root.as_deref())?;
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
    vault_root: Option<String>,
) -> AppResult<VaultEntry> {
    let v = state.vault_at(vault_root.as_deref())?;
    state.touch(&v, &path)?;
    let entry = v.create_file(&path, content.as_deref().unwrap_or(""))?;
    state.reindex(&v, change(ChangeKind::Created, &[&path]));
    Ok(entry)
}

/// Save pasted media, sent as the request's raw bytes, as `dir/name` (or `name 1`, … if
/// taken). Headers, percent-encoded: `x-dir`, `x-name` and optionally `x-vault` (the vault
/// it's for, as in `write_file`). Returns the vault path.
#[tauri::command]
pub fn save_attachment(
    state: State<AppState>,
    request: tauri::ipc::Request<'_>,
) -> AppResult<String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err(AppError::Io("expected the file's bytes".into()));
    };
    let header = |key: &str| {
        request
            .headers()
            .get(key)
            .and_then(|v| v.to_str().ok())
            .map(attachments::percent_decode)
    };
    let v = state.vault_at(header("x-vault").as_deref())?;
    let rel = attachments::reserve(
        &v,
        &header("x-dir").unwrap_or_default(),
        &header("x-name").unwrap_or_default(),
    )?;
    state.touch(&v, &rel)?;
    attachments::fill(&v, &rel, |tmp| fs::write(tmp, bytes))?;
    state.reindex(&v, change(ChangeKind::Created, &[&rel]));
    Ok(rel)
}

/// Import the files just dropped onto the window (see `DroppedFiles`) into `dir`.
#[tauri::command]
pub async fn import_dropped(
    state: State<'_, AppState>,
    dropped: State<'_, DroppedFiles>,
    dir: String,
    vault_root: Option<String>,
) -> AppResult<Imported> {
    let files = std::mem::take(&mut *dropped.0.lock().unwrap());
    state.import_files(&files, &dir, vault_root.as_deref())
}

/// Let the user pick images, videos or audio files, and import them into `dir`. Empty
/// if they cancel.
#[tauri::command]
pub async fn pick_attachments(
    app: AppHandle,
    state: State<'_, AppState>,
    dir: String,
    vault_root: Option<String>,
) -> AppResult<Imported> {
    use tauri_plugin_dialog::DialogExt;
    let picked = app
        .dialog()
        .file()
        .set_title("Embed images, video or audio")
        .add_filter("Images, video and audio", attachments::MEDIA_EXTS)
        .blocking_pick_files()
        .unwrap_or_default();
    let files: Vec<PathBuf> = picked.into_iter().filter_map(|f| f.into_path().ok()).collect();
    state.import_files(&files, &dir, vault_root.as_deref())
}

/// Copy an image file chosen by the user into `folder` (created if needed) under a free
/// name, for page covers and icons.
#[tauri::command]
pub fn import_image(
    state: State<AppState>,
    source: String,
    folder: String,
) -> AppResult<VaultEntry> {
    let v = state.vault()?;
    let source = PathBuf::from(source);
    let name = crate::vault::image_file_name(&source)?;
    let rel = v.free_path(&folder, &name)?;
    state.touch(&v, &rel)?;
    let entry = v.copy_image_in(&source, &rel)?;
    state.reindex(&v, change(ChangeKind::Created, &[&rel]));
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

/// Show a vault entry in the system file manager, selected (`""` opens the vault folder).
#[tauri::command]
pub fn reveal_entry(state: State<AppState>, path: String) -> AppResult<()> {
    let v = state.vault()?;
    let abs = v.resolve(&path)?;
    if !abs.exists() {
        return Err(AppError::NotFound(path));
    }
    let select = abs != v.root();
    let mut cmd;
    if cfg!(windows) {
        cmd = std::process::Command::new("explorer");
        if select {
            // explorer wants `/select,"C:\path"` as one argument, quotes included; Windows
            // file names can't contain `"`, so the path can't break out of them.
            #[cfg(windows)]
            {
                use std::os::windows::process::CommandExt;
                cmd.raw_arg(format!("/select,\"{}\"", abs.display()));
            }
        } else {
            cmd.arg(&abs);
        }
    } else if cfg!(target_os = "macos") {
        cmd = std::process::Command::new("open");
        if select {
            cmd.arg("-R");
        }
        cmd.arg(&abs);
    } else {
        // No portable "select this file": open its folder.
        cmd = std::process::Command::new("xdg-open");
        cmd.arg(if select { abs.parent().unwrap_or(&abs) } else { &abs });
    }
    let mut child = cmd
        .spawn()
        .map_err(|e| AppError::Io(format!("couldn't open the file manager: {e}")))?;
    // explorer exits 1 even when it worked; only reap it.
    std::thread::spawn(move || child.wait());
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
pub fn list_property_keys(state: State<AppState>) -> AppResult<Vec<crate::index::PropertyKey>> {
    state.with_index(|idx| idx.property_keys())
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

/// What importing `source` as `kind` would bring in (shown before importing). Async: a big
/// export takes a moment to list.
#[tauri::command]
pub async fn inspect_import(
    kind: crate::import::ImportKind,
    source: String,
) -> AppResult<crate::import::ImportPreview> {
    crate::import::inspect(kind, &PathBuf::from(source))
}

pub const IMPORT_PROGRESS_EVENT: &str = "import://progress";

#[derive(Clone, Serialize)]
struct ImportProgress {
    done: usize,
    total: usize,
}

/// Icon and image packs in the open vault (`.axisnotes/packs/`).
#[tauri::command]
pub fn list_packs(state: State<AppState>) -> AppResult<Vec<crate::packs::Pack>> {
    crate::packs::list_packs(&state.vault()?)
}

/// Add the folder or `.zip` at `source` as a new pack. Async: a big pack takes a while.
#[tauri::command]
pub async fn import_pack(
    state: State<'_, AppState>,
    kind: crate::packs::PackKind,
    source: String,
) -> AppResult<crate::packs::Pack> {
    crate::packs::import_pack(&state.vault()?, kind, &PathBuf::from(source))
}

/// Move a pack to the OS trash. Async: the Recycle Bin can take a few seconds, and a
/// sync command would hold up the window meanwhile.
#[tauri::command]
pub async fn remove_pack(
    state: State<'_, AppState>,
    kind: crate::packs::PackKind,
    name: String,
) -> AppResult<()> {
    crate::packs::remove_pack(&state.vault()?, kind, &name)
}

/// Import notes from another app (Obsidian, Notion, Markdown, Evernote) into a new folder
/// of the open vault, reporting progress as `import://progress` events.
#[tauri::command]
pub async fn import_notes(
    app: AppHandle,
    state: State<'_, AppState>,
    kind: crate::import::ImportKind,
    source: String,
    target: String,
    options: Option<crate::import::ImportOptions>,
) -> AppResult<crate::import::ImportReport> {
    let vault = state.vault()?;
    let mut last = Instant::now();
    let mut progress = |done: usize, total: usize| {
        // A few updates a second is plenty for a progress bar.
        if done == 0 || done == total || last.elapsed() >= Duration::from_millis(100) {
            last = Instant::now();
            let _ = app.emit(IMPORT_PROGRESS_EVENT, ImportProgress { done, total });
        }
    };
    let report = crate::import::run(
        &vault,
        kind,
        &PathBuf::from(source),
        &target,
        options.unwrap_or_default(),
        &mut progress,
    )?;
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

/// Refuses unless `v` is the vault at `expected_root` (as `VaultInfo::root` reports it).
fn ensure_vault(v: &Vault, expected_root: Option<&str>) -> AppResult<()> {
    match expected_root {
        Some(root) if v.info().root != root => Err(AppError::Io(format!(
            "{root} is no longer the open vault, so nothing was written"
        ))),
        _ => Ok(()),
    }
}

#[cfg(test)]
mod vault_binding_tests {
    use super::*;

    #[test]
    fn a_write_for_another_vault_is_refused() {
        let a = tempfile::tempdir().unwrap();
        let b = tempfile::tempdir().unwrap();
        let va = Vault::open(a.path()).unwrap();
        let vb = Vault::open(b.path()).unwrap();
        assert!(ensure_vault(&va, None).is_ok());
        assert!(ensure_vault(&va, Some(&va.info().root)).is_ok());
        let err = ensure_vault(&va, Some(&vb.info().root)).unwrap_err();
        assert!(matches!(err, AppError::Io(m) if m.contains("no longer the open vault")));
    }
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
