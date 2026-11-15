// Read-only library commands for the UI: grid tiles, the viewer's details, and opening files
// with Windows.

use std::path::{Path, PathBuf};

use rusqlite::OptionalExtension;
use serde::Serialize;
use tauri::{AppHandle, Manager, State};

use crate::AppState;
use crate::dates::{self, DateSource};
use crate::details;
use crate::error::{Error, Result};
use crate::formats::{self, Kind};
use crate::groups::{self, Group};
use crate::index;
use crate::trips::{self, Trip, trip_of};

/// One grid tile: a group shown by its leader.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Tile {
    pub id: i64,
    pub taken_at: String,
    pub kind: &'static str,
    pub ext: String,
    /// Date guessed from the file's modified time.
    pub uncertain: bool,
    /// Companion files travelling with the leader (Live Photo video, RAW twin, sidecars).
    pub extra: usize,
    /// Changes whenever the file does, so thumbnail URLs bust the webview cache.
    pub version: i64,
    /// Trip the photo was taken during, if any.
    pub trip: Option<TileTrip>,
}

/// Enough of a trip to draw its band on a tile.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TileTrip {
    pub id: i64,
    pub name: String,
    /// 1 to 6: which trip colour the UI uses.
    pub colour: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Member {
    pub id: i64,
    pub name: String,
    pub kind: &'static str,
    pub size: u64,
}

/// Everything the viewer shows about one tile.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Detail {
    pub id: i64,
    pub path: String,
    pub name: String,
    pub folder: String,
    pub taken_at: String,
    pub date_source: &'static str,
    pub size: u64,
    pub lat: Option<f64>,
    pub lon: Option<f64>,
    pub kind: &'static str,
    /// The webview can draw the original file.
    pub viewable: bool,
    /// The built-in player should try the original file.
    pub playable: bool,
    pub version: i64,
    pub members: Vec<Member>,
}

/// Every group in the library, newest first.
#[tauri::command(async)]
pub fn library_tiles(state: State<'_, AppState>) -> Result<Vec<Tile>> {
    let (rows, trips) = {
        let conn = state
            .db
            .lock()
            .map_err(|_| Error::msg("Database lock poisoned"))?;
        (index::load_rows(&conn)?, trips::load(&conn)?)
    };
    let (groups, _orphans) = groups::build(rows);
    Ok(groups.iter().rev().map(|g| tile(g, &trips)).collect())
}

/// A group as a grid tile, with the band of the trip it belongs in.
pub fn tile(group: &Group, trips: &[Trip]) -> Tile {
    let leader = group.leader();
    Tile {
        id: leader.id,
        taken_at: dates::format(&group.taken_at),
        kind: leader.kind.as_str(),
        ext: formats::ext_of(&leader.path),
        uncertain: group.date_source == DateSource::Modified,
        extra: group.members.len() - 1,
        version: leader.mtime,
        trip: trip_of(trips, group).map(|t| TileTrip {
            id: t.id,
            name: t.name.clone(),
            colour: trips::colour(t.id),
        }),
    }
}

#[tauri::command(async)]
pub fn media_detail(state: State<'_, AppState>, id: i64) -> Result<Detail> {
    let conn = state
        .db
        .lock()
        .map_err(|_| Error::msg("Database lock poisoned"))?;
    let key: String = conn
        .query_row("SELECT group_key FROM media WHERE id = ?1", [id], |row| {
            row.get(0)
        })
        .optional()?
        .ok_or_else(|| Error::msg("This file is no longer in the library"))?;
    let (groups, _) = groups::build(index::load_group(&conn, &key)?);
    let group = groups
        .into_iter()
        .find(|g| g.members.iter().any(|m| m.id == id))
        .ok_or_else(|| Error::msg("This file is no longer in the library"))?;
    let leader = group.leader();
    let path = &leader.path;
    Ok(Detail {
        id: leader.id,
        path: path.to_string_lossy().into_owned(),
        name: file_name(path),
        folder: path
            .parent()
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or_default(),
        taken_at: dates::format(&group.taken_at),
        date_source: group.date_source.as_str(),
        size: leader.size,
        lat: group.members.iter().find_map(|m| m.lat),
        lon: group.members.iter().find_map(|m| m.lon),
        kind: leader.kind.as_str(),
        viewable: matches!(leader.kind, Kind::Photo) && formats::web_viewable(path),
        playable: leader.kind == Kind::Video && formats::web_playable(path),
        version: leader.mtime,
        members: group
            .members
            .iter()
            .map(|m| Member {
                id: m.id,
                name: file_name(&m.path),
                kind: m.kind.as_str(),
                size: m.size,
            })
            .collect(),
    })
}

fn file_name(path: &Path) -> String {
    path.file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default()
}

fn media_path(state: &AppState, id: i64) -> Result<PathBuf> {
    let conn = state
        .db
        .lock()
        .map_err(|_| Error::msg("Database lock poisoned"))?;
    conn.query_row("SELECT path FROM media WHERE id = ?1", [id], |row| {
        row.get::<_, String>(0)
    })
    .optional()?
    .map(PathBuf::from)
    .ok_or_else(|| Error::msg("This file is no longer in the library"))
}

/// Open an indexed file in its default Windows app (videos the built-in player can't handle).
#[tauri::command(async)]
pub fn open_media(state: State<'_, AppState>, id: i64) -> Result<()> {
    let path = media_path(&state, id)?;
    tauri_plugin_opener::open_path(&path, None::<&str>).map_err(|e| Error::msg(e.to_string()))
}

/// What an indexed file says about itself beyond what the index keeps: camera, size, settings.
#[tauri::command(async)]
pub fn media_details(app: AppHandle, state: State<'_, AppState>, id: i64) -> Result<details::Details> {
    let path = media_path(&state, id)?;
    Ok(details::read(&app, &path))
}

/// Show an indexed file selected in Explorer.
#[tauri::command(async)]
pub fn reveal_media(state: State<'_, AppState>, id: i64) -> Result<()> {
    let path = media_path(&state, id)?;
    tauri_plugin_opener::reveal_item_in_dir(&path).map_err(|e| Error::msg(e.to_string()))
}

/// Open the third-party notices installed with the app, which list exactly what this version was
/// built with (the file is generated at build time; see tauri.conf.json's resources).
#[tauri::command(async)]
pub fn open_notices(app: AppHandle) -> Result<()> {
    let path = app.path().resource_dir()?.join("THIRD_PARTY_NOTICES.txt");
    if !path.is_file() {
        return Err(Error::msg(
            "The third-party notices are missing from the install folder. Reinstalling Pic Cabinet puts them back.",
        ));
    }
    tauri_plugin_opener::open_path(&path, None::<&str>).map_err(|e| Error::msg(e.to_string()))
}
