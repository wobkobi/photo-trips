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
use crate::organise::relative;
use crate::trips;

/// Batches shown on the History page, newest first.
const BATCH_LIMIT: i64 = 200;
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
    /// Paths relative to the library folder when inside it.
    pub from: String,
    pub to: String,
    pub status: String,
    pub error: Option<String>,
}

#[tauri::command(async)]
pub fn list_batches(state: State<'_, AppState>) -> Result<Vec<BatchInfo>> {
    let conn = lock_db(&state)?;
    let mut stmt = conn.prepare(
        "SELECT b.id, b.kind, b.label, b.status, b.created_at, b.undone_at, COUNT(j.id),
                COALESCE(SUM(j.status = 'done'), 0), COALESCE(SUM(j.status = 'failed'), 0),
                COALESCE(SUM(j.status = 'skipped'), 0), COALESCE(SUM(j.status = 'undone'), 0),
                b.undo_data IS NOT NULL
         FROM batches b LEFT JOIN journal j ON j.batch_id = b.id
         GROUP BY b.id ORDER BY b.id DESC LIMIT ?1",
    )?;
    let rows = stmt.query_map([BATCH_LIMIT], |row| {
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
        "SELECT seq, src, dst, status, error FROM journal
         WHERE batch_id = ?1 ORDER BY seq LIMIT ?2",
    )?;
    let rows = stmt.query_map(params![batch_id, ENTRY_LIMIT], |row| {
        let src: String = row.get(1)?;
        let dst: String = row.get(2)?;
        Ok(EntryInfo {
            seq: row.get(0)?,
            from: relative(&root, Path::new(&src)),
            to: relative(&root, Path::new(&dst)),
            status: row.get(3)?,
            error: row.get(4)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
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

/// Undo a batch: its file moves, then any database change saved with it. A trip change is
/// checked first, so a trip edited again since is refused before any file moves. The trip
/// row only goes back once every file has, so a partly undone change can be retried.
pub fn undo(env: &Env, batch_id: i64) -> Result<UndoSummary> {
    let undo_data = check(&*lock(env)?, batch_id)?;
    let summary = executor::undo(env, batch_id)?;
    if let Some(data) = &undo_data {
        let conn = lock(env)?;
        let status: String = conn.query_row(
            "SELECT status FROM batches WHERE id = ?1",
            [batch_id],
            |r| r.get(0),
        )?;
        if status == "undone" {
            trips::restore(&conn, data)?;
        }
    }
    Ok(summary)
}

/// Refuse an undo that can't go ahead. Returns the batch's undo data, if it has any.
fn check(conn: &Connection, batch_id: i64) -> Result<Option<String>> {
    let (status, data): (String, Option<String>) = conn
        .query_row(
            "SELECT status, undo_data FROM batches WHERE id = ?1",
            [batch_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?
        .ok_or_else(|| Error::msg("That change is no longer in the history"))?;
    if status == "undone" {
        return Err(Error::msg("That change has already been undone"));
    }
    if let Some(data) = &data {
        trips::check_undo(conn, data)?;
    }
    Ok(data)
}

fn lock<'a>(env: &Env<'a>) -> Result<std::sync::MutexGuard<'a, Connection>> {
    env.db
        .lock()
        .map_err(|_| Error::msg("Database lock poisoned"))
}
