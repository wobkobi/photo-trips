// Carry out a plan on disk. Every move is written to the journal as pending before the file
// is touched, a move never replaces an existing file, and a whole batch can be undone.
// Entries a crash left pending are settled at the next start by looking at the disk.
//
// Journal entry states: pending (about to move), done (file is at dst), failed (file is at
// src), skipped (cancelled before it ran), undoing (about to move back), undone (back at src).

use std::collections::BTreeSet;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, MutexGuard};

use rusqlite::{Connection, OptionalExtension, params};
use serde::Serialize;

use crate::db;
use crate::error::{Error, Result};
use crate::formats::{FormatTable, Kind};
use crate::hash;
use crate::index::Report;
use crate::planner::{GroupMove, Move, Plan, is_inside, same_path};
use crate::scan;

#[derive(Debug, Default, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplySummary {
    pub batch_id: i64,
    pub moved: usize,
    pub failed: usize,
    pub cancelled: bool,
}

#[derive(Debug, Default, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UndoSummary {
    pub batch_id: i64,
    pub restored: usize,
    pub failed: usize,
    pub cancelled: bool,
}

/// Everything a run needs besides the plan itself.
pub struct Env<'a> {
    pub db: &'a Mutex<Connection>,
    pub root: &'a Path,
    pub table: &'a FormatTable,
    pub cancel: &'a AtomicBool,
    pub report: Report<'a>,
}

/// One journal row.
#[derive(Debug, Clone)]
struct Entry {
    id: i64,
    src: PathBuf,
    dst: PathBuf,
    status: String,
    media_id: Option<i64>,
}

/// A database change that belongs to a batch (saving a trip, say), made in the same
/// transaction that records the batch. Returns JSON that undo needs to reverse it, if any.
pub type OnBegin = dyn Fn(&Connection) -> Result<Option<String>> + Send + Sync;

/// What a new batch is called, plus any database change that goes with it.
pub struct NewBatch<'a> {
    /// `organise`, `trip`, and so on.
    pub kind: &'a str,
    /// One line for History, e.g. "Sorted 12 files into year and month folders".
    pub label: &'a str,
    pub on_begin: Option<&'a OnBegin>,
}

/// Record a batch and all its moves as pending, in one transaction, before any file is
/// touched. Returns the batch id and the journal ids, shaped like `groups`. If `on_begin`
/// fails, nothing is recorded.
pub fn begin(
    conn: &mut Connection,
    batch: &NewBatch,
    groups: &[GroupMove],
) -> Result<(i64, Vec<Vec<i64>>)> {
    let tx = conn.transaction()?;
    let undo_data = match batch.on_begin {
        Some(change) => change(&tx)?,
        None => None,
    };
    tx.execute(
        "INSERT INTO batches (kind, label, status, created_at, undo_data)
         VALUES (?1, ?2, 'running', ?3, ?4)",
        params![batch.kind, batch.label, db::now(), undo_data],
    )?;
    let batch_id = tx.last_insert_rowid();
    let mut ids = Vec::with_capacity(groups.len());
    {
        let mut insert = tx.prepare(
            "INSERT INTO journal (batch_id, seq, op, src, dst, status, media_id)
             VALUES (?1, ?2, 'move', ?3, ?4, 'pending', ?5)",
        )?;
        let mut seq = 0_i64;
        for group in groups {
            let mut group_ids = Vec::with_capacity(group.moves.len());
            for mv in &group.moves {
                insert.execute(params![
                    batch_id,
                    seq,
                    mv.from.to_string_lossy(),
                    mv.to.to_string_lossy(),
                    mv.media_id
                ])?;
                group_ids.push(tx.last_insert_rowid());
                seq += 1;
            }
            ids.push(group_ids);
        }
    }
    tx.commit()?;
    Ok((batch_id, ids))
}

/// Run a plan as one undoable batch. A file that can't be moved (in use, name taken since the
/// preview) is reported in the journal and the rest carry on.
pub fn apply(env: &Env, batch: &NewBatch, plan: &Plan) -> Result<ApplySummary> {
    let total = plan.file_count();
    let (batch_id, ids) = begin(&mut *lock(env.db)?, batch, &plan.groups)?;
    let mut summary = ApplySummary {
        batch_id,
        ..ApplySummary::default()
    };
    let mut emptied = BTreeSet::new();
    (env.report)("Moving files", 0, total);
    for (group, group_ids) in plan.groups.iter().zip(&ids) {
        if env.cancel.load(Ordering::Relaxed) {
            summary.cancelled = true;
            break;
        }
        if move_group(env, group, group_ids)? {
            summary.moved += group.moves.len();
            emptied.extend(
                group
                    .moves
                    .iter()
                    .filter_map(|m| m.from.parent().map(Path::to_path_buf)),
            );
        } else {
            summary.failed += group.moves.len();
        }
        (env.report)("Moving files", summary.moved + summary.failed, total);
    }

    let status = if summary.cancelled {
        "cancelled"
    } else if summary.failed == 0 {
        "done"
    } else if summary.moved > 0 {
        "partial"
    } else {
        "failed"
    };
    {
        let conn = lock(env.db)?;
        conn.execute(
            "UPDATE journal SET status = 'skipped' WHERE batch_id = ?1 AND status = 'pending'",
            [batch_id],
        )?;
        conn.execute(
            "UPDATE batches SET status = ?1 WHERE id = ?2",
            params![status, batch_id],
        )?;
    }
    remove_empty_dirs(env.root, emptied);
    Ok(summary)
}

/// Move every file of one group, or none of them: when one fails, those already moved go back.
/// Returns whether the group moved. Errors only on database failure.
fn move_group(env: &Env, group: &GroupMove, ids: &[i64]) -> Result<bool> {
    for (i, (mv, &id)) in group.moves.iter().zip(ids).enumerate() {
        if let Err(err) = move_file(&mv.from, &mv.to) {
            set_entry(&*lock(env.db)?, id, "failed", Some(&err.to_string()))?;
            put_back(env, &group.moves[..i], &ids[..i], &mv.from)?;
            return Ok(false);
        }
        let conn = lock(env.db)?;
        set_media_path(&conn, Some(mv.media_id), &mv.to, env.table)?;
        set_entry(&conn, id, "done", None)?;
    }
    Ok(true)
}

/// Return the members of a group that already moved when `blocked` couldn't follow them.
fn put_back(env: &Env, moved: &[Move], ids: &[i64], blocked: &Path) -> Result<()> {
    let reason = format!("Put back because {} couldn't be moved", file_name(blocked));
    for (mv, &id) in moved.iter().zip(ids).rev() {
        set_entry(&*lock(env.db)?, id, "undoing", None)?;
        let outcome = move_file(&mv.to, &mv.from);
        let conn = lock(env.db)?;
        match outcome {
            Ok(()) => {
                set_media_path(&conn, Some(mv.media_id), &mv.from, env.table)?;
                set_entry(&conn, id, "failed", Some(&reason))?;
            }
            // Stuck in its new place: the journal says so, and undo can still bring it back.
            Err(err) => set_entry(&conn, id, "done", Some(&err.to_string()))?,
        }
    }
    Ok(())
}

/// Put back every file a batch moved, newest first. A file is only moved back when it is
/// still where the batch left it and nothing else has taken its old name.
pub fn undo(env: &Env, batch_id: i64) -> Result<UndoSummary> {
    let entries = {
        let conn = lock(env.db)?;
        let status: String = conn
            .query_row(
                "SELECT status FROM batches WHERE id = ?1",
                [batch_id],
                |r| r.get(0),
            )
            .optional()?
            .ok_or_else(|| Error::msg("That change is no longer in the history"))?;
        if status == "running" || status == "undoing" {
            return Err(Error::msg("That change is still in progress"));
        }
        conn.execute(
            "UPDATE batches SET status = 'undoing' WHERE id = ?1",
            [batch_id],
        )?;
        load_entries(
            &conn,
            "WHERE batch_id = ?1 AND status = 'done' ORDER BY seq DESC",
            [batch_id],
        )?
    };
    let total = entries.len();
    let mut summary = UndoSummary {
        batch_id,
        ..UndoSummary::default()
    };
    let mut emptied = BTreeSet::new();
    (env.report)("Putting files back", 0, total);
    for entry in &entries {
        if env.cancel.load(Ordering::Relaxed) {
            summary.cancelled = true;
            break;
        }
        let blocker = undo_blocker(&*lock(env.db)?, entry);
        let outcome = match blocker {
            Some(reason) => Err(Error::msg(reason)),
            None => {
                set_entry(&*lock(env.db)?, entry.id, "undoing", None)?;
                move_file(&entry.dst, &entry.src)
            }
        };
        let conn = lock(env.db)?;
        match outcome {
            Ok(()) => {
                set_media_path(&conn, entry.media_id, &entry.src, env.table)?;
                set_entry(&conn, entry.id, "undone", None)?;
                emptied.extend(entry.dst.parent().map(Path::to_path_buf));
                summary.restored += 1;
            }
            Err(err) => {
                set_entry(&conn, entry.id, "done", Some(&err.to_string()))?;
                summary.failed += 1;
            }
        }
        drop(conn);
        (env.report)(
            "Putting files back",
            summary.restored + summary.failed,
            total,
        );
    }
    finish_undo(&*lock(env.db)?, batch_id)?;
    remove_empty_dirs(env.root, emptied);
    Ok(summary)
}

/// Why an entry can't be undone right now, if it can't.
fn undo_blocker(conn: &Connection, entry: &Entry) -> Option<String> {
    if let Some(id) = entry.media_id
        && let Ok(Some(path)) = conn
            .query_row("SELECT path FROM media WHERE id = ?1", [id], |r| {
                r.get::<_, String>(0)
            })
            .optional()
        && !same_path(Path::new(&path), &entry.dst)
    {
        return Some("It has been moved again since, so it was left where it is".into());
    }
    if !exists(&entry.dst) {
        return Some(format!("{} is no longer there", entry.dst.display()));
    }
    if exists(&entry.src) {
        return Some(format!(
            "Another file is now called {}",
            entry.src.display()
        ));
    }
    None
}

/// Mark an undone (or partly undone) batch once no entry is mid-undo.
fn finish_undo(conn: &Connection, batch_id: i64) -> Result<()> {
    let remaining: i64 = conn.query_row(
        "SELECT COUNT(*) FROM journal WHERE batch_id = ?1 AND status = 'done'",
        [batch_id],
        |r| r.get(0),
    )?;
    let status = if remaining == 0 {
        "undone"
    } else {
        "partly_undone"
    };
    conn.execute(
        "UPDATE batches SET status = ?1, undone_at = ?2 WHERE id = ?3",
        params![status, db::now(), batch_id],
    )?;
    Ok(())
}

/// Settle journal entries a crash left half-done by checking where each file actually is,
/// then close the batches they belonged to. Returns how many entries were settled.
pub fn recover(conn: &Connection, table: &FormatTable) -> Result<usize> {
    let entries = load_entries(conn, "WHERE status IN ('pending', 'undoing')", [])?;
    for entry in &entries {
        // A temporary copy only ever exists mid-copy; the original is still in place.
        let _ = fs::remove_file(part_path(&entry.dst));
        let _ = fs::remove_file(part_path(&entry.src));
        if entry.status == "pending" {
            if settle(&entry.src, &entry.dst) {
                set_media_path(conn, entry.media_id, &entry.dst, table)?;
                set_entry(conn, entry.id, "done", None)?;
            } else if exists(&entry.src) {
                let note = "Photo Trips closed before this file was moved";
                set_entry(conn, entry.id, "skipped", Some(note))?;
            } else {
                set_entry(conn, entry.id, "failed", Some("The file is missing"))?;
            }
        } else if settle(&entry.dst, &entry.src) {
            set_media_path(conn, entry.media_id, &entry.src, table)?;
            set_entry(conn, entry.id, "undone", None)?;
        } else {
            let note = "Photo Trips closed before this file was put back";
            set_entry(conn, entry.id, "done", Some(note))?;
        }
    }
    conn.execute(
        "UPDATE batches SET status = 'interrupted' WHERE status = 'running'",
        [],
    )?;
    let undoing: Vec<i64> = conn
        .prepare("SELECT id FROM batches WHERE status = 'undoing'")?
        .query_map([], |r| r.get(0))?
        .collect::<rusqlite::Result<_>>()?;
    for batch_id in undoing {
        finish_undo(conn, batch_id)?;
    }
    if !entries.is_empty() {
        log::warn!(
            "Settled {} file moves left unfinished by a crash",
            entries.len()
        );
    }
    Ok(entries.len())
}

/// Where an interrupted move from `from` to `to` really got to: true when the file is at `to`.
fn settle(from: &Path, to: &Path) -> bool {
    match (exists(from), exists(to)) {
        (false, true) => true,
        // A cross-drive copy took its final name but the original wasn't removed yet. Finish
        // the move only when the copy is identical; otherwise both files stay.
        (true, true) => {
            let same = matches!((hash::file(from), hash::file(to)), (Ok(a), Ok(b)) if a == b);
            same && fs::remove_file(from).is_ok()
        }
        _ => false,
    }
}

/// Move one file without ever replacing another. A rename when both paths are on the same
/// drive; otherwise a verified copy (see [`copy_verify_delete`]).
pub fn move_file(from: &Path, to: &Path) -> Result<()> {
    if exists(to) {
        return Err(Error::msg(format!("{} already exists", to.display())));
    }
    if let Some(dir) = to.parent() {
        fs::create_dir_all(dir)?;
    }
    match rename_no_replace(from, to) {
        Ok(()) => Ok(()),
        Err(err) if is_cross_device(&err) => copy_verify_delete(from, to),
        Err(err) => Err(err.into()),
    }
}

/// Move to another drive. The copy is written under a temporary name and only takes the real
/// name once its hash matches the original, so a half-written copy is never mistaken for the
/// photo. The original is removed last.
pub fn copy_verify_delete(from: &Path, to: &Path) -> Result<()> {
    let part = part_path(to);
    // On Windows this is CopyFileEx, which keeps the modified time.
    fs::copy(from, &part)?;
    if hash::file(from)? != hash::file(&part)? {
        let _ = fs::remove_file(&part);
        return Err(Error::msg(format!(
            "The copy of {} didn't match the original, so the original was kept",
            from.display()
        )));
    }
    if let Err(err) = rename_no_replace(&part, to) {
        let _ = fs::remove_file(&part);
        return Err(err.into());
    }
    if let Err(err) = fs::remove_file(from) {
        // The original is in use: drop the verified copy so the file is in exactly one place.
        let _ = fs::remove_file(to);
        return Err(err.into());
    }
    Ok(())
}

/// Temporary name for a copy in progress, next to its final name. The extension isn't a
/// media type, so a leftover is never indexed or moved.
fn part_path(to: &Path) -> PathBuf {
    let mut name = to.file_name().unwrap_or_default().to_os_string();
    name.push(".phototrips-part");
    to.with_file_name(name)
}

#[cfg(windows)]
fn rename_no_replace(from: &Path, to: &Path) -> io::Result<()> {
    use windows::Win32::Storage::FileSystem::{MOVE_FILE_FLAGS, MoveFileExW};
    // No MOVEFILE_REPLACE_EXISTING: fails when `to` exists. No MOVEFILE_COPY_ALLOWED: a move to
    // another drive fails with ERROR_NOT_SAME_DEVICE so the caller can do a verified copy.
    unsafe {
        MoveFileExW(
            &crate::win::parsing_name(from),
            &crate::win::parsing_name(to),
            MOVE_FILE_FLAGS(0),
        )
    }
    .map_err(|e| io::Error::from_raw_os_error(e.code().0 & 0xFFFF))
}

#[cfg(not(windows))]
fn rename_no_replace(from: &Path, to: &Path) -> io::Result<()> {
    if exists(to) {
        return Err(io::ErrorKind::AlreadyExists.into());
    }
    fs::rename(from, to)
}

fn is_cross_device(err: &io::Error) -> bool {
    // 17 is ERROR_NOT_SAME_DEVICE on Windows.
    err.kind() == io::ErrorKind::CrossesDevices || (cfg!(windows) && err.raw_os_error() == Some(17))
}

/// Remove folders a batch left empty, walking up towards the library root. Only ever inside
/// the root, never the root itself, and `remove_dir` refuses any folder that isn't empty.
pub fn remove_empty_dirs(root: &Path, dirs: impl IntoIterator<Item = PathBuf>) {
    let mut dirs: Vec<PathBuf> = dirs.into_iter().collect();
    // Deepest first, so a parent is tried after its children.
    dirs.sort_by_key(|d| std::cmp::Reverse(d.components().count()));
    for dir in dirs {
        let mut current = dir.as_path();
        while is_inside(current, root) && !same_path(current, root) {
            if fs::remove_dir(current).is_err() {
                break;
            }
            match current.parent() {
                Some(parent) => current = parent,
                None => break,
            }
        }
    }
}

/// Point a media row at a file's new place. Its group key changes with the folder and name.
fn set_media_path(
    conn: &Connection,
    media_id: Option<i64>,
    path: &Path,
    table: &FormatTable,
) -> Result<()> {
    let Some(id) = media_id else { return Ok(()) };
    let kind: Option<String> = conn
        .query_row("SELECT kind FROM media WHERE id = ?1", [id], |r| r.get(0))
        .optional()?;
    let Some(kind) = kind else { return Ok(()) };
    let kind = Kind::parse(&kind).unwrap_or(Kind::Companion);
    let text = path.to_string_lossy();
    // A file deleted since the last refresh may still hold this path in the index.
    conn.execute(
        "DELETE FROM media WHERE path = ?1 AND id != ?2",
        params![text, id],
    )?;
    conn.execute(
        "UPDATE media SET path = ?1, group_key = ?2 WHERE id = ?3",
        params![text, scan::group_key(path, kind, table), id],
    )?;
    Ok(())
}

fn set_entry(conn: &Connection, id: i64, status: &str, error: Option<&str>) -> Result<()> {
    conn.execute(
        "UPDATE journal SET status = ?1, error = ?2 WHERE id = ?3",
        params![status, error, id],
    )?;
    Ok(())
}

fn load_entries(
    conn: &Connection,
    filter: &str,
    args: impl rusqlite::Params,
) -> Result<Vec<Entry>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT id, src, dst, status, media_id FROM journal {filter}"
    ))?;
    let rows = stmt.query_map(args, |row| {
        Ok(Entry {
            id: row.get(0)?,
            src: PathBuf::from(row.get::<_, String>(1)?),
            dst: PathBuf::from(row.get::<_, String>(2)?),
            status: row.get(3)?,
            media_id: row.get(4)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// True when anything (file, folder or broken link) has this path.
fn exists(path: &Path) -> bool {
    fs::symlink_metadata(path).is_ok()
}

fn file_name(path: &Path) -> String {
    path.file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default()
}

fn lock(db: &Mutex<Connection>) -> Result<MutexGuard<'_, Connection>> {
    db.lock().map_err(|_| Error::msg("Database lock poisoned"))
}

/// Temp-folder libraries and disk snapshots, shared by the executor and trip tests.
#[cfg(test)]
pub mod testing {
    use super::*;
    use crate::index;

    pub fn no_report(_: &str, _: usize, _: usize) {}

    /// Library in a temp folder with the given files, indexed into an in-memory database.
    /// File names carry their dates (IMG_YYYYMMDD_HHMMSS) since the bytes aren't real photos.
    pub fn library(files: &[&str]) -> (tempfile::TempDir, Mutex<Connection>) {
        let dir = tempfile::tempdir().unwrap();
        for (i, rel) in files.iter().enumerate() {
            let path = dir.path().join(rel);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(&path, format!("file {i} {rel}")).unwrap();
        }
        let db = Mutex::new(db::open_in_memory().unwrap());
        let cancel = AtomicBool::new(false);
        index::run(
            &db,
            dir.path(),
            &FormatTable::default(),
            None,
            &cancel,
            &no_report,
        )
        .unwrap();
        (dir, db)
    }

    /// Relative path, size and modified time of every file under `root`, sorted.
    pub fn snapshot(root: &Path) -> Vec<(String, u64, i64)> {
        let mut files: Vec<_> = walkdir::WalkDir::new(root)
            .into_iter()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_type().is_file())
            .map(|e| {
                let meta = e.metadata().unwrap();
                let rel = e
                    .path()
                    .strip_prefix(root)
                    .unwrap()
                    .to_string_lossy()
                    .into_owned();
                (rel, meta.len(), scan::mtime_secs(&meta))
            })
            .collect();
        files.sort();
        files
    }
}

#[cfg(test)]
mod tests {
    use super::testing::{library, no_report, snapshot};
    use super::*;
    use crate::groups;
    use crate::index;
    use crate::planner::{self, Rules};

    const TEST_BATCH: NewBatch = NewBatch {
        kind: "organise",
        label: "test",
        on_begin: None,
    };

    fn make_plan(db: &Mutex<Connection>, root: &Path) -> Plan {
        let rows = index::load_rows(&db.lock().unwrap()).unwrap();
        let (groups, orphans) = groups::build(rows);
        planner::plan(
            &Rules { root, trips: &[] },
            &groups,
            orphans.len(),
            &FormatTable::default(),
            &|p| exists(p),
        )
    }

    fn statuses(db: &Mutex<Connection>, batch_id: i64) -> Vec<String> {
        let conn = db.lock().unwrap();
        let mut stmt = conn
            .prepare("SELECT status FROM journal WHERE batch_id = ?1 ORDER BY seq")
            .unwrap();
        stmt.query_map([batch_id], |r| r.get(0))
            .unwrap()
            .collect::<rusqlite::Result<_>>()
            .unwrap()
    }

    fn batch_status(db: &Mutex<Connection>, batch_id: i64) -> String {
        db.lock()
            .unwrap()
            .query_row(
                "SELECT status FROM batches WHERE id = ?1",
                [batch_id],
                |r| r.get(0),
            )
            .unwrap()
    }

    fn media_paths(db: &Mutex<Connection>, root: &Path) -> Vec<String> {
        let mut paths: Vec<String> = index::load_rows(&db.lock().unwrap())
            .unwrap()
            .iter()
            .map(|r| {
                r.path
                    .strip_prefix(root)
                    .unwrap()
                    .to_string_lossy()
                    .into_owned()
            })
            .collect();
        paths.sort();
        paths
    }

    #[test]
    fn apply_sorts_the_library_and_undo_restores_the_exact_layout() {
        let (dir, db) = library(&[
            "inbox\\IMG_20250312_101500.jpg",
            "inbox\\IMG_20250312_101500.aae",
            "inbox\\sub\\VID_20240101_120000.mp4",
            "2025\\2025-03\\IMG_20250301_090000.jpg",
            "inbox\\notes.txt",
        ]);
        let root = dir.path();
        let table = FormatTable::default();
        let cancel = AtomicBool::new(false);
        let env = Env {
            db: &db,
            root,
            table: &table,
            cancel: &cancel,
            report: &no_report,
        };
        let before = snapshot(root);

        let plan = make_plan(&db, root);
        assert_eq!((plan.file_count(), plan.in_place), (3, 1));
        let summary = apply(&env, &TEST_BATCH, &plan).unwrap();
        assert_eq!(
            (summary.moved, summary.failed, summary.cancelled),
            (3, 0, false)
        );
        assert_eq!(batch_status(&db, summary.batch_id), "done");
        assert_eq!(
            media_paths(&db, root),
            [
                "2024\\2024-01\\VID_20240101_120000.mp4",
                "2025\\2025-03\\IMG_20250301_090000.jpg",
                "2025\\2025-03\\IMG_20250312_101500.aae",
                "2025\\2025-03\\IMG_20250312_101500.jpg",
            ]
        );
        // The emptied subfolder went; the inbox stays because notes.txt is still in it.
        assert!(!root.join("inbox\\sub").exists());
        assert!(root.join("inbox\\notes.txt").exists());
        // The sidecar still groups with its photo, the index agrees with the disk, and a
        // second plan has nothing left to do.
        let (groups, orphans) = groups::build(index::load_rows(&db.lock().unwrap()).unwrap());
        assert_eq!((groups.len(), orphans.len()), (3, 0));
        let again = index::run(&db, root, &table, None, &cancel, &no_report).unwrap();
        assert_eq!((again.added, again.updated, again.removed), (0, 0, 0));
        assert_eq!(make_plan(&db, root).file_count(), 0);

        let undone = undo(&env, summary.batch_id).unwrap();
        assert_eq!((undone.restored, undone.failed), (3, 0));
        assert_eq!(snapshot(root), before);
        assert!(!root.join("2024").exists());
        assert_eq!(batch_status(&db, summary.batch_id), "undone");
        assert!(
            media_paths(&db, root)
                .iter()
                .any(|p| p == "inbox\\sub\\VID_20240101_120000.mp4")
        );
    }

    #[test]
    fn a_file_appearing_after_the_preview_is_never_overwritten() {
        let (dir, db) = library(&[
            "in\\IMG_20250312_101500.jpg",
            "in\\IMG_20250312_101500.aae",
            "in\\IMG_20250401_101500.jpg",
        ]);
        let root = dir.path();
        let table = FormatTable::default();
        let cancel = AtomicBool::new(false);
        let env = Env {
            db: &db,
            root,
            table: &table,
            cancel: &cancel,
            report: &no_report,
        };
        let plan = make_plan(&db, root);
        let squatter = root.join("2025\\2025-03\\IMG_20250312_101500.aae");
        fs::create_dir_all(squatter.parent().unwrap()).unwrap();
        fs::write(&squatter, "someone else's file").unwrap();

        let summary = apply(&env, &TEST_BATCH, &plan).unwrap();
        assert_eq!((summary.moved, summary.failed), (1, 2));
        assert_eq!(batch_status(&db, summary.batch_id), "partial");
        // The photo went back so it stays with its sidecar, and the other file is untouched.
        assert!(root.join("in\\IMG_20250312_101500.jpg").exists());
        assert!(root.join("in\\IMG_20250312_101500.aae").exists());
        assert!(!root.join("2025\\2025-03\\IMG_20250312_101500.jpg").exists());
        assert_eq!(
            fs::read_to_string(&squatter).unwrap(),
            "someone else's file"
        );
        assert!(root.join("2025\\2025-04\\IMG_20250401_101500.jpg").exists());
        assert!(
            media_paths(&db, root)
                .iter()
                .any(|p| p == "in\\IMG_20250312_101500.jpg")
        );
    }

    #[test]
    fn a_crash_mid_batch_is_settled_at_the_next_start() {
        let (dir, db) = library(&[
            "in\\IMG_20250312_101500.jpg",
            "in\\IMG_20250313_101500.jpg",
            "in\\IMG_20250314_101500.jpg",
        ]);
        let root = dir.path();
        let table = FormatTable::default();
        let plan = make_plan(&db, root);
        let (batch_id, _) = begin(&mut db.lock().unwrap(), &TEST_BATCH, &plan.groups).unwrap();
        let mv = |i: usize| plan.groups[i].moves[0].clone();
        fs::create_dir_all(mv(0).to.parent().unwrap()).unwrap();
        // First file: renamed, then the app died before the journal said so.
        fs::rename(mv(0).from, mv(0).to).unwrap();
        // Second: a cross-drive copy finished but the original wasn't removed yet.
        fs::copy(mv(1).from, mv(1).to).unwrap();
        // Third: died part-way through copying.
        fs::write(part_path(&mv(2).to), "half").unwrap();

        let settled = recover(&db.lock().unwrap(), &table).unwrap();
        assert_eq!(settled, 3);
        assert_eq!(statuses(&db, batch_id), ["done", "done", "skipped"]);
        assert_eq!(batch_status(&db, batch_id), "interrupted");
        assert!(!mv(1).from.exists() && mv(1).to.exists());
        assert!(mv(2).from.exists() && !part_path(&mv(2).to).exists());
        assert_eq!(
            media_paths(&db, root),
            [
                "2025\\2025-03\\IMG_20250312_101500.jpg",
                "2025\\2025-03\\IMG_20250313_101500.jpg",
                "in\\IMG_20250314_101500.jpg",
            ]
        );

        // The settled batch undoes like any other.
        let cancel = AtomicBool::new(false);
        let env = Env {
            db: &db,
            root,
            table: &table,
            cancel: &cancel,
            report: &no_report,
        };
        let undone = undo(&env, batch_id).unwrap();
        assert_eq!(undone.restored, 2);
        assert!(mv(0).from.exists() && mv(1).from.exists());
        assert!(!root.join("2025").exists());
    }

    #[test]
    fn cancelling_before_the_first_move_leaves_everything() {
        let (dir, db) = library(&["in\\IMG_20250312_101500.jpg"]);
        let root = dir.path();
        let table = FormatTable::default();
        let cancel = AtomicBool::new(true);
        let env = Env {
            db: &db,
            root,
            table: &table,
            cancel: &cancel,
            report: &no_report,
        };
        let before = snapshot(root);
        let summary = apply(&env, &TEST_BATCH, &make_plan(&db, root)).unwrap();
        assert!(summary.cancelled);
        assert_eq!(statuses(&db, summary.batch_id), ["skipped"]);
        assert_eq!(batch_status(&db, summary.batch_id), "cancelled");
        assert_eq!(snapshot(root), before);
    }

    #[test]
    fn undo_leaves_files_that_were_removed_since() {
        let (dir, db) = library(&["in\\IMG_20250312_101500.jpg", "in\\IMG_20250412_101500.jpg"]);
        let root = dir.path();
        let table = FormatTable::default();
        let cancel = AtomicBool::new(false);
        let env = Env {
            db: &db,
            root,
            table: &table,
            cancel: &cancel,
            report: &no_report,
        };
        let summary = apply(&env, &TEST_BATCH, &make_plan(&db, root)).unwrap();
        fs::remove_file(root.join("2025\\2025-04\\IMG_20250412_101500.jpg")).unwrap();

        let undone = undo(&env, summary.batch_id).unwrap();
        assert_eq!((undone.restored, undone.failed), (1, 1));
        assert_eq!(batch_status(&db, summary.batch_id), "partly_undone");
        assert!(root.join("in\\IMG_20250312_101500.jpg").exists());
    }

    #[test]
    fn verified_copy_keeps_the_modified_time_and_removes_the_original() {
        let dir = tempfile::tempdir().unwrap();
        let from = dir.path().join("a\\IMG_1.JPG");
        let to = dir.path().join("b\\IMG_1.JPG");
        fs::create_dir_all(from.parent().unwrap()).unwrap();
        fs::create_dir_all(to.parent().unwrap()).unwrap();
        fs::write(&from, "photo bytes").unwrap();
        let mtime = scan::mtime_secs(&fs::metadata(&from).unwrap());

        copy_verify_delete(&from, &to).unwrap();
        assert!(!from.exists());
        assert_eq!(fs::read_to_string(&to).unwrap(), "photo bytes");
        assert_eq!(scan::mtime_secs(&fs::metadata(&to).unwrap()), mtime);
        assert!(!part_path(&to).exists());

        // Neither path is ever replaced.
        fs::write(&from, "another photo").unwrap();
        assert!(move_file(&from, &to).is_err());
        assert!(copy_verify_delete(&from, &to).is_err());
        assert_eq!(fs::read_to_string(&from).unwrap(), "another photo");
        assert_eq!(fs::read_to_string(&to).unwrap(), "photo bytes");
    }
}
