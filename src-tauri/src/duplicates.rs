// Find photos and videos that are the same and send the extra copies to the Recycle Bin.
// Two kinds of sets are found:
// - exact copies, identical byte for byte. Only files that share their size with another are
//   ever hashed, so checking a big library reads few files.
// - the same picture or video with different details (location, date, camera) stored around
//   it, such as a re-exported Live Photo clip. ExifTool fingerprints the picture or video data
//   alone, and only for files that share their kind and date, size or name with another file
//   whose bytes differ (see `picture_candidates`).
// Sidecars (.aae, .xmp) are never compared; one goes to the bin only with the last photo or
// video it belonged to.

use std::cmp::Reverse;
use std::collections::hash_map::Entry;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::rc::Rc;
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::thread;

use chrono::NaiveDateTime;
use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};

use crate::AppState;
use crate::commands::{format_table, library_root, lock_db};
use crate::error::{Error, Result};
use crate::executor::{self, BinFile, Env, Keeper, NewBatch, Removal, Same};
use crate::exiftool::{self, ExifTool, Picture};
use crate::formats::Kind;
use crate::groups::{self, MediaRow};
use crate::hash;
use crate::index::{self, Report, path_key};
use crate::jobs;
use crate::organise::relative;
use crate::planner::{Rules, same_path};
use crate::naming::Naming;
use crate::trips;

/// Files read per ExifTool request: enough to spare most of each request's overhead, few
/// enough that a cancel is noticed within a few seconds.
const PICTURES_PER_REQUEST: usize = 16;

/// ExifTool processes fingerprinting side by side. Reading is mostly disk-bound, so more
/// processes only add memory.
const PICTURE_READERS: usize = 4;

/// Saved fingerprints by media id. A file ExifTool couldn't fingerprint has a `None`
/// fingerprint, so it isn't read again until it changes.
pub type Pictures = HashMap<i64, Picture>;

/// Photos and videos that are the same: identical byte for byte, or the same picture or video
/// with different details.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DupSet {
    /// Names the set: the files' hash, or `picture:` and the fingerprint they share.
    pub hash: String,
    /// Size of the suggested keeper; every copy's size when the copies are identical.
    pub size: u64,
    /// `photo`, `raw` or `video`.
    pub kind: &'static str,
    /// The copies share their picture or video but not the details stored with it, so their
    /// sizes differ and the copy with the most details is suggested.
    pub details_differ: bool,
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
    pub size: u64,
    /// Already in the trip or month folder it belongs in.
    pub in_place: bool,
    /// Other files that travel with this copy (a Live Photo video, a sidecar).
    pub extra: usize,
    /// Id of the tile this copy belongs to (its group's first file). A copied Live Photo or
    /// RAW+JPEG pair makes one set per kind, and its copies share these ids across the sets.
    pub group: i64,
    /// Details this copy holds, of `location`, `date` and `camera`. Only listed when the
    /// set's details differ; identical copies hold the same ones.
    pub details: Vec<&'static str>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DupReport {
    pub sets: Vec<DupSet>,
    /// Files that might be a copy of another but haven't been compared yet.
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

/// Compare same-size files, then fingerprint files that might be the same picture with
/// different details, in the background. The page reloads the sets when it finishes.
#[tauri::command]
pub fn find_duplicates(app: AppHandle) -> Result<()> {
    let exiftool = locate_exiftool(&app);
    let handle = app.clone();
    jobs::start(&app, "duplicates", move |ctx| {
        let state = handle.state::<AppState>();
        let report = &|stage: &str, done, total| ctx.report(stage, done, total);
        let hashed = hash_pending(&state.db, ctx.cancel_flag(), report)?;
        let fingerprinted = match &exiftool {
            Some(exe) => fingerprint_pending(&state.db, exe, ctx.cancel_flag(), report)?,
            None => 0,
        };
        Ok(hashed + fingerprinted)
    })
}

/// Every duplicate set found so far, with a suggested keeper for each.
#[tauri::command(async)]
pub fn list_duplicates(app: AppHandle, state: State<'_, AppState>) -> Result<DupReport> {
    let (root, rows, pictures, trips, naming) = {
        let conn = lock_db(&state)?;
        (
            library_root(&conn)?,
            index::load_rows(&conn)?,
            load_pictures(&conn)?,
            trips::load(&conn)?,
            Naming::load(&conn)?,
        )
    };
    let rules = Rules {
        root: &root,
        trips: &trips,
        naming,
    };
    // Without ExifTool, copies with different details can be neither found nor checked again
    // before they go, so only exact copies are listed.
    let pictures = locate_exiftool(&app).map(|_| &pictures);
    Ok(report(&rules, rows, pictures, &|p| {
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
    let exiftool = locate_exiftool(&app);
    let (root, table, removals) = {
        let conn = lock_db(&state)?;
        let removals = plan_removals(
            index::load_rows(&conn)?,
            &load_pictures(&conn)?,
            &choices,
            exiftool.as_deref(),
        )?;
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
        remember_removed(&state.db, &removals, ctx.cancel_flag(), &|stage, done, total| {
            ctx.report(stage, done, total)
        })?;
        executor::remove(&env, &batch, &removals)
    })
}

/// Note the hash and size of each copy about to go, for Import to leave out (see
/// `removed_copies` in db.rs). Copies with no hash yet are read now, while they're still there.
fn remember_removed(db: &Mutex<Connection>, removals: &[Removal], cancel: &AtomicBool, report: Report) -> Result<()> {
    let ids: Vec<i64> = removals
        .iter()
        .filter(|r| r.keeper.is_some())
        .filter_map(|r| r.files.first().map(|f| f.media_id))
        .collect();
    let rows: Vec<(PathBuf, i64, Option<String>)> = {
        let conn = lock(db)?;
        let mut stmt = conn.prepare("SELECT path, size, hash FROM media WHERE id = ?1")?;
        ids.iter()
            .filter_map(|id| {
                stmt.query_row([id], |r| Ok((PathBuf::from(r.get::<_, String>(0)?), r.get(1)?, r.get(2)?)))
                    .ok()
            })
            .collect()
    };
    let unhashed: Vec<PathBuf> = rows
        .iter()
        .filter(|(_, _, hash)| hash.is_none())
        .map(|(path, _, _)| path.clone())
        .collect();
    let mut fresh = hash::many(&unhashed, "Noting the copies going", cancel, report).into_iter();
    let found: Vec<(String, i64)> = rows
        .into_iter()
        .filter_map(|(_, size, hash)| Some((hash.or_else(|| fresh.next().flatten())?, size)))
        .collect();
    if cancel.load(Ordering::Relaxed) {
        return Err(Error::msg("Cancelled"));
    }
    let mut conn = lock(db)?;
    let tx = conn.transaction()?;
    {
        let mut insert = tx.prepare("INSERT OR IGNORE INTO removed_copies (hash, size) VALUES (?1, ?2)")?;
        for (hash, size) in &found {
            insert.execute(params![hash, size])?;
        }
    }
    tx.commit()?;
    Ok(())
}

fn locate_exiftool(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .resource_dir()
        .ok()
        .and_then(|dir| exiftool::locate(&dir))
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

/// Fingerprint the picture or video data of every file [`pending_pictures`] lists, with
/// ExifTool. Byte-identical files are read once and the result saved for each of them. A
/// result is saved only while the file's indexed size and modified time are still those it was
/// read at, so a refresh in the meantime isn't overwritten. Fingerprints found before a cancel
/// are still saved. Returns how many files got a fingerprint (or found they can't have one).
pub fn fingerprint_pending(
    db: &Mutex<Connection>,
    exiftool: &Path,
    cancel: &AtomicBool,
    report: Report,
) -> Result<usize> {
    report("Looking for copies with different details", 0, 0);
    let (rows, pictures) = {
        let conn = lock(db)?;
        (index::load_rows(&conn)?, load_pictures(&conn)?)
    };
    let mut reads: Vec<(PathBuf, Vec<&MediaRow>)> = Vec::new();
    let mut by_bytes: HashMap<(&str, u64), usize> = HashMap::new();
    for row in pending_pictures(&rows, &pictures) {
        let Some(hash) = row.hash.as_deref() else {
            reads.push((row.path.clone(), vec![row]));
            continue;
        };
        match by_bytes.entry((hash, row.size)) {
            Entry::Occupied(at) => reads[*at.get()].1.push(row),
            Entry::Vacant(at) => {
                at.insert(reads.len());
                reads.push((row.path.clone(), vec![row]));
            }
        }
    }
    let paths: Vec<PathBuf> = reads.iter().map(|(path, _)| path.clone()).collect();
    let found = read_pictures(exiftool, &paths, cancel, report);

    let mut saved = 0;
    let mut conn = lock(db)?;
    let tx = conn.transaction()?;
    {
        let mut update = tx.prepare(
            "UPDATE media SET fingerprint = ?1, camera = ?2
             WHERE id = ?3 AND size = ?4 AND mtime = ?5",
        )?;
        for ((_, same_bytes), picture) in reads.iter().zip(found) {
            let Some(picture) = picture else { continue };
            for row in same_bytes {
                saved += update.execute(params![
                    picture.fingerprint.as_deref().unwrap_or(""),
                    picture.camera,
                    row.id,
                    row.size as i64,
                    row.mtime,
                ])?;
            }
        }
    }
    tx.commit()?;
    if cancel.load(Ordering::Relaxed) {
        return Err(Error::msg("Cancelled"));
    }
    Ok(saved)
}

/// Fingerprint `paths` with a few ExifTool processes side by side, a batch of files per
/// request. A file that wasn't read (gone, locked, ExifTool failing, or left when `cancel` is
/// set) gets None, so it is tried again at the next check.
fn read_pictures(
    exiftool: &Path,
    paths: &[PathBuf],
    cancel: &AtomicBool,
    report: Report,
) -> Vec<Option<Picture>> {
    const STAGE: &str = "Comparing pictures and videos";
    let total = paths.len();
    report(STAGE, 0, total);
    let batches: Vec<&[PathBuf]> = paths.chunks(PICTURES_PER_REQUEST).collect();
    let (next, done) = (AtomicUsize::new(0), AtomicUsize::new(0));
    // Each reader takes the next unread batch until none are left, so a slow batch of long
    // videos holds up only its own reader.
    let read: Vec<(usize, Option<Picture>)> = thread::scope(|scope| {
        let readers: Vec<_> = (0..PICTURE_READERS.min(batches.len()))
            .map(|_| {
                scope.spawn(|| {
                    let mut session: Option<ExifTool> = None;
                    let mut found = Vec::new();
                    while !cancel.load(Ordering::Relaxed) {
                        let at = next.fetch_add(1, Ordering::Relaxed);
                        let Some(batch) = batches.get(at) else { break };
                        let pictures = read_batch(&mut session, exiftool, batch);
                        let start = at * PICTURES_PER_REQUEST;
                        found.extend(pictures.into_iter().enumerate().map(|(i, p)| (start + i, p)));
                        let n = done.fetch_add(batch.len(), Ordering::Relaxed) + batch.len();
                        report(STAGE, n, total);
                    }
                    found
                })
            })
            .collect();
        readers
            .into_iter()
            .flat_map(|reader| reader.join().unwrap_or_default())
            .collect()
    });
    let mut pictures = vec![None; total];
    for (i, picture) in read {
        pictures[i] = picture;
    }
    pictures
}

/// Fingerprint one batch. When the request fails (ExifTool died, perhaps on one bad file),
/// each file is read on its own with a fresh process, so a bad file costs only itself.
fn read_batch(
    session: &mut Option<ExifTool>,
    exiftool: &Path,
    batch: &[PathBuf],
) -> Vec<Option<Picture>> {
    if let Some(found) = exiftool::pictures_with(session, exiftool, batch) {
        return found;
    }
    batch
        .iter()
        .map(|path| {
            exiftool::pictures_with(session, exiftool, std::slice::from_ref(path))
                .and_then(|found| found.into_iter().next().flatten())
        })
        .collect()
}

/// Every saved fingerprint, by media id.
pub fn load_pictures(conn: &Connection) -> Result<Pictures> {
    let mut stmt = conn.prepare(
        "SELECT id, fingerprint, COALESCE(camera, 0) FROM media WHERE fingerprint IS NOT NULL",
    )?;
    let rows = stmt.query_map([], |r| {
        let fingerprint: String = r.get(1)?;
        Ok((
            r.get(0)?,
            Picture {
                fingerprint: Some(fingerprint).filter(|f| !f.is_empty()),
                camera: r.get(2)?,
            },
        ))
    })?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// Group hashed and fingerprinted files into duplicate sets, newest first, and rank each set's
/// copies so the best one to keep comes first. Files no longer on disk are left out.
/// `pictures` is None when copies with different details can't be looked for (no ExifTool).
///
/// A file is in at most one set. When the same picture has both identical and differing
/// copies, they all make one set with different details, rather than an exact set plus a
/// second set holding one of the same files.
pub fn report(
    rules: &Rules,
    rows: Vec<MediaRow>,
    pictures: Option<&Pictures>,
    exists: &dyn Fn(&Path) -> bool,
) -> DupReport {
    let root = rules.root;
    let no_pictures = Pictures::new();
    let unchecked = {
        let mut sizes: HashMap<u64, usize> = HashMap::new();
        for row in rows.iter().filter(|r| comparable(r)) {
            *sizes.entry(row.size).or_default() += 1;
        }
        let mut ids: HashSet<i64> = rows
            .iter()
            .filter(|r| comparable(r) && r.hash.is_none() && sizes[&r.size] > 1)
            .map(|r| r.id)
            .collect();
        if let Some(pictures) = pictures {
            ids.extend(pending_pictures(&rows, pictures).iter().map(|r| r.id));
        }
        ids.len()
    };
    let prints = shared_pictures(&rows, pictures.unwrap_or(&no_pictures));

    // Each file's tile, from the same grouping Sort uses. Members of one group share a folder,
    // so the tile's place holds for all of them.
    let (groups, _) = groups::build(rows.clone());
    let mut info: HashMap<i64, Rc<Tile>> = HashMap::new();
    for group in &groups {
        let dir = rules.target_dir(group);
        let leader = group.leader();
        let in_place = leader.path.parent().is_some_and(|p| same_path(p, &dir));
        let tile = Rc::new(Tile::new(leader, group.members.len(), in_place, group.taken_at));
        for member in &group.members {
            info.insert(member.id, Rc::clone(&tile));
        }
    }
    let place = |row: &MediaRow| {
        info.get(&row.id)
            .cloned()
            .unwrap_or_else(|| Rc::new(Tile::new(row, 1, false, row.taken_at)))
    };

    let present: Vec<&MediaRow> = rows
        .iter()
        .filter(|r| comparable(r) && exists(&r.path))
        .collect();
    // Same picture first: a fingerprint shared by files whose bytes differ.
    let mut by_picture: HashMap<(Kind, &str), Vec<&MediaRow>> = HashMap::new();
    for &row in &present {
        if let Some(&(fingerprint, _)) = prints.get(&row.id) {
            by_picture.entry((row.kind, fingerprint)).or_default().push(row);
        }
    }
    by_picture.retain(|_, copies| distinct_contents(copies) > 1);
    let in_picture_sets: HashSet<i64> = by_picture.values().flatten().map(|r| r.id).collect();
    let mut by_hash: HashMap<(&str, u64), Vec<&MediaRow>> = HashMap::new();
    for &row in &present {
        if let Some(hash) = &row.hash
            && !in_picture_sets.contains(&row.id)
        {
            by_hash.entry((hash, row.size)).or_default().push(row);
        }
    }

    let details = |row: &MediaRow| details_of(row, prints.get(&row.id).is_some_and(|p| p.1));
    let picture_sets = by_picture.into_iter().map(|((_, fingerprint), mut copies)| {
        copies.sort_by_cached_key(|row| (Reverse(details(row).len()), place(row).rank.clone()));
        (format!("picture:{fingerprint}"), true, copies)
    });
    let exact_sets = by_hash
        .into_iter()
        .filter(|(_, copies)| copies.len() > 1)
        .map(|((hash, _), mut copies)| {
            copies.sort_by_cached_key(|row| place(row).rank.clone());
            (hash.to_owned(), false, copies)
        });
    let mut sets: Vec<(NaiveDateTime, DupSet)> = picture_sets
        .chain(exact_sets)
        .map(|(hash, details_differ, copies)| {
            let taken = place(copies[0]).taken_at;
            let set = DupSet {
                hash,
                size: copies[0].size,
                kind: copies[0].kind.as_str(),
                details_differ,
                copies: copies
                    .iter()
                    .map(|row| {
                        let tile = place(row);
                        DupCopy {
                            id: row.id,
                            version: row.mtime,
                            path: relative(root, &row.path),
                            size: row.size,
                            in_place: tile.in_place,
                            extra: tile.members - 1,
                            group: tile.leader,
                            details: if details_differ { details(row) } else { Vec::new() },
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
            .flat_map(|s| &s.copies[1..])
            .map(|c| c.size)
            .sum(),
        sets,
        unchecked,
    }
}

/// The tile a copy belongs to. Copies are ranked by their tile rather than on their own, so
/// the photo set and the video set of a copied Live Photo suggest keeping the same pair.
struct Tile {
    leader: i64,
    members: usize,
    in_place: bool,
    taken_at: NaiveDateTime,
    /// Best tile to keep sorts first: more files with it, already in its folder, the older
    /// first file, a plain name before "IMG_1 (2)", then the shorter path.
    rank: (Reverse<usize>, bool, i64, bool, usize, String),
}

impl Tile {
    fn new(leader: &MediaRow, members: usize, in_place: bool, taken_at: NaiveDateTime) -> Self {
        let rank = (
            Reverse(members),
            !in_place,
            leader.mtime,
            looks_like_copy(&leader.path),
            leader.path.as_os_str().len(),
            path_key(&leader.path),
        );
        Tile {
            leader: leader.id,
            members,
            in_place,
            taken_at,
            rank,
        }
    }
}

/// The details a copy holds that the others might have lost, for suggesting which copy of the
/// same picture to keep: where it was taken, when (read from the file, or set by the user) and
/// the camera that took it.
fn details_of(row: &MediaRow, camera: bool) -> Vec<&'static str> {
    [
        (row.lat.is_some() && row.lon.is_some(), "location"),
        (row.date_source.is_embedded(), "date"),
        (camera, "camera"),
    ]
    .into_iter()
    .filter_map(|(has, name)| has.then_some(name))
    .collect()
}

/// Turn the user's choices into removals, checked against the index: every copy to remove
/// must still be indexed, be a photo or video, differ from its keeper and either share its
/// hash and size or, for a copy with different details, its kind and fingerprint. A copy with
/// different details is fingerprinted again before it goes, which needs `exiftool`. When a
/// removed copy leaves its group with no photo or video, the group's sidecars go with the
/// group's first file.
pub fn plan_removals(
    rows: Vec<MediaRow>,
    pictures: &Pictures,
    choices: &[Choice],
    exiftool: Option<&Path>,
) -> Result<Vec<Removal>> {
    let stale =
        || Error::msg("These duplicates have changed since the check. Check for duplicates again.");
    let by_id: HashMap<i64, &MediaRow> = rows.iter().map(|r| (r.id, r)).collect();
    let prints = shared_pictures(&rows, pictures);
    let print = |row: &MediaRow| prints.get(&row.id).map(|p| p.0);
    let keepers: HashSet<i64> = choices.iter().map(|c| c.keep).collect();
    let mut removing: HashSet<i64> = HashSet::new();
    let mut picked: Vec<(&MediaRow, Keeper)> = Vec::new();
    for choice in choices {
        let keeper = *by_id
            .get(&choice.keep)
            .filter(|k| comparable(k))
            .ok_or_else(stale)?;
        for id in &choice.remove {
            let copy = *by_id.get(id).ok_or_else(stale)?;
            if !comparable(copy) || keepers.contains(id) || !removing.insert(*id) {
                return Err(stale());
            }
            let identical = keeper.hash.is_some() && copy.hash == keeper.hash && copy.size == keeper.size;
            let same = if identical {
                Same::Bytes(keeper.hash.clone().unwrap_or_default())
            } else {
                let fingerprint = print(keeper)
                    .filter(|&f| copy.kind == keeper.kind && print(copy) == Some(f))
                    .ok_or_else(stale)?;
                let exiftool = exiftool
                    .ok_or_else(|| Error::msg("ExifTool is missing from the install folder"))?;
                Same::Picture {
                    fingerprint: fingerprint.to_owned(),
                    exiftool: exiftool.to_path_buf(),
                }
            };
            picked.push((
                copy,
                Keeper {
                    path: keeper.path.clone(),
                    same,
                },
            ));
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
                keeper: Some(keeper),
            }
        })
        .collect())
}

/// Files that might be the same picture or video as another file with different details, so
/// are worth fingerprinting: those that share their kind and their date taken, size or plain
/// name with another file whose bytes differ (or haven't been read).
///
/// The index holds no pixel sizes or durations, so these are the cheap signs it has. A copy
/// with new details usually keeps the date (a re-exported clip), the size (details edited in
/// place) or the name (an export or "IMG_1 (2)"). A copy that lost its date, its name and its
/// size all at once isn't looked at, so a big library is never read in full. Byte-identical
/// files alone don't count: they are exact copies already.
fn picture_candidates(rows: &[MediaRow]) -> HashSet<i64> {
    #[derive(PartialEq, Eq, Hash)]
    enum Sign {
        Taken(NaiveDateTime),
        Size(u64),
        Name(String),
    }
    let mut alike: HashMap<(Kind, Sign), Vec<&MediaRow>> = HashMap::new();
    for row in rows.iter().filter(|r| comparable(r)) {
        for sign in [
            Sign::Taken(row.taken_at),
            Sign::Size(row.size),
            Sign::Name(plain_name(&row.path)),
        ] {
            alike.entry((row.kind, sign)).or_default().push(row);
        }
    }
    alike
        .into_values()
        .filter(|rows| distinct_contents(rows) > 1)
        .flatten()
        .map(|r| r.id)
        .collect()
}

/// Candidates from [`picture_candidates`] with no fingerprint saved, of their own or through a
/// byte-identical copy.
fn pending_pictures<'a>(rows: &'a [MediaRow], pictures: &Pictures) -> Vec<&'a MediaRow> {
    let candidates = picture_candidates(rows);
    let shared = shared_pictures(rows, pictures);
    rows.iter()
        .filter(|r| {
            candidates.contains(&r.id) && !pictures.contains_key(&r.id) && !shared.contains_key(&r.id)
        })
        .collect()
}

/// Each file's fingerprint and whether it names its camera, where it has one. A byte-identical
/// copy shares what its twin has, since only one file of such a set may have been read.
fn shared_pictures<'a>(rows: &[MediaRow], pictures: &'a Pictures) -> HashMap<i64, (&'a str, bool)> {
    let own = |row: &MediaRow| {
        let picture = pictures.get(&row.id)?;
        Some((picture.fingerprint.as_deref()?, picture.camera))
    };
    let mut by_bytes: HashMap<(&str, u64), (&str, bool)> = HashMap::new();
    for row in rows {
        if let (Some(hash), Some(found)) = (&row.hash, own(row)) {
            by_bytes.entry((hash, row.size)).or_insert(found);
        }
    }
    rows.iter()
        .filter_map(|row| {
            let found = own(row)
                .or_else(|| by_bytes.get(&(row.hash.as_deref()?, row.size)).copied())?;
            Some((row.id, found))
        })
        .collect()
}

/// How many different contents `rows` hold: byte-identical files count once, and a file not
/// hashed yet counts as different from all the others.
fn distinct_contents(rows: &[&MediaRow]) -> usize {
    rows.iter()
        .map(|r| match &r.hash {
            Some(hash) => (Some(hash.as_str()), r.size, 0),
            None => (None, r.size, r.id),
        })
        .collect::<HashSet<_>>()
        .len()
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

/// A file's name, lowercased, without its extension or the marks a copy gets: "IMG_1 (2).jpg",
/// "IMG_1 - Copy.jpg" and "Copy of IMG_1.jpg" are all "img_1".
fn plain_name(path: &Path) -> String {
    let stem = path
        .file_stem()
        .map(|s| s.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    let stem = stem.strip_prefix("copy of ").unwrap_or(&stem);
    let stem = stem.strip_suffix(" - copy").unwrap_or(stem);
    let stem = stem
        .strip_suffix(')')
        .and_then(|s| s.rsplit_once(" ("))
        .filter(|(_, n)| !n.is_empty() && n.bytes().all(|b| b.is_ascii_digit()))
        .map_or(stem, |(base, _)| base);
    stem.trim().to_owned()
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
        let dated: Vec<_> = files.iter().map(|&(rel, text)| (rel, text, 0)).collect();
        library_dated(&dated)
    }

    /// Like `library`, with each file modified the given number of seconds after a fixed time.
    fn library_dated(files: &[(&str, &str, u64)]) -> (tempfile::TempDir, Mutex<Connection>) {
        let dir = tempfile::tempdir().unwrap();
        for &(rel, text, later) in files {
            let when = SystemTime::UNIX_EPOCH + Duration::from_secs(1_741_000_000 + later);
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
        refresh(&db, dir.path());
        (dir, db)
    }

    /// Bring the index in line with the files under `root`, as a library refresh does.
    fn refresh(db: &Mutex<Connection>, root: &Path) {
        let cancel = AtomicBool::new(false);
        index::run(db, root, &FormatTable::default(), None, &cancel, &no_report).unwrap();
    }

    fn check(db: &Mutex<Connection>, root: &Path) -> DupReport {
        hash_pending(db, &AtomicBool::new(false), &no_report).unwrap();
        listing(db, root)
    }

    fn listing(db: &Mutex<Connection>, root: &Path) -> DupReport {
        let rows = index::load_rows(&db.lock().unwrap()).unwrap();
        let rules = Rules {
            root,
            trips: &[],
            naming: Naming::default(),
        };
        report(&rules, rows, None, &|p| p.exists())
    }

    /// The listing with copies whose details differ looked for, as when ExifTool is there.
    fn listing_pictures(db: &Mutex<Connection>, root: &Path) -> DupReport {
        let (rows, pictures) = {
            let conn = db.lock().unwrap();
            (index::load_rows(&conn).unwrap(), load_pictures(&conn).unwrap())
        };
        let rules = Rules {
            root,
            trips: &[],
            naming: Naming::default(),
        };
        report(&rules, rows, Some(&pictures), &|p| p.exists())
    }

    fn id_of(db: &Mutex<Connection>, rel: &str) -> i64 {
        let rows = index::load_rows(&db.lock().unwrap()).unwrap();
        rows.iter().find(|r| r.path.ends_with(rel)).unwrap().id
    }

    /// Save what a check would: the file's fingerprint and whether it names its camera.
    fn save_picture(db: &Mutex<Connection>, rel: &str, fingerprint: &str, camera: bool) {
        let id = id_of(db, rel);
        db.lock()
            .unwrap()
            .execute(
                "UPDATE media SET fingerprint = ?1, camera = ?2 WHERE id = ?3",
                params![fingerprint, camera, id],
            )
            .unwrap();
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
        let removals = plan_removals(rows_before.clone(), &Pictures::new(), &keep_suggested(&photos), None).unwrap();
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
        let removals = plan_removals(rows, &Pictures::new(), &keep_suggested(&sets), None).unwrap();
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
            plan_removals(rows.clone(), &Pictures::new(), &[Choice { keep, remove }], None).is_err()
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
    fn both_halves_of_a_copied_live_photo_keep_the_same_pair() {
        // The photo copies and the video copies have opposite modified-time orders, so ranking
        // each file on its own would keep a's photo and b's clip, and bin half of each pair.
        let (dir, db) = library_dated(&[
            (r"a\IMG_1.HEIC", PHOTO, 0),
            (r"a\IMG_1.MOV", "video bytes", 60),
            (r"b\IMG_1.HEIC", PHOTO, 30),
            (r"b\IMG_1.MOV", "video bytes", 10),
        ]);
        let root = dir.path();
        let found = check(&db, root);
        assert_eq!(found.sets.len(), 2);
        let folder = |path: &str| path.split('\\').next().unwrap().to_owned();
        let kept: Vec<String> = found.sets.iter().map(|s| folder(&s.copies[0].path)).collect();
        assert_eq!(kept, ["a", "a"]);
        // Each copy names its tile, so the page can tell which copies are one pair.
        for set in &found.sets {
            assert_ne!(set.copies[0].group, set.copies[1].group);
        }
        let photo = found.sets.iter().find(|s| s.kind == "photo").unwrap();
        let video = found.sets.iter().find(|s| s.kind == "video").unwrap();
        assert_eq!(photo.copies[0].group, video.copies[0].group);

        let sets: Vec<&DupSet> = found.sets.iter().collect();
        let rows = index::load_rows(&db.lock().unwrap()).unwrap();
        let removals = plan_removals(rows, &Pictures::new(), &keep_suggested(&sets), None).unwrap();
        let summary = run_removals(&db, root, &removals);
        assert_eq!((summary.moved, summary.failed), (2, 0));
        assert!(root.join(r"a\IMG_1.HEIC").exists() && root.join(r"a\IMG_1.MOV").exists());
        assert!(!root.join(r"b\IMG_1.HEIC").exists() && !root.join(r"b\IMG_1.MOV").exists());
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

    /// Contents of different lengths, so only fingerprints can tie them together. b and c are
    /// identical; the video has the same fingerprint as the photos but is a different kind.
    const PICTURE: &[(&str, &str)] = &[
        (r"in\a.jpg", "the picture, a's details"),
        (r"in\b.jpg", "the picture, b's longer details"),
        (r"in\c.jpg", "the picture, b's longer details"),
        (r"in\d.jpg", "another picture"),
        (r"in\v.mp4", "a video, somehow"),
    ];

    /// [`PICTURE`] checked and fingerprinted: a has a location, b a date and camera, and c
    /// shares b's fingerprint without one saved of its own.
    fn picture_library() -> (tempfile::TempDir, Mutex<Connection>) {
        let (dir, db) = library(PICTURE);
        hash_pending(&db, &AtomicBool::new(false), &no_report).unwrap();
        save_picture(&db, r"in\a.jpg", "P1", false);
        save_picture(&db, r"in\b.jpg", "P1", true);
        save_picture(&db, r"in\d.jpg", "P2", true);
        save_picture(&db, r"in\v.mp4", "P1", false);
        let (a, b) = (id_of(&db, r"in\a.jpg"), id_of(&db, r"in\b.jpg"));
        let conn = db.lock().unwrap();
        conn.execute("UPDATE media SET lat = -36.85, lon = 174.76 WHERE id = ?1", [a])
            .unwrap();
        conn.execute("UPDATE media SET date_source = 'exif' WHERE id = ?1", [b])
            .unwrap();
        drop(conn);
        (dir, db)
    }

    #[test]
    fn copies_of_one_picture_make_one_set_keeping_the_copy_with_most_details() {
        let (dir, db) = library(PICTURE);
        let root = dir.path();
        hash_pending(&db, &AtomicBool::new(false), &no_report).unwrap();
        // The photos all share a date; the video has no other video to match.
        assert_eq!(listing_pictures(&db, root).unchecked, 4);
        // c is b's exact copy, so b's fingerprint covers it.
        save_picture(&db, r"in\b.jpg", "P1", true);
        assert_eq!(listing_pictures(&db, root).unchecked, 2);
        drop((dir, db));

        let (dir, db) = picture_library();
        let root = dir.path();
        let found = listing_pictures(&db, root);
        assert_eq!(found.unchecked, 0);
        // The exact set of b and c is part of the picture's set, not a second set.
        assert_eq!(found.sets.len(), 1);
        let set = &found.sets[0];
        assert!(set.details_differ);
        assert_eq!((set.hash.as_str(), set.kind), ("picture:P1", "photo"));
        // b has a date and a camera, a only a location, and c only b's camera.
        assert_eq!(paths(set), [r"in\b.jpg", r"in\a.jpg", r"in\c.jpg"]);
        let details: Vec<&[&str]> = set.copies.iter().map(|c| c.details.as_slice()).collect();
        assert_eq!(details, [&["date", "camera"][..], &["location"], &["camera"]]);
        let sizes: Vec<u64> = set.copies.iter().map(|c| c.size).collect();
        assert_eq!(sizes, [31, 24, 31]);
        assert_eq!((found.extra, found.bytes), (2, 24 + 31));

        // Without ExifTool only the exact copies are listed.
        let exact = listing(&db, root);
        assert_eq!(exact.sets.len(), 1);
        assert!(!exact.sets[0].details_differ && exact.sets[0].copies[0].details.is_empty());
        assert_eq!(paths(&exact.sets[0]), [r"in\b.jpg", r"in\c.jpg"]);
    }

    #[test]
    fn a_copy_with_different_details_is_removed_only_with_a_matching_fingerprint() {
        let (dir, db) = picture_library();
        let exe = Path::new("exiftool.exe");
        let rows = index::load_rows(&db.lock().unwrap()).unwrap();
        let pictures = load_pictures(&db.lock().unwrap()).unwrap();
        let id = |rel: &str| id_of(&db, rel);
        let plan = |keep: i64, remove: Vec<i64>, exiftool: Option<&Path>| {
            plan_removals(rows.clone(), &pictures, &[Choice { keep, remove }], exiftool)
        };
        let (a, b, c, d, v) = (
            id(r"in\a.jpg"),
            id(r"in\b.jpg"),
            id(r"in\c.jpg"),
            id(r"in\d.jpg"),
            id(r"in\v.mp4"),
        );

        let removals = plan(b, vec![a, c], Some(exe)).unwrap();
        let checks: Vec<&Same> =
            removals.iter().map(|r| &r.keeper.as_ref().unwrap().same).collect();
        let hash_b = rows.iter().find(|r| r.id == b).unwrap().hash.clone().unwrap();
        let picture = Same::Picture {
            fingerprint: "P1".into(),
            exiftool: exe.to_path_buf(),
        };
        assert_eq!(checks, [&picture, &Same::Bytes(hash_b)]);
        assert!(plan(b, vec![a], None).is_err(), "no ExifTool to check again");
        assert!(plan(b, vec![d], Some(exe)).is_err(), "another picture");
        assert!(plan(b, vec![v], Some(exe)).is_err(), "another kind");
        assert!(plan(d, vec![a], Some(exe)).is_err(), "the keeper is another picture");
        assert!(plan(a, vec![a], Some(exe)).is_err(), "the keeper itself");

        // A file that changes loses its fingerprint at the next refresh, and with it the match.
        fs::write(dir.path().join(r"in\a.jpg"), "the picture, edited since").unwrap();
        refresh(&db, dir.path());
        let pictures = load_pictures(&db.lock().unwrap()).unwrap();
        assert!(!pictures.contains_key(&a) && pictures.contains_key(&b));
        let rows = index::load_rows(&db.lock().unwrap()).unwrap();
        let choice = Choice {
            keep: b,
            remove: vec![a],
        };
        assert!(plan_removals(rows, &pictures, &[choice], Some(exe)).is_err());
    }

    #[test]
    fn only_files_sharing_a_cheap_sign_with_different_bytes_are_fingerprinted() {
        let row = |id: i64, path: &str, kind: Kind, size: u64, taken: &str, hash: Option<&str>| {
            MediaRow {
                id,
                path: PathBuf::from(path),
                group_key: path.to_owned(),
                kind,
                size,
                mtime: 0,
                taken_at: crate::dates::parse(taken).unwrap(),
                date_source: crate::dates::DateSource::Video,
                lat: None,
                lon: None,
                hash: hash.map(str::to_owned),
            }
        };
        let (clip, day) = ("2026-07-29T01:30:18", "2026-07-01T10:00:00");
        let rows = [
            // Re-exported clips: new names and sizes, the same date.
            row(1, r"a\IMG_1.MOV", Kind::Video, 100, clip, Some("h1")),
            row(2, r"b\ASGV9597.MOV", Kind::Video, 120, clip, Some("h2")),
            // Exact copies of each other with nothing else alike: already an exact set.
            row(3, r"c\x.jpg", Kind::Photo, 50, day, Some("h3")),
            row(4, r"d\x.jpg", Kind::Photo, 50, day, Some("h3")),
            // A numbered copy that lost its date and changed size.
            row(5, r"e\IMG_9.jpg", Kind::Photo, 70, "2026-07-02T10:00:00", None),
            row(6, r"f\IMG_9 (2).jpg", Kind::Photo, 80, "2026-07-03T10:00:00", None),
            // The clips' date, but a photo.
            row(7, r"g\y.jpg", Kind::Photo, 90, clip, Some("h7")),
            // The exact copies' date, but empty, so never compared.
            row(8, r"h\z.jpg", Kind::Photo, 0, day, None),
        ];
        let mut found: Vec<i64> = picture_candidates(&rows).into_iter().collect();
        found.sort_unstable();
        assert_eq!(found, [1, 2, 5, 6]);
    }

    #[test]
    fn plain_names_drop_copy_marks() {
        for name in ["IMG_1.jpg", "IMG_1 (2).jpg", "img_1 - Copy.JPG", "Copy of IMG_1.jpg"] {
            assert_eq!(plain_name(Path::new(name)), "img_1", "{name}");
        }
        assert_eq!(plain_name(Path::new("Trip (Japan).jpg")), "trip (japan)");
    }

    #[test]
    fn a_copy_with_its_details_stripped_is_found_and_binned_only_while_the_same_picture() {
        let manifest = Path::new(env!("CARGO_MANIFEST_DIR"));
        let Some(exe) = exiftool::locate(manifest) else {
            eprintln!("ExifTool not fetched; skipping");
            return;
        };
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let (kept, stripped) = (root.join(r"in\IMG_1.jpg"), root.join(r"out\IMG_1.jpg"));
        fs::create_dir_all(kept.parent().unwrap()).unwrap();
        fs::create_dir_all(stripped.parent().unwrap()).unwrap();
        fs::copy(manifest.join(r"tests\fixtures\exif_gps.jpg"), &kept).unwrap();
        let status = std::process::Command::new(&exe)
            .args(["-q", "-all=", "-o"])
            .arg(&stripped)
            .arg(&kept)
            .status()
            .unwrap();
        assert!(status.success());
        let db = Mutex::new(crate::db::open_in_memory().unwrap());
        refresh(&db, root);

        let cancel = AtomicBool::new(false);
        hash_pending(&db, &cancel, &no_report).unwrap();
        // Same name, so both are read, and nothing is read twice.
        assert_eq!(fingerprint_pending(&db, &exe, &cancel, &no_report).unwrap(), 2);
        assert_eq!(fingerprint_pending(&db, &exe, &cancel, &no_report).unwrap(), 0);
        let found = listing_pictures(&db, root);
        assert_eq!((found.sets.len(), found.unchecked), (1, 0));
        let set = &found.sets[0];
        assert!(set.details_differ);
        assert_eq!(paths(set), [r"in\IMG_1.jpg", r"out\IMG_1.jpg"]);
        assert_eq!(set.copies[0].details, ["location", "date"]);
        assert!(set.copies[1].details.is_empty());

        let rows = index::load_rows(&db.lock().unwrap()).unwrap();
        let pictures = load_pictures(&db.lock().unwrap()).unwrap();
        let removals =
            plan_removals(rows, &pictures, &keep_suggested(&[set]), Some(&exe)).unwrap();
        // Another picture in the copy's place since the check: it stays.
        let copy_bytes = fs::read(&stripped).unwrap();
        fs::copy(manifest.join(r"tests\fixtures\plain.png"), &stripped).unwrap();
        let summary = run_removals(&db, root, &removals);
        assert_eq!((summary.moved, summary.failed), (0, 1));
        assert!(stripped.exists() && kept.exists());

        fs::write(&stripped, copy_bytes).unwrap();
        let summary = run_removals(&db, root, &removals);
        assert_eq!((summary.moved, summary.failed), (1, 0));
        assert!(!stripped.exists() && fake::holds(&stripped) && kept.exists());
    }

    #[test]
    fn removed_copies_are_noted_for_import_to_leave_out() {
        let (dir, db) = library(&[("a/IMG_1.JPG", PHOTO), ("b/IMG_1.JPG", OTHER)]);
        let gone = dir.path().join("b/IMG_1.JPG");
        let rows = index::load_rows(&db.lock().unwrap()).unwrap();
        let id = rows.iter().find(|r| r.path.ends_with("b/IMG_1.JPG")).unwrap().id;
        let removal = Removal {
            files: vec![BinFile {
                media_id: id,
                path: gone.clone(),
            }],
            keeper: Some(Keeper {
                path: dir.path().join("a/IMG_1.JPG"),
                same: Same::Bytes(String::new()),
            }),
        };
        remember_removed(&db, &[removal], &AtomicBool::new(false), &no_report).unwrap();
        let noted: (String, i64) = db
            .lock()
            .unwrap()
            .query_row("SELECT hash, size FROM removed_copies", [], |r| {
                Ok((r.get(0)?, r.get(1)?))
            })
            .unwrap();
        assert_eq!(noted, (hash::file(&gone).unwrap(), OTHER.len() as i64));
    }
}
