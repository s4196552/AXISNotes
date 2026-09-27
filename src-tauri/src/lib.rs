mod ai;
mod ai_commands;
mod clipper;
mod clipper_commands;
mod commands;
mod error;
mod import;
mod index;
mod migrate;
mod vault;

use tauri::Manager;

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
        .invoke_handler(tauri::generate_handler![
            commands::open_vault,
            commands::create_vault,
            commands::current_vault,
            commands::list_tree,
            commands::read_file,
            commands::write_file,
            commands::create_file,
            commands::create_dir,
            commands::rename_entry,
            commands::trash_entry,
            commands::search,
            commands::list_tags,
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running AXISNotes");
}
