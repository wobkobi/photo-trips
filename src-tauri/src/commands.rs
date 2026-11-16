// Tauri commands for settings and background jobs. Library browsing lives in library.rs.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use rusqlite::Connection;
use tauri::{AppHandle, Manager, State, Theme};

use crate::AppState;
use crate::db;
use crate::error::{Error, Result};
use crate::exiftool;
use crate::formats::FormatTable;
use crate::index;
use crate::jobs::{self, Jobs, Progress};
use crate::menu;
use crate::suggest;
use crate::watch;

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
    "text_size",
    "photo_size",
    "menu_narrow",
    "tour_done",
    "theme",
];

/// Text sizes offered in Settings, as page zoom percentages. Zoom scales the whole page, so
/// buttons and spacing grow with the words and nothing gets cut off.
const TEXT_SIZES: &[u32] = &[100, 115, 130, 150];

/// Themes offered in Settings; "system" follows Windows.
const THEMES: &[&str] = &["system", "light", "dark"];

/// Photo tile sizes offered in Settings; the grid turns each into a tile width.
const PHOTO_SIZES: &[&str] = &["small", "medium", "large"];

/// Page zoom for a stored text size. Anything not offered (or never set) is 100%.
pub fn text_zoom(value: Option<&str>) -> f64 {
    value
        .and_then(|v| v.parse::<u32>().ok())
        .filter(|percent| TEXT_SIZES.contains(percent))
        .map_or(1.0, |percent| f64::from(percent) / 100.0)
}

/// Zoom the main window to the stored text size.
pub fn apply_text_size(app: &AppHandle, value: Option<&str>) {
    if let Some(window) = app.get_webview_window("main")
        && let Err(err) = window.set_zoom(text_zoom(value))
    {
        log::warn!("Couldn't change the text size: {err}");
    }
}

/// Window theme for a stored theme: light or dark, or none to follow Windows (also for anything
/// not offered, or never set).
pub fn window_theme(value: Option<&str>) -> Option<Theme> {
    match value {
        Some("light") => Some(Theme::Light),
        Some("dark") => Some(Theme::Dark),
        _ => None,
    }
}

/// Theme the main window's title bar and menus to match the page.
pub fn apply_theme(app: &AppHandle, value: Option<&str>) {
    if let Some(window) = app.get_webview_window("main")
        && let Err(err) = window.set_theme(window_theme(value))
    {
        log::warn!("Couldn't change the theme: {err}");
    }
}

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
    match key.as_str() {
        "library_root" => {
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
        "inbox_folders" => {
            let conn = lock_db(&state)?;
            let root = db::get_setting(&conn, "library_root")?;
            let saved = watch::inbox_folders(&conn).unwrap_or_default();
            watch::check_folders(&value, root.as_deref().map(Path::new), &saved)?;
        }
        "home_location" => {
            if !value.trim().is_empty() && suggest::parse_home(&value).is_none() {
                return Err(Error::msg("Type the latitude and longitude, like -36.85, 174.76"));
            }
        }
        "suggest_min_photos" => {
            if suggest::parse_min_photos(&value).is_none() {
                return Err(Error::msg("Use a whole number from 1 to 1,000"));
            }
        }
        "extra_photo_exts" | "extra_video_exts" => check_extensions(&value)?,
        "text_size" if !value.parse::<u32>().is_ok_and(|percent| TEXT_SIZES.contains(&percent)) => {
            return Err(Error::msg("Choose one of the text sizes shown"));
        }
        "photo_size" if !PHOTO_SIZES.contains(&value.as_str()) => {
            return Err(Error::msg("Choose one of the photo sizes shown"));
        }
        "menu_narrow" if value != "true" && value != "false" => {
            return Err(Error::msg("The menu width must be true or false"));
        }
        "tour_done" if value != "true" && value != "false" => {
            return Err(Error::msg("The tour setting must be true or false"));
        }
        "theme" if !THEMES.contains(&value.as_str()) => {
            return Err(Error::msg("Choose one of the themes shown"));
        }
        _ => {}
    }
    db::set_setting(&*lock_db(&state)?, &key, &value)?;
    match key.as_str() {
        "library_root" => {
            watch::reload(&app);
            start_index(&app)?;
        }
        "inbox_folders" => watch::reload(&app),
        "close_to_tray" => menu::show_close_to_tray(&app, value != "false"),
        "text_size" => apply_text_size(&app, Some(&value)),
        "theme" => apply_theme(&app, Some(&value)),
        "extra_photo_exts" | "extra_video_exts" => {
            watch::reload(&app);
            // Files of the new types show up once the library is read again. With another task
            // running, that happens at the next start or refresh instead.
            if let Err(err) = start_index(&app) {
                log::info!("Library check for new file types waits: {err}");
            }
        }
        _ => {}
    }
    Ok(())
}

/// Extra extensions must be short runs of letters and digits, e.g. "orf, .XYZ".
fn check_extensions(text: &str) -> Result<()> {
    let exts = text
        .split([',', ';', ' '])
        .map(|e| e.trim().trim_start_matches('.'))
        .filter(|e| !e.is_empty());
    for ext in exts {
        if ext.len() > 10 || !ext.chars().all(|c| c.is_ascii_alphanumeric()) {
            return Err(Error::msg(format!(
                "\"{ext}\" isn't a file extension. Use letters and digits, like xyz"
            )));
        }
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
    Ok(FormatTable::new(
        &list("extra_photo_exts")?,
        &list("extra_video_exts")?,
    ))
}

/// The library folder from Settings.
pub fn library_root(conn: &Connection) -> Result<PathBuf> {
    db::get_setting(conn, "library_root")?
        .map(PathBuf::from)
        .ok_or_else(|| Error::msg("Choose a library folder first"))
}

/// Refresh the index in the background. Read-only on disk.
pub fn start_index(app: &AppHandle) -> Result<()> {
    let (root, table) = {
        let state = app.state::<AppState>();
        let conn = lock_db(&state)?;
        (library_root(&conn)?, format_table(&conn)?)
    };
    // A missing folder would look like an empty library and wipe the index, so refuse instead.
    if !root.is_dir() {
        return Err(Error::msg(format!(
            "The library folder {} can't be found. If it is on an external drive, connect it and try again.",
            root.display()
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
            &root,
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

pub fn lock_db<'a>(state: &'a AppState) -> Result<std::sync::MutexGuard<'a, Connection>> {
    state
        .db
        .lock()
        .map_err(|_| Error::msg("Database lock poisoned"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extra_extensions_are_letters_and_digits() {
        assert!(check_extensions("").is_ok());
        assert!(check_extensions("orf, .XYZ; mp4v").is_ok());
        assert!(check_extensions("my files").is_ok());
        assert!(check_extensions("*.jpg").is_err());
        assert!(check_extensions("verylongextension").is_err());
    }

    #[test]
    fn text_size_zooms_only_to_offered_sizes() {
        assert_eq!(text_zoom(None), 1.0);
        assert_eq!(text_zoom(Some("100")), 1.0);
        assert_eq!(text_zoom(Some("130")), 1.3);
        assert_eq!(text_zoom(Some("150")), 1.5);
        assert_eq!(text_zoom(Some("400")), 1.0);
        assert_eq!(text_zoom(Some("large")), 1.0);
    }

    #[test]
    fn theme_follows_windows_unless_chosen() {
        assert_eq!(window_theme(None), None);
        assert_eq!(window_theme(Some("system")), None);
        assert_eq!(window_theme(Some("blue")), None);
        assert_eq!(window_theme(Some("light")), Some(Theme::Light));
        assert_eq!(window_theme(Some("dark")), Some(Theme::Dark));
    }
}
