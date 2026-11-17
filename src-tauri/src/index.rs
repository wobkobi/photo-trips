// Build and refresh the media index for the library folder. Read-only on disk: this never
// moves or changes a file, it only records what is there.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

use nom_exif::MediaParser;
use rayon::prelude::*;
use rusqlite::{Connection, params};
use serde::Serialize;

use crate::dates::{self, DateSource};
use crate::db;
use crate::error::{Error, Result};
use crate::exiftool::ExifTool;
use crate::formats::{FormatTable, Kind};
use crate::groups::MediaRow;
use crate::metadata::{self, Embedded, MediaMeta};
use crate::planner;
use crate::scan::{self, ScannedFile};

#[derive(Debug, Default, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexSummary {
    pub files: usize,
    pub added: usize,
    pub updated: usize,
    pub removed: usize,
    pub other_files: u64,
    /// Folders (or files) that couldn't be read. Their photos stay in the index until they can.
    pub unreadable: usize,
}

/// Progress callback: (what is happening, done, total). Total 0 means "unknown yet".
pub type Report<'a> = &'a (dyn Fn(&str, usize, usize) + Sync);

/// A file as the scan saw it, plus the date and place read from it: everything its index row
/// needs except the group key, which depends on where the file ends up.
#[derive(Debug, Clone, PartialEq)]
pub struct NewRow {
    pub path: PathBuf,
    pub kind: Kind,
    pub size: u64,
    /// Unix seconds.
    pub mtime: i64,
    pub meta: MediaMeta,
}

/// Bring the index in line with the files under `root`. Unchanged files (same path, size and
/// modified time) are not re-read, so a refresh of a big library takes seconds.
pub fn run(
    db: &Mutex<Connection>,
    root: &Path,
    table: &FormatTable,
    exiftool: Option<&Path>,
    cancel: &AtomicBool,
    report: Report,
) -> Result<IndexSummary> {
    report("Looking for photos and videos", 0, 0);
    let scanned = scan::scan(root, table, cancel)?;

    let known = {
        let conn = lock(db)?;
        known_files(&conn)?
    };
    let to_read: Vec<&ScannedFile> = scanned
        .files
        .iter()
        .filter(|f| {
            known
                .get(&path_key(&f.path))
                .is_none_or(|&(size, mtime)| size != f.size || mtime != f.mtime)
        })
        .collect();

    let new_rows = read_files(&to_read, exiftool, cancel, report)?;

    report("Saving the index", 0, 0);
    let mut summary = IndexSummary {
        files: scanned.files.len(),
        other_files: scanned.other_files,
        unreadable: scanned.unreadable.len(),
        ..Default::default()
    };
    // A library folder that vanished mid-scan (a drive unplugged) says nothing about its files.
    let root_gone = !root.is_dir();
    let mut conn = lock(db)?;
    let tx = conn.transaction()?;
    {
        let mut upsert = tx.prepare(
            "INSERT INTO media (path, group_key, kind, size, mtime, taken_at, tz_offset_min,
                                date_source, lat, lon, hash, indexed_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, NULL, ?11)
             ON CONFLICT(path) DO UPDATE SET
                group_key = excluded.group_key, kind = excluded.kind, size = excluded.size,
                mtime = excluded.mtime, taken_at = excluded.taken_at,
                tz_offset_min = excluded.tz_offset_min, date_source = excluded.date_source,
                lat = excluded.lat, lon = excluded.lon, hash = NULL,
                indexed_at = excluded.indexed_at",
        )?;
        let now = db::now();
        for file in &new_rows {
            let meta = &file.meta;
            upsert.execute(params![
                file.path.to_string_lossy(),
                scan::group_key(&file.path, file.kind, table),
                file.kind.as_str(),
                file.size as i64,
                file.mtime,
                dates::format(&meta.taken_at),
                meta.offset_min,
                meta.source.as_str(),
                meta.lat,
                meta.lon,
                now,
            ])?;
            if known.contains_key(&path_key(&file.path)) {
                summary.updated += 1;
            } else {
                summary.added += 1;
            }
        }

        // Anything indexed earlier that is no longer on disk (deleted, moved outside the app,
        // or under a previous library folder) drops out of the index. Rows the scan couldn't
        // see into are kept, so a folder that fails to open once doesn't lose its set dates.
        let present: HashSet<String> = scanned.files.iter().map(|f| path_key(&f.path)).collect();
        let mut delete = tx.prepare("DELETE FROM media WHERE path = ?1")?;
        for (path, _) in known_paths(&tx)? {
            let path_ref = Path::new(&path);
            if !present.contains(&path_key(path_ref))
                && !unseen(path_ref, root, root_gone, &scanned.unreadable)
            {
                delete.execute([&path])?;
                summary.removed += 1;
            }
        }
    }
    tx.commit()?;
    Ok(summary)
}

/// True when the scan couldn't see `path`: it sits in a folder that failed to open, or in the
/// library folder when that has gone altogether. Such a file may still be there.
fn unseen(path: &Path, root: &Path, root_gone: bool, unreadable: &[PathBuf]) -> bool {
    (root_gone && planner::is_inside(path, root))
        || unreadable.iter().any(|dir| planner::is_inside(path, dir))
}

/// Work out when and where each file was taken: the in-process readers in parallel, ExifTool
/// for what they missed, then the file name and modified time. Errors only when cancelled.
pub fn read_files(
    files: &[&ScannedFile],
    exiftool: Option<&Path>,
    cancel: &AtomicBool,
    report: Report,
) -> Result<Vec<NewRow>> {
    let embedded = read_embedded(files, cancel, report)?;
    let embedded = exiftool_pass(files, embedded, exiftool, cancel, report)?;
    Ok(files
        .iter()
        .zip(embedded)
        .map(|(file, found)| NewRow {
            path: file.path.clone(),
            kind: file.kind,
            size: file.size,
            mtime: file.mtime,
            meta: metadata::finish(&file.path, file.mtime, found),
        })
        .collect())
}

/// Read dates with the in-process readers, in parallel across cores.
fn read_embedded(
    files: &[&ScannedFile],
    cancel: &AtomicBool,
    report: Report,
) -> Result<Vec<Option<Embedded>>> {
    let total = files.len();
    let done = AtomicUsize::new(0);
    report("Reading dates", 0, total);
    let results: Vec<Option<Embedded>> = files
        .par_iter()
        .map_init(MediaParser::new, |parser, file| {
            if cancel.load(Ordering::Relaxed) {
                return None;
            }
            let found = metadata::read_fast(parser, &file.path, file.kind);
            let n = done.fetch_add(1, Ordering::Relaxed) + 1;
            if n.is_multiple_of(50) || n == total {
                report("Reading dates", n, total);
            }
            found
        })
        .collect();
    if cancel.load(Ordering::Relaxed) {
        return Err(Error::msg("Cancelled"));
    }
    Ok(results)
}

/// Ask ExifTool about files the fast readers couldn't date, for formats where it can help.
/// Skipped (not an error) when ExifTool isn't available.
fn exiftool_pass(
    files: &[&ScannedFile],
    mut embedded: Vec<Option<Embedded>>,
    exe: Option<&Path>,
    cancel: &AtomicBool,
    report: Report,
) -> Result<Vec<Option<Embedded>>> {
    let pending: Vec<usize> = (0..files.len())
        .filter(|&i| embedded[i].is_none() && metadata::worth_exiftool(&files[i].path, files[i].kind))
        .collect();
    let Some(exe) = exe.filter(|_| !pending.is_empty()) else {
        return Ok(embedded);
    };
    let Ok(mut tool) = ExifTool::start(exe) else {
        log::warn!("ExifTool failed to start; dates for {} files fall back", pending.len());
        return Ok(embedded);
    };
    for (n, &i) in pending.iter().enumerate() {
        if cancel.load(Ordering::Relaxed) {
            return Err(Error::msg("Cancelled"));
        }
        if n.is_multiple_of(10) {
            report("Reading dates from older formats", n, pending.len());
        }
        match tool.read(&files[i].path) {
            Ok(found) => embedded[i] = found,
            Err(err) => {
                // The process died: restart it once per failure and carry on.
                log::warn!("ExifTool failed on {}: {err}", files[i].path.display());
                match ExifTool::start(exe) {
                    Ok(fresh) => tool = fresh,
                    Err(_) => break,
                }
            }
        }
    }
    Ok(embedded)
}

/// Every indexed file, for grouping, planning and the library view.
pub fn load_rows(conn: &Connection) -> Result<Vec<MediaRow>> {
    query_rows(conn, "", [])
}

/// The files sharing one group key (a photo and its companions).
pub fn load_group(conn: &Connection, group_key: &str) -> Result<Vec<MediaRow>> {
    query_rows(conn, "WHERE group_key = ?1", [group_key])
}

fn query_rows(conn: &Connection, filter: &str, args: impl rusqlite::Params) -> Result<Vec<MediaRow>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT id, path, group_key, kind, size, mtime, COALESCE(date_set, taken_at),
                CASE WHEN date_set IS NULL THEN date_source ELSE 'set' END, lat, lon, hash
         FROM media {filter}"
    ))?;
    let rows = stmt.query_map(args, |row| {
        let kind: String = row.get(3)?;
        let taken: String = row.get(6)?;
        let source: String = row.get(7)?;
        Ok(MediaRow {
            id: row.get(0)?,
            path: PathBuf::from(row.get::<_, String>(1)?),
            group_key: row.get(2)?,
            kind: Kind::parse(&kind).unwrap_or(Kind::Companion),
            size: row.get::<_, i64>(4)? as u64,
            mtime: row.get(5)?,
            taken_at: dates::parse(&taken).unwrap_or_default(),
            date_source: DateSource::parse(&source),
            lat: row.get(8)?,
            lon: row.get(9)?,
            hash: row.get(10)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// Windows paths are case-insensitive, so compare them lowercased.
pub fn path_key(path: &Path) -> String {
    path.to_string_lossy().to_lowercase()
}

fn known_files(conn: &Connection) -> Result<HashMap<String, (u64, i64)>> {
    let mut stmt = conn.prepare("SELECT path, size, mtime FROM media")?;
    let rows = stmt.query_map([], |row| {
        let path: String = row.get(0)?;
        Ok((path_key(Path::new(&path)), (row.get::<_, i64>(1)? as u64, row.get(2)?)))
    })?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

fn known_paths(conn: &Connection) -> Result<Vec<(String, i64)>> {
    let mut stmt = conn.prepare("SELECT path, id FROM media")?;
    let rows = stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

fn lock(db: &Mutex<Connection>) -> Result<std::sync::MutexGuard<'_, Connection>> {
    db.lock().map_err(|_| Error::msg("Database lock poisoned"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn fixtures() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures")
    }

    fn exiftool() -> Option<PathBuf> {
        crate::exiftool::locate(Path::new(env!("CARGO_MANIFEST_DIR")))
    }

    fn snapshot(root: &Path) -> Vec<(PathBuf, u64, i64)> {
        let mut files: Vec<_> = walkdir::WalkDir::new(root)
            .into_iter()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_type().is_file())
            .map(|e| {
                let meta = e.metadata().unwrap();
                (e.into_path(), meta.len(), scan::mtime_secs(&meta))
            })
            .collect();
        files.sort();
        files
    }

    fn no_report(_: &str, _: usize, _: usize) {}

    #[test]
    fn files_the_scan_could_not_see_are_kept() {
        let root = Path::new(r"C:\L");
        let unreadable = [PathBuf::from(r"C:\L\2024\2024-05")];
        let photo = Path::new(r"C:\L\2024\2024-05\IMG_1.JPG");
        let other = Path::new(r"C:\L\2024\2024-06\IMG_2.JPG");
        let old_library = Path::new(r"D:\Old\IMG_3.JPG");
        assert!(unseen(photo, root, false, &unreadable));
        assert!(!unseen(other, root, false, &unreadable));
        assert!(unseen(other, root, true, &[]));
        assert!(!unseen(old_library, root, true, &[]));
    }

    #[test]
    fn a_library_folder_that_has_gone_keeps_its_index() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("Photos");
        fs::create_dir(&root).unwrap();
        fs::copy(fixtures().join("exif_gps.jpg"), root.join("a.jpg")).unwrap();
        let db = Mutex::new(db::open_in_memory().unwrap());
        let (table, cancel) = (FormatTable::default(), AtomicBool::new(false));
        run(&db, &root, &table, None, &cancel, &no_report).unwrap();

        fs::rename(&root, dir.path().join("Unplugged")).unwrap();
        let summary = run(&db, &root, &table, None, &cancel, &no_report).unwrap();
        assert_eq!(summary.removed, 0);
        assert_eq!(load_rows(&db.lock().unwrap()).unwrap().len(), 1);
    }

    #[test]
    fn indexes_fixtures_without_touching_disk_and_refreshes_incrementally() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        for name in ["exif_gps.jpg", "apple.mov", "utc.mp4", "old.avi", "plain.png", "raw.dng"] {
            fs::copy(fixtures().join(name), root.join(name)).unwrap();
        }
        fs::write(root.join("notes.txt"), "x").unwrap();
        let before = snapshot(root);

        let db = Mutex::new(db::open_in_memory().unwrap());
        let table = FormatTable::default();
        let cancel = AtomicBool::new(false);
        let summary = run(&db, root, &table, exiftool().as_deref(), &cancel, &no_report).unwrap();
        assert_eq!((summary.files, summary.added, summary.other_files), (6, 6, 1));
        assert_eq!(snapshot(root), before, "indexing must not change any file");

        let rows = load_rows(&db.lock().unwrap()).unwrap();
        let by_name = |name: &str| rows.iter().find(|r| r.path.ends_with(name)).unwrap();
        assert_eq!(by_name("exif_gps.jpg").date_source, DateSource::Exif);
        assert!(by_name("exif_gps.jpg").lat.is_some());
        assert_eq!(by_name("raw.dng").date_source, DateSource::Exif);
        assert_eq!(by_name("apple.mov").date_source, DateSource::Video);
        assert_eq!(by_name("plain.png").date_source, DateSource::Modified);
        if exiftool().is_some() {
            assert_eq!(by_name("old.avi").date_source, DateSource::Exiftool);
        }

        // Second run: nothing changed, nothing re-read. Then a deletion is noticed.
        let again = run(&db, root, &table, None, &cancel, &no_report).unwrap();
        assert_eq!((again.added, again.updated, again.removed), (0, 0, 0));
        fs::remove_file(root.join("utc.mp4")).unwrap();
        let after = run(&db, root, &table, None, &cancel, &no_report).unwrap();
        assert_eq!((after.files, after.removed), (5, 1));
    }
}
