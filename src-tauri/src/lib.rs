mod commands;
mod dates;
mod db;
mod devices;
mod duplicates;
mod error;
mod executor;
mod exiftool;
mod extensions;
mod formats;
mod groups;
mod hash;
mod history;
mod import;
mod index;
mod jobs;
mod library;
mod menu;
mod metadata;
mod mtp;
mod organise;
mod planner;
mod recycle;
mod scan;
mod suggest;
mod thumbs;
mod tray;
mod trips;
mod updater;
mod watch;
#[cfg(windows)]
mod win;

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
        // Warnings from background work (the inbox watcher, devices, indexing) go to
        // %LOCALAPPDATA%\<identifier>\logs as well as the console, so they can be read afterwards.
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                .timezone_strategy(tauri_plugin_log::TimezoneStrategy::UseLocal)
                .max_file_size(512_000)
                .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepSome(2))
                .build(),
        )
        .plugin(
            tauri_plugin_autostart::Builder::new()
                .args([HIDDEN_FLAG])
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .register_asynchronous_uri_scheme_protocol("thumb", thumbs::protocol)
        .setup(|app| {
            log::info!("Pic Cabinet {} started", app.package_info().version);
            let data_dir = app.path().app_local_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            let conn = db::open(&data_dir.join("library.db"))?;
            // Settle any file moves a crash or power cut interrupted before anything else runs.
            if let Err(err) = commands::format_table(&conn).and_then(|t| executor::recover(&conn, &t)) {
                log::error!("Couldn't settle unfinished file moves: {err}");
            }
            let library_root = db::get_setting(&conn, "library_root")?;
            let text_size = db::get_setting(&conn, "text_size")?;
            if let Some(root) = &library_root {
                commands::allow_library(app.handle(), root);
                // Phone files left from an import that never finished; recovery is done with them.
                import::clear_staging(std::path::Path::new(root));
            }
            app.manage(thumbs::Pool::new(4, &data_dir));
            app.manage(jobs::Jobs::default());
            app.manage(organise::Previews::<organise::PendingBatch>::default());
            app.manage(organise::Previews::<import::PendingImport>::default());
            app.manage(devices::Devices::default());
            app.manage(updater::Updates::default());
            app.manage(AppState {
                db: Mutex::new(conn),
                data_dir,
            });
            tray::build(app.handle())?;
            // Before the watcher starts, so its first status reaches the menu's pause item.
            menu::build(app.handle())?;
            // Catch up with anything that changed while the app was closed.
            if library_root.is_some()
                && let Err(err) = commands::start_index(app.handle())
            {
                log::warn!("Startup index skipped: {err}");
            }
            devices::start(app.handle());
            watch::start(app.handle());
            updater::start(app.handle());

            // Zoomed before it first shows, so the page doesn't jump to the chosen text size.
            commands::apply_text_size(app.handle(), text_size.as_deref());
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
            commands::index_library,
            commands::job_status,
            commands::cancel_job,
            library::library_tiles,
            library::media_detail,
            library::open_media,
            library::reveal_media,
            extensions::installed_extensions,
            extensions::open_store_page,
            organise::plan_organise,
            organise::apply_plan,
            history::list_batches,
            history::batch_entries,
            history::undo_batch,
            trips::list_trips,
            trips::trip_matches,
            trips::plan_trip,
            duplicates::find_duplicates,
            duplicates::list_duplicates,
            duplicates::remove_duplicates,
            import::scan_import,
            import::import_preview,
            import::apply_import,
            import::discard_import,
            devices::import_sources,
            suggest::suggest_trips,
            suggest::dismiss_suggestion,
            suggest::restore_dismissed,
            suggest::home_place,
            watch::watch_status,
            watch::set_watch_paused,
            menu::menu_action,
            menu::set_autostart,
            updater::update_status,
            updater::check_for_update,
            updater::install_update,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Pic Cabinet");
}
