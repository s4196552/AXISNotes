mod ai;
mod ai_commands;
mod attachments;
mod clipper;
mod clipper_commands;
mod commands;
mod error;
mod import;
mod index;
mod migrate;
mod packs;
mod updates;
mod updates_commands;
mod vault;

use tauri::{DragDropEvent, Emitter, Manager, WindowEvent};

/// If set, this folder is opened as the vault on startup (the UI picks it up via
/// `current_vault`). Used by the E2E tests, which can't drive the native folder picker.
const OPEN_VAULT_ENV: &str = "AXIS_OPEN_VAULT";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Before any window opens, so the webview finds its storage under the new name.
    migrate::legacy_app_dirs();
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(commands::AppState::default())
        .manage(commands::DroppedFiles::default())
        .setup(|app| {
            ai_commands::manage(app.handle());
            clipper_commands::manage(app.handle());
            if let Ok(path) = std::env::var(OPEN_VAULT_ENV) {
                let state = app.state::<commands::AppState>();
                if let Err(e) = state.open_at_startup(app.handle(), &path) {
                    eprintln!("{OPEN_VAULT_ENV}={path}: {e}");
                }
            }
            Ok(())
        })
        // Files dropped from outside: remember them (only these may be imported), then tell
        // the page where they landed.
        .on_window_event(|window, event| {
            if let WindowEvent::DragDrop(DragDropEvent::Drop { paths, position }) = event {
                *window.state::<commands::DroppedFiles>().0.lock().unwrap() = paths.clone();
                let _ = window.emit(
                    commands::FILES_DROPPED_EVENT,
                    commands::FilesDropped {
                        x: position.x,
                        y: position.y,
                        count: paths.len(),
                    },
                );
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::open_vault,
            commands::create_vault,
            commands::current_vault,
            commands::list_fonts,
            commands::list_tree,
            commands::read_file,
            commands::write_file,
            commands::create_file,
            commands::create_dir,
            commands::save_attachment,
            commands::import_dropped,
            commands::pick_attachments,
            commands::import_image,
            commands::rename_entry,
            commands::trash_entry,
            commands::search,
            commands::list_tags,
            commands::list_property_keys,
            commands::list_notes,
            commands::resolve_link,
            commands::backlinks,
            commands::unlinked_mentions,
            commands::list_axis_files,
            commands::graph,
            commands::list_tasks,
            commands::time_entries,
            commands::inspect_import,
            commands::import_obsidian,
            commands::list_packs,
            commands::import_pack,
            commands::remove_pack,
            ai_commands::ai_settings,
            ai_commands::ai_save_settings,
            ai_commands::ai_set_key,
            ai_commands::ai_delete_key,
            ai_commands::ai_test_provider,
            ai_commands::ai_list_models,
            ai_commands::ai_plan,
            ai_commands::ai_run,
            ai_commands::ai_cancel,
            ai_commands::ai_log,
            clipper_commands::clipper_status,
            clipper_commands::clipper_set_enabled,
            clipper_commands::clipper_set_folder,
            clipper_commands::clipper_start_pairing,
            clipper_commands::clipper_cancel_pairing,
            clipper_commands::clipper_revoke,
            clipper_commands::clipper_open_extension_folder,
            updates_commands::updates_settings,
            updates_commands::updates_save_settings,
            updates_commands::updates_check,
            updates_commands::updates_install,
        ])
        .run(tauri::generate_context!())
        .expect("error while running AXISNotes");
}
