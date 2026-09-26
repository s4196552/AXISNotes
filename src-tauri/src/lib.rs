mod commands;
mod error;
mod vault;

use tauri::Manager;

/// If set, this folder is opened as the vault on startup (the UI picks it up via
/// `current_vault`). Used by the E2E tests, which can't drive the native folder picker.
const OPEN_VAULT_ENV: &str = "AXIS_OPEN_VAULT";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(commands::AppState::default())
        .setup(|app| {
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running AXIS");
}
