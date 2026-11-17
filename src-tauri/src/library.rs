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
use crate::executor::{self, BinFile, Env, NewBatch, Removal};
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
    /// The leader's file name, for finding it by name.
    pub name: String,
    /// Date guessed from the file's modified time.
    pub uncertain: bool,
    /// Date set by the user in Pic Cabinet, over the file's own.
    pub date_set: bool,
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

/// Everything the viewer shows about one file and the tile it belongs to.
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
    /// The file has gone from disk since the library was last looked through, as when it was
    /// deleted or moved in Explorer.
    pub missing: bool,
    /// The file on disk is 0 bytes, usually from a copy that didn't finish.
    pub empty: bool,
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
        name: file_name(&leader.path),
        uncertain: group.date_source == DateSource::Modified,
        date_set: group.date_source == DateSource::Set,
        extra: group.members.len() - 1,
        version: leader.mtime,
        trip: trip_of(trips, group).map(|t| TileTrip {
            id: t.id,
            name: t.name.clone(),
            colour: trips::colour(t.id),
        }),
    }
}

/// The file `id` with its tile's date, place and members. Library asks by tile, so it gets the
/// tile's first file; Duplicates asks for the exact copy being judged, which may be a tile's
/// Live Photo clip or RAW.
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
    let shown = group
        .members
        .iter()
        .find(|m| m.id == id)
        .unwrap_or(group.leader());
    let path = &shown.path;
    Ok(Detail {
        id: shown.id,
        path: path.to_string_lossy().into_owned(),
        name: file_name(path),
        folder: path
            .parent()
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or_default(),
        taken_at: dates::format(&group.taken_at),
        date_source: group.date_source.as_str(),
        size: shown.size,
        lat: group.members.iter().find_map(|m| m.lat),
        lon: group.members.iter().find_map(|m| m.lon),
        kind: shown.kind.as_str(),
        viewable: matches!(shown.kind, Kind::Photo) && formats::web_viewable(path),
        playable: shown.kind == Kind::Video && formats::web_playable(path),
        missing: !path.exists(),
        empty: std::fs::metadata(path).is_ok_and(|m| m.len() == 0),
        version: shown.mtime,
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

/// Put an indexed file on the clipboard, to paste into a folder, an email or a chat. Only the
/// photo itself: its Live Photo video or sidecars would just clutter wherever it's pasted.
#[tauri::command(async)]
pub fn copy_media(state: State<'_, AppState>, id: i64) -> Result<()> {
    let path = media_path(&state, id)?;
    #[cfg(windows)]
    return crate::win::copy_files(&[path]);
    #[cfg(not(windows))]
    {
        let _ = path;
        Err(Error::msg("Copying files is only on Windows"))
    }
}

/// Open the library folder in Explorer.
#[tauri::command(async)]
pub fn open_library(state: State<'_, AppState>) -> Result<()> {
    let root = crate::commands::library_root(&*crate::commands::lock_db(&state)?)?;
    tauri_plugin_opener::open_path(&root, None::<&str>).map_err(|e| Error::msg(e.to_string()))
}

/// Photos the user picked to bin, each with every file of its group (Live Photo video, RAW
/// twin, sidecars), so nothing is left behind without its photo. `ids` are leader media ids.
fn bin_removals(groups: &[Group], ids: &[i64]) -> Vec<Removal> {
    groups
        .iter()
        .filter(|g| ids.contains(&g.leader().id))
        .map(|g| Removal {
            files: g
                .members
                .iter()
                .map(|m| BinFile {
                    media_id: m.id,
                    path: m.path.clone(),
                })
                .collect(),
            keeper: None,
        })
        .collect()
}

/// Send picked photos and the files that go with them to the Recycle Bin, in the background,
/// as one change History can undo.
#[tauri::command]
pub fn recycle_media(app: AppHandle, state: State<AppState>, ids: Vec<i64>) -> Result<()> {
    let (root, table, removals) = {
        let conn = crate::commands::lock_db(&state)?;
        let (groups, _orphans) = groups::build(index::load_rows(&conn)?);
        (
            crate::commands::library_root(&conn)?,
            crate::commands::format_table(&conn)?,
            bin_removals(&groups, &ids),
        )
    };
    if removals.is_empty() {
        return Err(Error::msg("These photos are no longer in the library"));
    }
    let photos = removals.len();
    let label = format!(
        "Moved {photos} {} to the Recycle Bin",
        if photos == 1 { "photo" } else { "photos" }
    );
    let handle = app.clone();
    crate::jobs::start(&app, "remove", move |ctx| {
        let state = handle.state::<AppState>();
        let env = Env {
            db: &state.db,
            root: &root,
            table: &table,
            cancel: ctx.cancel_flag(),
            report: &|stage, done, total| ctx.report(stage, done, total),
        };
        let batch = NewBatch {
            kind: "recycle",
            label: &label,
            on_begin: None,
        };
        executor::remove(&env, &batch, &removals)
    })
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::groups::tests::row;

    #[test]
    fn binning_a_photo_takes_its_live_photo_video_with_it() {
        let when = "2025-03-12T10:00:00";
        let (groups, _) = groups::build(vec![
            row(1, "2025", "IMG_1.HEIC", Kind::Photo, when, DateSource::Exif),
            row(2, "2025", "IMG_1.MOV", Kind::Video, when, DateSource::Exif),
            row(3, "2025", "IMG_2.JPG", Kind::Photo, when, DateSource::Exif),
        ]);
        let removals = bin_removals(&groups, &[1]);
        assert_eq!(removals.len(), 1);
        let ids: Vec<i64> = removals[0].files.iter().map(|f| f.media_id).collect();
        assert_eq!(ids, [1, 2]);
        assert!(removals[0].keeper.is_none());
        assert!(bin_removals(&groups, &[99]).is_empty());
    }
}
