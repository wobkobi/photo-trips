// Tauri commands: the bridge between the React UI and the Rust modules.

use std::collections::HashMap;
use std::path::Path;

use tauri::{AppHandle, Manager, State};

use crate::AppState;
use crate::db;
use crate::error::{Error, Result};

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
    let conn = state
        .db
        .lock()
        .map_err(|_| Error::msg("Database lock poisoned"))?;
    let mut stmt = conn.prepare("SELECT key, value FROM settings")?;
    let rows = stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

#[tauri::command]
pub fn set_setting(
    app: AppHandle,
    state: State<AppState>,
    key: String,
    value: String,
) -> Result<()> {
    if !WRITABLE_SETTINGS.contains(&key.as_str()) {
        return Err(Error::msg(format!("Unknown setting {key}")));
    }
    if key == "library_root" {
        let root = Path::new(&value);
        if !root.is_absolute() || !root.is_dir() {
            return Err(Error::msg("Choose an existing folder for the library"));
        }
        allow_library(&app, &value);
    }
    let conn = state
        .db
        .lock()
        .map_err(|_| Error::msg("Database lock poisoned"))?;
    db::set_setting(&conn, &key, &value)
}
