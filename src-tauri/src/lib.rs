mod commands;
mod db;
mod error;
mod tray;

use std::path::PathBuf;
use std::sync::Mutex;

use rusqlite::Connection;
use tauri::Manager;

/// Command-line flag the autostart entry passes, so a login launch stays in the tray.
const HIDDEN_FLAG: &str = "--hidden";

/// Shared state available to every command.
pub struct AppState {
    pub db: Mutex<Connection>,
    /// %LOCALAPPDATA%\<identifier>: database, thumbnail cache, previews.
    pub data_dir: PathBuf,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Must be registered first: a second launch hands over to the running copy and exits.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            tray::show_main(app)
        }))
        .plugin(
            tauri_plugin_autostart::Builder::new()
                .args([HIDDEN_FLAG])
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let data_dir = app.path().app_local_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            let conn = db::open(&data_dir.join("library.db"))?;
            if let Some(root) = db::get_setting(&conn, "library_root")? {
                commands::allow_library(app.handle(), &root);
            }
            app.manage(AppState {
                db: Mutex::new(conn),
                data_dir,
            });
            tray::build(app.handle())?;
            tray::set_watch_state(app.handle(), None);

            // The window starts hidden (see tauri.conf.json) to avoid a flash on a tray-only start.
            if !std::env::args().any(|arg| arg == HIDDEN_FLAG) {
                tray::show_main(app.handle());
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let state = window.state::<AppState>();
                let to_tray = state
                    .db
                    .lock()
                    .ok()
                    .and_then(|conn| db::get_bool(&conn, "close_to_tray", true).ok())
                    .unwrap_or(true);
                if to_tray {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_settings,
            commands::set_setting,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Photo Trips");
}
