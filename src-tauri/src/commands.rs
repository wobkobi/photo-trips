// Tauri commands for settings and background jobs. Library browsing lives in library.rs.

use std::collections::HashMap;
use std::path::Path;

use rusqlite::Connection;
use tauri::{AppHandle, Manager, State};

use crate::AppState;
use crate::db;
use crate::error::{Error, Result};
use crate::exiftool;
use crate::formats::FormatTable;
use crate::index;
use crate::jobs::{self, Jobs, Progress};

/// Settings the UI may write. Anything else is rejected so a UI bug can't pollute the table.
const WRITABLE_SETTINGS: &[&str] = &[
    "library_root",
    "close_to_tray",
    "inbox_folders",
    "home_location",
    "suggest_min_photos",
    "extra_photo_exts",
    "extra_video_exts",
    "codec_hint_dismissed",
];

/// Let the webview load files from the library through the asset protocol (full-size photos,
/// video playback with seeking).
pub fn allow_library(app: &AppHandle, root: &str) {
    let _ = app
        .asset_protocol_scope()
        .allow_directory(Path::new(root), true);
}

/// Every stored setting as key > value.
#[tauri::command]
pub fn get_settings(state: State<AppState>) -> Result<HashMap<String, String>> {
    let conn = lock_db(&state)?;
    let mut stmt = conn.prepare("SELECT key, value FROM settings")?;
    let rows = stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

#[tauri::command]
pub fn set_setting(
    app: AppHandle,
    state: State<AppState>,
    jobs: State<Jobs>,
    key: String,
    value: String,
) -> Result<()> {
    if !WRITABLE_SETTINGS.contains(&key.as_str()) {
        return Err(Error::msg(format!("Unknown setting {key}")));
    }
    let new_library = key == "library_root";
    if new_library {
        let root = Path::new(&value);
        if !root.is_absolute() || !root.is_dir() {
            return Err(Error::msg("Choose an existing folder for the library"));
        }
        if jobs.is_running() {
            return Err(Error::msg(
                "Wait for the current task to finish before changing the library folder",
            ));
        }
        allow_library(&app, &value);
    }
    db::set_setting(&*lock_db(&state)?, &key, &value)?;
    if new_library {
        start_index(&app)?;
    }
    Ok(())
}

/// Format table including the extra extensions from Settings (comma or space separated).
pub fn format_table(conn: &Connection) -> Result<FormatTable> {
    let list = |key: &str| -> Result<Vec<String>> {
        Ok(db::get_setting(conn, key)?
            .unwrap_or_default()
            .split([',', ';', ' '])
            .filter(|ext| !ext.trim().is_empty())
            .map(str::to_owned)
            .collect())
    };
    Ok(FormatTable::new(&list("extra_photo_exts")?, &list("extra_video_exts")?))
}

/// Refresh the index in the background. Read-only on disk.
pub fn start_index(app: &AppHandle) -> Result<()> {
    let (root, table) = {
        let state = app.state::<AppState>();
        let conn = lock_db(&state)?;
        let root = db::get_setting(&conn, "library_root")?
            .ok_or_else(|| Error::msg("Choose a library folder first"))?;
        (root, format_table(&conn)?)
    };
    // A missing folder would look like an empty library and wipe the index, so refuse instead.
    if !Path::new(&root).is_dir() {
        return Err(Error::msg(format!(
            "The library folder {root} can't be found. If it is on an external drive, connect it and try again."
        )));
    }
    let exiftool = app
        .path()
        .resource_dir()
        .ok()
        .and_then(|dir| exiftool::locate(&dir));
    let handle = app.clone();
    jobs::start(app, "index", move |ctx| {
        let state = handle.state::<AppState>();
        index::run(
            &state.db,
            Path::new(&root),
            &table,
            exiftool.as_deref(),
            ctx.cancel_flag(),
            &|stage, done, total| ctx.report(stage, done, total),
        )
    })
}

#[tauri::command]
pub fn index_library(app: AppHandle) -> Result<()> {
    start_index(&app)
}

/// The running job's latest progress, or nothing when idle.
#[tauri::command]
pub fn job_status(jobs: State<Jobs>) -> Option<Progress> {
    jobs.status()
}

#[tauri::command]
pub fn cancel_job(jobs: State<Jobs>) {
    jobs.cancel();
}

fn lock_db<'a>(state: &'a AppState) -> Result<std::sync::MutexGuard<'a, Connection>> {
    state
        .db
        .lock()
        .map_err(|_| Error::msg("Database lock poisoned"))
}
