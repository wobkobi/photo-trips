// Find photos and videos with identical contents and send the extra copies to the Recycle Bin.
// Only files that share their size with another are ever hashed, so checking a big library
// reads few files. Sidecars (.aae, .xmp) are never compared; one goes to the bin only with
// the last photo or video it belonged to.

use std::cmp::Reverse;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};

use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};

use crate::AppState;
use crate::commands::{format_table, library_root, lock_db};
use crate::error::{Error, Result};
use crate::executor::{self, BinFile, Env, NewBatch, Removal};
use crate::formats::Kind;
use crate::groups::{self, MediaRow};
use crate::hash;
use crate::index::{self, Report, path_key};
use crate::jobs;
use crate::organise::relative;
use crate::planner::{Rules, same_path};
use crate::trips::{self, Trip};

/// Photos and videos that are identical, byte for byte.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DupSet {
    pub hash: String,
    pub size: u64,
    /// `photo`, `raw` or `video`.
    pub kind: &'static str,
    /// Suggested keeper first.
    pub copies: Vec<DupCopy>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DupCopy {
    pub id: i64,
    /// Modified time, for the thumbnail URL.
    pub version: i64,
    /// Relative to the library folder.
    pub path: String,
    /// Already in the trip or month folder it belongs in.
    pub in_place: bool,
    /// Other files that travel with this copy (a Live Photo video, a sidecar).
    pub extra: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DupReport {
    pub sets: Vec<DupSet>,
    /// Files that share a size with another but haven't been compared yet.
    pub unchecked: usize,
    /// Copies beyond the first in every set.
    pub extra: usize,
    /// Space those extra copies take.
    pub bytes: u64,
}

/// One set's outcome, as the user chose it.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Choice {
    pub keep: i64,
    pub remove: Vec<i64>,
}

/// Compare same-size files in the background. The page reloads the sets when it finishes.
#[tauri::command]
pub fn find_duplicates(app: AppHandle) -> Result<()> {
    let handle = app.clone();
    jobs::start(&app, "duplicates", move |ctx| {
        let state = handle.state::<AppState>();
        hash_pending(&state.db, ctx.cancel_flag(), &|stage, done, total| {
            ctx.report(stage, done, total)
        })
    })
}

/// Every duplicate set found so far, with a suggested keeper for each.
#[tauri::command(async)]
pub fn list_duplicates(state: State<'_, AppState>) -> Result<DupReport> {
    let (root, rows, trips) = {
        let conn = lock_db(&state)?;
        (
            library_root(&conn)?,
            index::load_rows(&conn)?,
            trips::load(&conn)?,
        )
    };
    Ok(report(&root, rows, &trips, &|p| {
        fs::symlink_metadata(p).is_ok()
    }))
}

/// Send the copies the user picked to the Recycle Bin, in the background, as one undoable
/// batch.
#[tauri::command]
pub fn remove_duplicates(
    app: AppHandle,
    state: State<AppState>,
    choices: Vec<Choice>,
) -> Result<()> {
    let (root, table, removals) = {
        let conn = lock_db(&state)?;
        let removals = plan_removals(index::load_rows(&conn)?, &choices)?;
        (library_root(&conn)?, format_table(&conn)?, removals)
    };
    if removals.is_empty() {
        return Err(Error::msg("Choose at least one copy to remove"));
    }
    let copies = removals.len();
    let label = format!(
        "Moved {copies} duplicate {} to the Recycle Bin",
        if copies == 1 { "copy" } else { "copies" }
    );
    let handle = app.clone();
    jobs::start(&app, "remove", move |ctx| {
        let state = handle.state::<AppState>();
        let env = Env {
            db: &state.db,
            root: &root,
            table: &table,
            cancel: ctx.cancel_flag(),
            report: &|stage, done, total| ctx.report(stage, done, total),
        };
        let batch = NewBatch {
            kind: "duplicates",
            label: &label,
            on_begin: None,
        };
        executor::remove(&env, &batch, &removals)
    })
}

/// Hash every photo and video that shares its size with another and has no hash yet, in
/// parallel. Hashes found before a cancel are still saved. Returns how many files were hashed.
pub fn hash_pending(db: &Mutex<Connection>, cancel: &AtomicBool, report: Report) -> Result<usize> {
    report("Looking for files of the same size", 0, 0);
    let pending: Vec<(i64, PathBuf)> = {
        let conn = lock(db)?;
        let mut stmt = conn.prepare(
            "SELECT id, path FROM media
             WHERE kind != 'companion' AND size > 0 AND hash IS NULL AND size IN
                (SELECT size FROM media WHERE kind != 'companion' AND size > 0
                 GROUP BY size HAVING COUNT(*) > 1)",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok((r.get(0)?, PathBuf::from(r.get::<_, String>(1)?)))
        })?;
        rows.collect::<rusqlite::Result<_>>()?
    };
    let paths: Vec<PathBuf> = pending.iter().map(|(_, path)| path.clone()).collect();
    // A file gone or locked since the last refresh stays unchecked and is tried again. A cancel
    // still saves the hashes already read.
    let found = hash::many(&paths, "Comparing files", cancel, report);
    let hashes: Vec<(i64, String)> = pending
        .iter()
        .zip(found)
        .filter_map(|((id, _), hash)| Some((*id, hash?)))
        .collect();

    let mut conn = lock(db)?;
    let tx = conn.transaction()?;
    {
        let mut update = tx.prepare("UPDATE media SET hash = ?1 WHERE id = ?2")?;
        for (id, hash) in &hashes {
            update.execute(params![hash, id])?;
        }
    }
    tx.commit()?;
    if cancel.load(Ordering::Relaxed) {
        return Err(Error::msg("Cancelled"));
    }
    Ok(hashes.len())
}

/// Group hashed files into duplicate sets, newest first, and rank each set's copies so the
/// best one to keep comes first. Files no longer on disk are left out.
pub fn report(
    root: &Path,
    rows: Vec<MediaRow>,
    trips: &[Trip],
    exists: &dyn Fn(&Path) -> bool,
) -> DupReport {
    let unchecked = {
        let mut sizes: HashMap<u64, usize> = HashMap::new();
        for row in rows.iter().filter(|r| comparable(r)) {
            *sizes.entry(row.size).or_default() += 1;
        }
        rows.iter()
            .filter(|r| comparable(r) && r.hash.is_none() && sizes[&r.size] > 1)
            .count()
    };

    // Each file's group size, place and taken date, from the same grouping Sort uses.
    let rules = Rules { root, trips };
    let (groups, _) = groups::build(rows.clone());
    let mut info: HashMap<i64, (usize, bool, chrono::NaiveDateTime)> = HashMap::new();
    for group in &groups {
        let dir = rules.target_dir(group);
        for member in &group.members {
            let in_place = member.path.parent().is_some_and(|p| same_path(p, &dir));
            info.insert(member.id, (group.members.len(), in_place, group.taken_at));
        }
    }

    let mut by_hash: HashMap<(&str, u64), Vec<&MediaRow>> = HashMap::new();
    for row in &rows {
        if let Some(hash) = &row.hash
            && comparable(row)
            && exists(&row.path)
        {
            by_hash.entry((hash, row.size)).or_default().push(row);
        }
    }
    let mut sets: Vec<(chrono::NaiveDateTime, DupSet)> = by_hash
        .into_iter()
        .filter(|(_, copies)| copies.len() > 1)
        .map(|((hash, size), mut copies)| {
            let place = |row: &MediaRow| {
                info.get(&row.id)
                    .copied()
                    .unwrap_or((1, false, row.taken_at))
            };
            copies.sort_by_cached_key(|row| {
                let (members, in_place, _) = place(row);
                (
                    Reverse(members),
                    !in_place,
                    row.mtime,
                    looks_like_copy(&row.path),
                    row.path.as_os_str().len(),
                    path_key(&row.path),
                )
            });
            let taken = place(copies[0]).2;
            let set = DupSet {
                hash: hash.to_owned(),
                size,
                kind: copies[0].kind.as_str(),
                copies: copies
                    .iter()
                    .map(|row| {
                        let (members, in_place, _) = place(row);
                        DupCopy {
                            id: row.id,
                            version: row.mtime,
                            path: relative(root, &row.path),
                            in_place,
                            extra: members - 1,
                        }
                    })
                    .collect(),
            };
            (taken, set)
        })
        .collect();
    sets.sort_by(|(a_taken, a), (b_taken, b)| {
        b_taken.cmp(a_taken).then_with(|| a.hash.cmp(&b.hash))
    });
    let sets: Vec<DupSet> = sets.into_iter().map(|(_, set)| set).collect();
    DupReport {
        extra: sets.iter().map(|s| s.copies.len() - 1).sum(),
        bytes: sets
            .iter()
            .map(|s| s.size * (s.copies.len() as u64 - 1))
            .sum(),
        sets,
        unchecked,
    }
}

/// Turn the user's choices into removals, checked against the index: every copy to remove
/// must still be indexed, be a photo or video, differ from its keeper and share its hash and
/// size. When a removed copy leaves its group with no photo or video, the group's sidecars go
/// with the group's first file.
pub fn plan_removals(rows: Vec<MediaRow>, choices: &[Choice]) -> Result<Vec<Removal>> {
    let stale =
        || Error::msg("These duplicates have changed since the check. Check for duplicates again.");
    let by_id: HashMap<i64, &MediaRow> = rows.iter().map(|r| (r.id, r)).collect();
    let keepers: HashSet<i64> = choices.iter().map(|c| c.keep).collect();
    let mut removing: HashSet<i64> = HashSet::new();
    let mut picked: Vec<(&MediaRow, &MediaRow)> = Vec::new();
    for choice in choices {
        let keeper = *by_id.get(&choice.keep).ok_or_else(stale)?;
        let hash = keeper
            .hash
            .as_deref()
            .filter(|_| comparable(keeper))
            .ok_or_else(stale)?;
        for id in &choice.remove {
            let copy = *by_id.get(id).ok_or_else(stale)?;
            let same = copy.hash.as_deref() == Some(hash) && copy.size == keeper.size;
            if !same || !comparable(copy) || keepers.contains(id) || !removing.insert(*id) {
                return Err(stale());
            }
            picked.push((copy, keeper));
        }
    }

    // Sidecars follow the group's first file, so attach them to its removal when every photo
    // and video in the group is going.
    let (groups, _) = groups::build(rows.clone());
    let mut sidecars: HashMap<i64, Vec<BinFile>> = HashMap::new();
    for group in &groups {
        let (companions, media): (Vec<&MediaRow>, Vec<&MediaRow>) = group
            .members
            .iter()
            .partition(|m| m.kind == Kind::Companion);
        if !companions.is_empty() && media.iter().all(|m| removing.contains(&m.id)) {
            sidecars.insert(
                group.leader().id,
                companions
                    .iter()
                    .map(|c| BinFile {
                        media_id: c.id,
                        path: c.path.clone(),
                    })
                    .collect(),
            );
        }
    }

    Ok(picked
        .into_iter()
        .map(|(copy, keeper)| {
            let mut files = vec![BinFile {
                media_id: copy.id,
                path: copy.path.clone(),
            }];
            files.extend(sidecars.remove(&copy.id).unwrap_or_default());
            Removal {
                files,
                keeper: keeper.path.clone(),
                hash: keeper.hash.clone().unwrap_or_default(),
            }
        })
        .collect())
}

/// Photos and videos with some content. Sidecars are never compared, and empty files are all
/// "identical" without being photos at all.
fn comparable(row: &MediaRow) -> bool {
    row.kind != Kind::Companion && row.size > 0
}

/// True for names that look like a copy of another: "IMG_1 (2).jpg", "IMG_1 - Copy.jpg",
/// "Copy of IMG_1.jpg".
fn looks_like_copy(path: &Path) -> bool {
    let stem = path
        .file_stem()
        .map(|s| s.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    let numbered = stem
        .strip_suffix(')')
        .and_then(|s| s.rsplit_once(" ("))
        .is_some_and(|(_, n)| !n.is_empty() && n.bytes().all(|b| b.is_ascii_digit()));
    numbered || stem.contains("copy")
}

fn lock(db: &Mutex<Connection>) -> Result<std::sync::MutexGuard<'_, Connection>> {
    db.lock().map_err(|_| Error::msg("Database lock poisoned"))
}

#[cfg(test)]
mod tests {
    use std::time::{Duration, SystemTime};

    use super::*;
    use crate::executor::testing::{no_report, snapshot};
    use crate::formats::FormatTable;
    use crate::recycle::fake;

    /// Two contents of the same length, so only hashing can tell them apart.
    const PHOTO: &str = "the same photo bytes";
    const OTHER: &str = "a different photo!!!";

    /// Library in a temp folder with the given files and contents, all with the same modified
    /// time so the keeper order doesn't depend on how fast the test wrote them.
    fn library(files: &[(&str, &str)]) -> (tempfile::TempDir, Mutex<Connection>) {
        let dir = tempfile::tempdir().unwrap();
        let when = SystemTime::UNIX_EPOCH + Duration::from_secs(1_741_000_000);
        for (rel, text) in files {
            let path = dir.path().join(rel);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(&path, text).unwrap();
            fs::File::options()
                .write(true)
                .open(&path)
                .unwrap()
                .set_modified(when)
                .unwrap();
        }
        let db = Mutex::new(crate::db::open_in_memory().unwrap());
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

    fn check(db: &Mutex<Connection>, root: &Path) -> DupReport {
        hash_pending(db, &AtomicBool::new(false), &no_report).unwrap();
        listing(db, root)
    }

    fn listing(db: &Mutex<Connection>, root: &Path) -> DupReport {
        let rows = index::load_rows(&db.lock().unwrap()).unwrap();
        report(root, rows, &[], &|p| p.exists())
    }

    fn paths(set: &DupSet) -> Vec<&str> {
        set.copies.iter().map(|c| c.path.as_str()).collect()
    }

    /// Keep each set's suggested keeper and remove every other copy.
    fn keep_suggested(sets: &[&DupSet]) -> Vec<Choice> {
        sets.iter()
            .map(|s| Choice {
                keep: s.copies[0].id,
                remove: s.copies[1..].iter().map(|c| c.id).collect(),
            })
            .collect()
    }

    fn env<'a>(
        db: &'a Mutex<Connection>,
        root: &'a Path,
        table: &'a FormatTable,
        cancel: &'a AtomicBool,
    ) -> Env<'a> {
        Env {
            db,
            root,
            table,
            cancel,
            report: &no_report,
        }
    }

    fn run_removals(
        db: &Mutex<Connection>,
        root: &Path,
        removals: &[Removal],
    ) -> executor::ApplySummary {
        let (table, cancel) = (FormatTable::default(), AtomicBool::new(false));
        let batch = NewBatch {
            kind: "duplicates",
            label: "test",
            on_begin: None,
        };
        executor::remove(&env(db, root, &table, &cancel), &batch, removals).unwrap()
    }

    const PLANTED: &[(&str, &str)] = &[
        (r"2025\2025-03\IMG_20250312_101500.jpg", PHOTO),
        (r"2025\2025-03\IMG_20250312_101500.aae", "edits"),
        (r"in\IMG_20250312_101500.jpg", PHOTO),
        (r"in\IMG_20250312_101500.aae", "edits"),
        (r"in\IMG_20250312_101500 (1).jpg", PHOTO),
        (r"in\holiday.jpg", PHOTO),
        (r"in\IMG_20250313_090000.jpg", OTHER),
        (r"in\VID_20250312_120000.mp4", "video bytes"),
        (r"in\clip.mp4", "video bytes"),
        (r"in\IMG_20250314_090000.jpg", "a photo of its own size"),
        (r"in\empty-1.jpg", ""),
        (r"in\empty-2.jpg", ""),
    ];

    #[test]
    fn planted_copies_are_found_and_nothing_else_is_flagged() {
        let (dir, db) = library(PLANTED);
        let root = dir.path();
        // Four PHOTO copies, the same-size OTHER and two videos. Never sidecars or empty files.
        assert_eq!(listing(&db, root).unchecked, 7);
        assert_eq!(
            hash_pending(&db, &AtomicBool::new(false), &no_report).unwrap(),
            7
        );

        let found = listing(&db, root);
        assert_eq!(found.unchecked, 0);
        assert_eq!(found.sets.len(), 2);
        // The copy already in its month folder, with its sidecar, is the one to keep. Then the
        // other copy with a sidecar, then plain names before numbered ones.
        let photos = found.sets.iter().find(|s| s.kind == "photo").unwrap();
        assert_eq!(
            paths(photos),
            [
                r"2025\2025-03\IMG_20250312_101500.jpg",
                r"in\IMG_20250312_101500.jpg",
                r"in\holiday.jpg",
                r"in\IMG_20250312_101500 (1).jpg",
            ]
        );
        assert!(photos.copies[0].in_place && !photos.copies[1].in_place);
        assert_eq!((photos.copies[0].extra, photos.copies[2].extra), (1, 0));
        let videos = found.sets.iter().find(|s| s.kind == "video").unwrap();
        assert_eq!(
            paths(videos),
            [r"in\clip.mp4", r"in\VID_20250312_120000.mp4"]
        );
        assert_eq!((found.extra, found.bytes), (4, 3 * 20 + 11));

        // Checking again reads nothing new.
        assert_eq!(
            hash_pending(&db, &AtomicBool::new(false), &no_report).unwrap(),
            0
        );
    }

    #[test]
    fn removed_copies_go_to_the_bin_with_their_sidecars_and_undo_brings_all_back() {
        let (dir, db) = library(PLANTED);
        let root = dir.path();
        let before = snapshot(root);
        let found = check(&db, root);
        let rows_before = index::load_rows(&db.lock().unwrap()).unwrap();
        let photos: Vec<&DupSet> = found.sets.iter().filter(|s| s.kind == "photo").collect();
        let removals = plan_removals(rows_before.clone(), &keep_suggested(&photos)).unwrap();
        // The in\ copy was the only photo in its group, so its sidecar goes with it.
        let sizes: Vec<usize> = removals.iter().map(|r| r.files.len()).collect();
        assert_eq!(sizes, [2, 1, 1]);

        let summary = run_removals(&db, root, &removals);
        assert_eq!((summary.moved, summary.failed), (4, 0));
        for gone in [
            r"in\IMG_20250312_101500.jpg",
            r"in\IMG_20250312_101500.aae",
            r"in\holiday.jpg",
            r"in\IMG_20250312_101500 (1).jpg",
        ] {
            let path = root.join(gone);
            assert!(
                !path.exists() && fake::holds(&path),
                "{gone} should be in the bin"
            );
        }
        assert!(root.join(r"2025\2025-03\IMG_20250312_101500.aae").exists());
        let after = listing(&db, root);
        assert_eq!(after.sets.len(), 1);
        assert_eq!(after.sets[0].kind, "video");

        let (table, cancel) = (FormatTable::default(), AtomicBool::new(false));
        let undone =
            crate::history::undo(&env(&db, root, &table, &cancel), summary.batch_id).unwrap();
        assert_eq!((undone.restored, undone.failed), (4, 0));
        assert_eq!(snapshot(root), before);
        // The same rows under the same ids, hashes included, so nothing needs checking again.
        let mut rows_after = index::load_rows(&db.lock().unwrap()).unwrap();
        let mut rows_before = rows_before;
        rows_after.sort_by_key(|r| r.id);
        rows_before.sort_by_key(|r| r.id);
        assert_eq!(rows_after, rows_before);
        let again = listing(&db, root);
        assert_eq!((again.sets.len(), again.unchecked), (2, 0));
    }

    #[test]
    fn a_copy_or_keeper_that_changed_since_the_check_is_kept() {
        let (dir, db) = library(&[
            (r"2025\2025-03\IMG_20250312_101500.jpg", PHOTO),
            (r"in\b.jpg", PHOTO),
            (r"in\c.jpg", PHOTO),
            (r"2025\2025-03\VID_20250312_120000.mp4", "video bytes"),
            (r"in\clip.mp4", "video bytes"),
        ]);
        let root = dir.path();
        let found = check(&db, root);
        let sets: Vec<&DupSet> = found.sets.iter().collect();
        let rows = index::load_rows(&db.lock().unwrap()).unwrap();
        let removals = plan_removals(rows, &keep_suggested(&sets)).unwrap();
        // Same size, different bytes: only a fresh hash notices.
        fs::write(root.join(r"in\b.jpg"), OTHER).unwrap();
        fs::write(
            root.join(r"2025\2025-03\VID_20250312_120000.mp4"),
            "edited clip",
        )
        .unwrap();

        let summary = run_removals(&db, root, &removals);
        assert_eq!((summary.moved, summary.failed), (1, 2));
        assert!(root.join(r"in\b.jpg").exists() && root.join(r"in\clip.mp4").exists());
        assert!(!root.join(r"in\c.jpg").exists());
        let status: String = db
            .lock()
            .unwrap()
            .query_row(
                "SELECT status FROM batches WHERE id = ?1",
                [summary.batch_id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(status, "partial");
    }

    #[test]
    fn choices_that_no_longer_match_the_index_are_refused() {
        let (dir, db) = library(&[
            (r"in\a.jpg", PHOTO),
            (r"in\b.jpg", PHOTO),
            (r"in\c.jpg", OTHER),
            (r"in\a.aae", "edits"),
        ]);
        let found = check(&db, dir.path());
        assert_eq!(found.sets.len(), 1);
        let rows = index::load_rows(&db.lock().unwrap()).unwrap();
        let id = |name: &str| rows.iter().find(|r| r.path.ends_with(name)).unwrap().id;
        let refused = |keep: i64, remove: Vec<i64>| {
            plan_removals(rows.clone(), &[Choice { keep, remove }]).is_err()
        };
        assert!(!refused(id("a.jpg"), vec![id("b.jpg")]));
        assert!(
            refused(id("a.jpg"), vec![id("c.jpg")]),
            "different contents"
        );
        assert!(refused(id("a.jpg"), vec![id("a.jpg")]), "the keeper itself");
        assert!(refused(id("a.jpg"), vec![id("a.aae")]), "a sidecar");
        assert!(refused(id("a.jpg"), vec![999]), "not indexed");
    }

    #[test]
    fn copy_like_names_are_recognised() {
        for name in [
            "IMG_1 (2).jpg",
            "IMG_1 - Copy.jpg",
            "Copy of IMG_1.jpg",
            "img (12).HEIC",
        ] {
            assert!(looks_like_copy(Path::new(name)), "{name}");
        }
        for name in [
            "IMG_1.jpg",
            "Trip (Japan).jpg",
            "IMG_1 ().jpg",
            "holiday.jpg",
        ] {
            assert!(!looks_like_copy(Path::new(name)), "{name}");
        }
    }
}
