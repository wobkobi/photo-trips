// Commands for the History page: every batch of file changes, what each one did, and undo.

use std::path::Path;

use rusqlite::{Connection, OptionalExtension, params};
use serde::Serialize;
use tauri::{AppHandle, Manager, State};

use crate::AppState;
use crate::commands::{format_table, library_root, lock_db};
use crate::error::{Error, Result};
use crate::executor::{self, Env, UndoSummary};
use crate::jobs;
use crate::naming;
use crate::organise::relative;
use crate::redate;
use crate::trips;

/// Most batches listed at once, newest first; the page asks for more as the user goes back.
const BATCH_LIMIT: i64 = 2000;
/// Files listed when a batch is expanded. A full-library sort can be tens of thousands.
const ENTRY_LIMIT: i64 = 2000;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchInfo {
    pub id: i64,
    pub kind: String,
    pub label: String,
    pub status: String,
    /// Unix seconds.
    pub created_at: i64,
    pub undone_at: Option<i64>,
    pub total: i64,
    pub done: i64,
    pub failed: i64,
    pub skipped: i64,
    pub undone: i64,
    /// Some files are still where this batch put them (or it changed a trip that can still be
    /// changed back), and nothing is running on it.
    pub can_undo: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EntryInfo {
    pub seq: i64,
    /// `move`; `trash` for a file sent to the Recycle Bin (`to` is then empty); `copy` for a
    /// file copied in from a card, phone or folder; `import` for a file moved in from a folder.
    pub op: String,
    /// Paths relative to the library folder when inside it.
    pub from: String,
    pub to: String,
    pub status: String,
    pub error: Option<String>,
}

#[tauri::command(async)]
pub fn list_batches(state: State<'_, AppState>, limit: i64) -> Result<Vec<BatchInfo>> {
    let conn = lock_db(&state)?;
    let mut stmt = conn.prepare(
        "SELECT b.id, b.kind, b.label, b.status, b.created_at, b.undone_at, COUNT(j.id),
                COALESCE(SUM(j.status = 'done'), 0), COALESCE(SUM(j.status = 'failed'), 0),
                COALESCE(SUM(j.status = 'skipped'), 0), COALESCE(SUM(j.status = 'undone'), 0),
                b.undo_data IS NOT NULL
         FROM batches b LEFT JOIN journal j ON j.batch_id = b.id
         GROUP BY b.id ORDER BY b.id DESC LIMIT ?1",
    )?;
    let rows = stmt.query_map([limit.clamp(1, BATCH_LIMIT)], |row| {
        let status: String = row.get(3)?;
        let done: i64 = row.get(7)?;
        let has_undo_data: bool = row.get(11)?;
        let idle = status != "running" && status != "undoing";
        Ok(BatchInfo {
            id: row.get(0)?,
            kind: row.get(1)?,
            label: row.get(2)?,
            can_undo: idle && (done > 0 || (has_undo_data && status != "undone")),
            status,
            created_at: row.get(4)?,
            undone_at: row.get(5)?,
            total: row.get(6)?,
            done,
            failed: row.get(8)?,
            skipped: row.get(9)?,
            undone: row.get(10)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// The files one batch touched, in the order it touched them.
#[tauri::command(async)]
pub fn batch_entries(state: State<'_, AppState>, batch_id: i64) -> Result<Vec<EntryInfo>> {
    let conn = lock_db(&state)?;
    let root = library_root(&conn).unwrap_or_default();
    let mut stmt = conn.prepare(
        "SELECT seq, op, src, dst, status, error FROM journal
         WHERE batch_id = ?1 ORDER BY seq LIMIT ?2",
    )?;
    let rows = stmt.query_map(params![batch_id, ENTRY_LIMIT], |row| {
        let src: String = row.get(2)?;
        let dst: String = row.get(3)?;
        Ok(EntryInfo {
            seq: row.get(0)?,
            op: row.get(1)?,
            from: relative(&root, Path::new(&src)),
            to: relative(&root, Path::new(&dst)),
            status: row.get(4)?,
            error: row.get(5)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// Where a file a batch touched is now: where it went while the change stands, where it came
/// from otherwise. A file in the Recycle Bin, or gone since, has nowhere to show.
fn entry_now(conn: &Connection, batch_id: i64, seq: i64) -> Result<std::path::PathBuf> {
    let (op, src, dst, status): (String, String, String, String) = conn
        .query_row(
            "SELECT op, src, dst, status FROM journal WHERE batch_id = ?1 AND seq = ?2",
            params![batch_id, seq],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .optional()?
        .ok_or_else(|| Error::msg("This change is no longer in History"))?;
    let binned = match status.as_str() {
        "done" => op == "trash",
        "undone" => op == "copy",
        _ => false,
    };
    if binned {
        return Err(Error::msg("This file is in the Recycle Bin"));
    }
    // Mid-undo it could be at either end.
    let places: &[&str] = match status.as_str() {
        "done" => &[&dst],
        "undoing" => &[&dst, &src],
        _ => &[&src],
    };
    places
        .iter()
        .map(std::path::PathBuf::from)
        .find(|path| path.exists())
        .ok_or_else(|| Error::msg("This file isn't there any more"))
}

/// Show a file a batch touched selected in Explorer, wherever it is now.
#[tauri::command(async)]
pub fn reveal_entry(state: State<'_, AppState>, batch_id: i64, seq: i64) -> Result<()> {
    let path = entry_now(&*lock_db(&state)?, batch_id, seq)?;
    tauri_plugin_opener::reveal_item_in_dir(&path).map_err(|e| Error::msg(e.to_string()))
}

/// Open a file a batch touched in its default Windows app, wherever it is now.
#[tauri::command(async)]
pub fn open_entry(state: State<'_, AppState>, batch_id: i64, seq: i64) -> Result<()> {
    let path = entry_now(&*lock_db(&state)?, batch_id, seq)?;
    tauri_plugin_opener::open_path(&path, None::<&str>).map_err(|e| Error::msg(e.to_string()))
}

/// Put back the files a batch moved, in the background. A change that can't be undone is
/// refused here, before the job starts, so the message reaches the button that asked.
#[tauri::command]
pub fn undo_batch(app: AppHandle, state: State<AppState>, batch_id: i64) -> Result<()> {
    let (root, table) = {
        let conn = lock_db(&state)?;
        check(&conn, batch_id)?;
        (library_root(&conn)?, format_table(&conn)?)
    };
    let handle = app.clone();
    jobs::start(&app, "undo", move |ctx| {
        let state = handle.state::<AppState>();
        let env = Env {
            db: &state.db,
            root: &root,
            table: &table,
            cancel: ctx.cancel_flag(),
            report: &|stage, done, total| ctx.report(stage, done, total),
        };
        undo(&env, batch_id)
    })
}

/// Undo a batch: its file moves, then any database change saved with it. A trip or folder
/// naming change is checked first, so one changed again since is refused before any file
/// moves. The database change only goes back once every file has, so a partly undone change
/// can be retried.
pub fn undo(env: &Env, batch_id: i64) -> Result<UndoSummary> {
    let undo_data = check(&*lock(env)?, batch_id)?;
    let summary = executor::undo(env, batch_id)?;
    if let Some((kind, data)) = &undo_data {
        let conn = lock(env)?;
        let status: String = conn.query_row(
            "SELECT status FROM batches WHERE id = ?1",
            [batch_id],
            |r| r.get(0),
        )?;
        if status == "undone" {
            match kind.as_str() {
                "naming" => naming::restore(&conn, data)?,
                "date" => redate::restore(&conn, data)?,
                _ => trips::restore(&conn, data)?,
            }
        }
    }
    Ok(summary)
}

/// Refuse an undo that can't go ahead. Returns the batch's kind and undo data, if it has any.
fn check(conn: &Connection, batch_id: i64) -> Result<Option<(String, String)>> {
    let (kind, status, data): (String, String, Option<String>) = conn
        .query_row(
            "SELECT kind, status, undo_data FROM batches WHERE id = ?1",
            [batch_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()?
        .ok_or_else(|| Error::msg("That change is no longer in the history"))?;
    if status == "undone" {
        return Err(Error::msg("That change has already been undone"));
    }
    let Some(data) = data else {
        return Ok(None);
    };
    match kind.as_str() {
        "naming" => naming::check_undo(conn, &data)?,
        "date" => redate::check_undo(conn, &data)?,
        _ => trips::check_undo(conn, &data)?,
    }
    Ok(Some((kind, data)))
}

fn lock<'a>(env: &Env<'a>) -> Result<std::sync::MutexGuard<'a, Connection>> {
    env.db
        .lock()
        .map_err(|_| Error::msg("Database lock poisoned"))
}
