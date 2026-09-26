//! Tauri commands. The TypeScript mirror of this contract is `src/ipc/`.

use std::path::PathBuf;
use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use crate::error::{AppError, AppResult};
use crate::vault::watcher::{self, SelfWrites, VaultChange, VaultWatcher};
use crate::vault::{FileContent, Vault, VaultEntry, VaultInfo, WriteResult};

pub const VAULT_CHANGED_EVENT: &str = "vault://changed";

#[derive(Default)]
pub struct AppState {
    vault: Mutex<Option<Vault>>,
    watcher: Mutex<Option<VaultWatcher>>,
    self_writes: SelfWrites,
}

#[derive(Clone, Serialize)]
struct VaultChangedPayload {
    changes: Vec<VaultChange>,
}

impl AppState {
    fn vault(&self) -> AppResult<Vault> {
        self.vault.lock().unwrap().clone().ok_or(AppError::NoVault)
    }

    /// Mark a path as touched by the app so the watcher ignores its echo.
    fn touch(&self, vault: &Vault, rel: &str) -> AppResult<()> {
        self.self_writes.mark(&vault.resolve(rel)?);
        Ok(())
    }

    fn activate(&self, app: &AppHandle, vault: Vault) -> AppResult<VaultInfo> {
        let emitter = app.clone();
        let w = watcher::start(vault.clone(), self.self_writes.clone(), move |changes| {
            let _ = emitter.emit(VAULT_CHANGED_EVENT, VaultChangedPayload { changes });
        })?;
        let info = vault.info();
        *self.watcher.lock().unwrap() = Some(w);
        *self.vault.lock().unwrap() = Some(vault);
        Ok(info)
    }
}

#[tauri::command]
pub fn open_vault(app: AppHandle, state: State<AppState>, path: String) -> AppResult<VaultInfo> {
    let vault = Vault::open(&PathBuf::from(path))?;
    state.activate(&app, vault)
}

#[tauri::command]
pub fn create_vault(
    app: AppHandle,
    state: State<AppState>,
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
    v.write_file(&path, &content, expected_modified_ms)
}

#[tauri::command]
pub fn create_file(
    state: State<AppState>,
    path: String,
    content: Option<String>,
) -> AppResult<VaultEntry> {
    let v = state.vault()?;
    state.touch(&v, &path)?;
    v.create_file(&path, content.as_deref().unwrap_or(""))
}

#[tauri::command]
pub fn create_dir(state: State<AppState>, path: String) -> AppResult<VaultEntry> {
    let v = state.vault()?;
    state.touch(&v, &path)?;
    v.create_dir(&path)
}

#[tauri::command]
pub fn rename_entry(state: State<AppState>, from: String, to: String) -> AppResult<VaultEntry> {
    let v = state.vault()?;
    state.touch(&v, &from)?;
    state.touch(&v, &to)?;
    v.rename_entry(&from, &to)
}

#[tauri::command]
pub fn trash_entry(state: State<AppState>, path: String) -> AppResult<()> {
    let v = state.vault()?;
    state.touch(&v, &path)?;
    v.trash_entry(&path)
}
