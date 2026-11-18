// Bring photos in from outside the library: a folder on this PC, a memory card, or a phone or
// camera over USB. Each file goes straight to its trip or year and month folder. Files whose
// contents are already in the library, under any name, are left out. Nothing at the source
// changes, unless the user chose to move a folder's files in.
//
// Copies are found in two steps, so a big card isn't read twice: only files the same size as a
// library file (or another incoming file) are hashed, then compared by hash.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};

use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::{AppHandle, Manager, State};

use crate::AppState;
use crate::commands::{format_table, library_root, lock_db};
use crate::dates::{self, DateSource};
use crate::db;
use crate::details;
use crate::error::{Error, Result};
use crate::executor::{self, Env, Incoming, IncomingGroup, NewBatch, Transfer};
use crate::exiftool;
use crate::formats::{self, FormatTable, Kind};
use crate::groups::{self, MediaRow};
use crate::index::{self, NewRow, Report};
use crate::jobs;
use crate::mtp;
use crate::naming::Naming;
use crate::organise::{FolderCount, Previews, relative};
use crate::planner::{self, Rules, is_inside};
use crate::scan::{self, ScannedFile};
use crate::trips::{self, Trip};

/// Where to import from, as the Import page asks for it.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum SourceSpec {
    /// A folder on this PC. With `move_files`, the files are moved in instead of copied.
    Folder { path: PathBuf, move_files: bool },
    /// A memory card or other removable drive, read from its root.
    Drive { path: PathBuf, name: String },
    /// A phone or camera over USB.
    Phone { id: String, name: String },
}

/// What an import will do, for the review screen.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportPreview {
    pub id: u64,
    /// "EOS_DIGITAL (E:)", a phone's name, or a folder's name.
    pub source: String,
    /// What was looked through, so the page can check it again.
    pub spec: SourceSpec,
    /// Files are moved in from a folder rather than copied.
    pub moving: bool,
    /// Files that will come in, and their total size.
    pub files: usize,
    pub bytes: u64,
    /// Files already in the library (or found twice at the source).
    pub already: usize,
    pub already_bytes: u64,
    /// Sidecar files whose photo isn't there, never brought in.
    pub left_alone: usize,
    /// Files at the source that aren't photos or videos.
    pub other_files: u64,
    /// Phone files that couldn't be read, left on the phone with the files that go with them.
    pub unreadable: usize,
    /// Empty (0 byte) files, left out.
    pub empty: usize,
    /// Groups that get a ` (n)` added to their names.
    pub renamed: usize,
    /// Destination folders, relative to the library, with how many files each receives.
    pub folders: Vec<FolderCount>,
    pub items: Vec<ImportItem>,
}

/// One incoming group, shown by its leader. Items are in the same order as the plan's groups,
/// so an item's index is what [`apply_import`] is told to leave out.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportItem {
    /// Thumbnail id, `i<preview id>-<item index>`.
    pub thumb: String,
    pub version: i64,
    /// Where it is now, relative to the source.
    pub from: String,
    /// Where it goes, relative to the library.
    pub to: String,
    /// Companion files coming with it.
    pub extra: usize,
    /// Size of the leader and its companions together.
    pub bytes: u64,
    /// When the group was taken, as `YYYY-MM-DDTHH:MM:SS` local time.
    pub taken_at: String,
    /// The date was only guessed from the file's modified time.
    pub uncertain: bool,
    pub kind: String,
    /// The leader's extension, lower case, for a tile with no thumbnail.
    pub ext: String,
    pub renamed: bool,
}

/// A previewed import waiting for the user to start it.
pub struct PendingImport {
    /// Batch kind: `import` for copies, `import_move` for files moved in.
    kind: &'static str,
    /// What History calls the source: a folder's full path, or the card's or phone's name.
    from: String,
    root: PathBuf,
    transfer: Transfer,
    groups: Vec<IncomingGroup>,
    /// Each item's file (path, size, modified time), for its thumbnail.
    thumbs: Vec<(PathBuf, u64, i64)>,
    /// Staging folder holding a phone's files, emptied once the import has run.
    staging: Option<PathBuf>,
    preview: ImportPreview,
}

/// Everything an import scan works with.
pub struct Ctx<'a> {
    pub db: &'a Mutex<Connection>,
    /// The library folder.
    pub root: &'a Path,
    pub table: &'a FormatTable,
    pub trips: &'a [Trip],
    pub naming: Naming,
    pub exiftool: Option<&'a Path>,
    pub cancel: &'a AtomicBool,
    pub report: Report<'a>,
}

/// One file found at a source.
#[derive(Debug, Clone)]
pub struct Found {
    /// `file.path` is where it can be read: on the card, in the folder, or a phone file's
    /// staging copy.
    pub file: ScannedFile,
    /// Where it came from, for History.
    pub origin: PathBuf,
    /// Already known (a phone file's hash is taken while it is copied off).
    pub hash: Option<String>,
}

/// What an import will do.
#[derive(Debug, Default)]
pub struct ImportPlan {
    pub groups: Vec<IncomingGroup>,
    /// When each group (in the order of `groups`) was taken, and whether that was only guessed
    /// from a modified time.
    pub taken: Vec<(String, bool)>,
    pub already: usize,
    pub already_bytes: u64,
    pub left_alone: usize,
    /// Empty (0 byte) files, usually left by a copy that didn't finish. Never brought in.
    pub empty: usize,
}

impl ImportPlan {
    pub fn file_count(&self) -> usize {
        self.groups.iter().map(|g| g.files.len()).sum()
    }
}

/// Library files of the sizes asked about, hashed where they weren't yet.
struct LibraryHashes {
    sizes: HashSet<u64>,
    hashes: HashSet<String>,
}

/// Work out which found files are new and where each goes. `exists` says whether a library
/// path is taken on disk. Only files sharing a size with a library file or another incoming
/// file are hashed, and library files hashed here keep their hash for the duplicate check.
pub fn plan(
    ctx: &Ctx,
    mut found: Vec<Found>,
    exists: &dyn Fn(&Path) -> bool,
) -> Result<ImportPlan> {
    let mut out = ImportPlan::default();
    // An empty file has nothing to bring in, and no hash to be found by next time, so it would
    // come in again on every check under a new "(n)" name.
    let before = found.len();
    found.retain(|f| f.file.size > 0);
    out.empty = before - found.len();
    found.sort_by(|a, b| a.file.path.cmp(&b.file.path));
    let comparable = |f: &Found| f.file.kind != Kind::Companion;

    // Step 1, sizes: a file can only be a copy of something the same size.
    let mut incoming_sizes: HashMap<u64, usize> = HashMap::new();
    for f in found.iter().filter(|f| comparable(f)) {
        *incoming_sizes.entry(f.file.size).or_default() += 1;
    }
    let library = library_hashes(ctx, &incoming_sizes.keys().copied().collect())?;
    let to_hash: Vec<usize> = (0..found.len())
        .filter(|&i| {
            let f = &found[i];
            comparable(f)
                && f.hash.is_none()
                && (library.sizes.contains(&f.file.size) || incoming_sizes[&f.file.size] > 1)
        })
        .collect();
    let paths: Vec<PathBuf> = to_hash
        .iter()
        .map(|&i| found[i].file.path.clone())
        .collect();
    let hashes = crate::hash::many(
        &paths,
        "Comparing with your library",
        ctx.cancel,
        ctx.report,
    );
    if ctx.cancel.load(Ordering::Relaxed) {
        return Err(Error::msg("Cancelled"));
    }
    for (&i, hash) in to_hash.iter().zip(hashes) {
        found[i].hash = hash;
    }

    // Step 2, contents: a copy of a library file, or of a file earlier in this import.
    let mut seen = HashSet::new();
    let duplicate: Vec<bool> = found
        .iter()
        .map(|f| match &f.hash {
            Some(h) if comparable(f) => library.hashes.contains(h) || !seen.insert(h.clone()),
            _ => false,
        })
        .collect();

    // Whole same-name sets that are already in, sidecars included, aren't read any further.
    let keys: Vec<String> = found
        .iter()
        .map(|f| scan::group_key(&f.file.path, f.file.kind, ctx.table))
        .collect();
    let mut buckets: BTreeMap<&str, Vec<usize>> = BTreeMap::new();
    for (i, key) in keys.iter().enumerate() {
        buckets.entry(key).or_default().push(i);
    }
    let mut to_read = Vec::new();
    for members in buckets.values() {
        let media: Vec<usize> = members
            .iter()
            .copied()
            .filter(|&i| found[i].file.kind != Kind::Companion)
            .collect();
        if media.is_empty() {
            out.left_alone += members.len();
        } else if media.iter().all(|&i| duplicate[i]) {
            count_already(&mut out, members.iter().map(|&i| &found[i]));
        } else {
            to_read.extend(members.iter().copied());
        }
    }
    to_read.sort_unstable();

    let files: Vec<&ScannedFile> = to_read.iter().map(|&i| &found[i].file).collect();
    let new_rows = index::read_files(&files, ctx.exiftool, ctx.cancel, ctx.report)?;
    let read: HashMap<usize, &NewRow> = to_read.iter().copied().zip(&new_rows).collect();
    let rows: Vec<MediaRow> = read
        .iter()
        .map(|(&i, row)| MediaRow {
            id: i as i64,
            path: row.path.clone(),
            group_key: keys[i].clone(),
            kind: row.kind,
            size: row.size,
            mtime: row.mtime,
            taken_at: row.meta.taken_at,
            date_source: row.meta.source,
            lat: row.meta.lat,
            lon: row.meta.lon,
            hash: found[i].hash.clone(),
        })
        .collect();
    let (groups, orphans) = groups::build(rows);
    out.left_alone += orphans.len();

    // Incoming rows use their index in `found` as an id, which could match a library photo
    // taken out of a trip, so imports go by the trips' dates alone. New photos can't have
    // been left out of a trip yet.
    let trips: Vec<Trip> = ctx
        .trips
        .iter()
        .map(|t| Trip {
            excluded: Default::default(),
            ..t.clone()
        })
        .collect();
    let rules = Rules {
        root: ctx.root,
        trips: &trips,
        naming: ctx.naming,
    };
    let mut claimed = HashSet::new();
    let now = db::now();
    for group in &groups {
        let index_of = |m: &MediaRow| m.id as usize;
        // A set split by date can still be wholly made of copies.
        let all_copies = group
            .members
            .iter()
            .filter(|m| m.kind != Kind::Companion)
            .all(|m| duplicate[index_of(m)]);
        if all_copies {
            count_already(&mut out, group.members.iter().map(|m| &found[index_of(m)]));
            continue;
        }
        let dir = rules.target_dir(group);
        let placed = planner::place(group, &dir, ctx.table, &mut claimed, exists);
        let files = placed
            .moves
            .iter()
            .map(|mv| {
                let i = mv.media_id as usize;
                Incoming {
                    from: found[i].file.path.clone(),
                    origin: found[i].origin.clone(),
                    to: mv.to.clone(),
                    row: row_json(&mv.to, read[&i], found[i].hash.as_deref(), ctx.table, now),
                }
            })
            .collect();
        out.groups.push(IncomingGroup {
            files,
            renamed: placed.renamed,
        });
        out.taken.push((
            dates::format(&group.taken_at),
            group.date_source == DateSource::Modified,
        ));
    }
    Ok(out)
}

/// Same-name files that arrived after files of their name were filed from the same folder,
/// with the library files those became.
pub struct Late {
    pub found: Vec<Found>,
    pub filed: Vec<MediaRow>,
}

/// Place files that arrived after their partners were filed, beside the partner under its name
/// (`IMG_1 (1).MOV` beside `IMG_1 (1).HEIC`), so they are one tile again. A late sidecar comes
/// in this way too, where on its own it would have no photo to go with. Each set of same-name
/// arrivals joins whole or not at all. Returns those groups, and the files that turn out to be
/// pictures of their own (taken more than a few minutes apart, or with no free name beside the
/// partner) for [`plan`].
pub fn plan_beside(
    ctx: &Ctx,
    late: Vec<Late>,
    exists: &dyn Fn(&Path) -> bool,
) -> Result<(Vec<IncomingGroup>, Vec<Found>)> {
    let files: Vec<&ScannedFile> = late
        .iter()
        .flat_map(|l| l.found.iter().map(|f| &f.file))
        .collect();
    let rows = index::read_files(&files, ctx.exiftool, ctx.cancel, ctx.report)?;
    let mut rows = rows.iter();
    let now = db::now();
    let (mut groups, mut rest) = (Vec::new(), Vec::new());
    for late in late {
        let read: Vec<&NewRow> = rows.by_ref().take(late.found.len()).collect();
        let mut filed = late.filed;
        filed.sort_by_key(|m| m.kind.lead_rank());
        let placed: Option<Vec<Incoming>> = filed.first().and_then(|partner| {
            late.found
                .iter()
                .zip(&read)
                .map(|(found, row)| {
                    let as_row = MediaRow {
                        taken_at: row.meta.taken_at,
                        date_source: row.meta.source,
                        kind: row.kind,
                        ..partner.clone()
                    };
                    let fits =
                        row.kind == Kind::Companion || groups::belongs_with(partner, &as_row);
                    let to =
                        beside(partner, &found.file, ctx.table).filter(|to| fits && !exists(to))?;
                    Some(Incoming {
                        from: found.file.path.clone(),
                        origin: found.origin.clone(),
                        row: row_json(&to, row, found.hash.as_deref(), ctx.table, now),
                        to,
                    })
                })
                .collect()
        });
        match placed {
            Some(files) => groups.push(IncomingGroup {
                files,
                renamed: false,
            }),
            None => rest.extend(late.found),
        }
    }
    Ok((groups, rest))
}

/// Where `file` goes beside `partner`: the partner's folder, with the partner's base name and
/// the file's own ending (`.MOV`, `.CR2.xmp`).
fn beside(partner: &MediaRow, file: &ScannedFile, table: &FormatTable) -> Option<PathBuf> {
    let partner_name = partner.path.file_name()?.to_string_lossy();
    let (base, _) = scan::split_name(&partner_name, partner.kind, table);
    let name = file.path.file_name()?.to_string_lossy();
    let (_, ending) = scan::split_name(&name, file.kind, table);
    Some(partner.path.parent()?.join(format!("{base}{ending}")))
}

fn count_already<'a>(plan: &mut ImportPlan, files: impl Iterator<Item = &'a Found>) {
    for f in files {
        plan.already += 1;
        plan.already_bytes += f.file.size;
    }
}

/// The `media` row a file gets once it lands at `to`, as journal JSON.
fn row_json(
    to: &Path,
    row: &NewRow,
    hash: Option<&str>,
    table: &FormatTable,
    now: i64,
) -> serde_json::Value {
    json!({
        "id": null,
        "path": to.to_string_lossy(),
        "group_key": scan::group_key(to, row.kind, table),
        "kind": row.kind.as_str(),
        "size": row.size,
        "mtime": row.mtime,
        "taken_at": dates::format(&row.meta.taken_at),
        "tz_offset_min": row.meta.offset_min,
        "date_source": row.meta.source.as_str(),
        "lat": row.meta.lat,
        "lon": row.meta.lon,
        "hash": hash,
        "indexed_at": now,
    })
}

/// Hashes of the library's photos and videos with these sizes, hashing (and saving) any that
/// weren't yet. A file that can't be read is skipped and stays unhashed.
fn library_hashes(ctx: &Ctx, sizes_wanted: &HashSet<u64>) -> Result<LibraryHashes> {
    let rows: Vec<(i64, PathBuf, u64, Option<String>)> = {
        let conn = lock(ctx.db)?;
        let mut stmt = conn.prepare(
            "SELECT id, path, size, hash FROM media WHERE kind != 'companion' AND size > 0",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok((
                r.get(0)?,
                PathBuf::from(r.get::<_, String>(1)?),
                r.get::<_, i64>(2)? as u64,
                r.get(3)?,
            ))
        })?;
        rows.filter_map(|r| r.ok())
            .filter(|(_, _, size, _)| sizes_wanted.contains(size))
            .collect()
    };
    let unhashed: Vec<(i64, PathBuf)> = rows
        .iter()
        .filter(|(_, _, _, hash)| hash.is_none())
        .map(|(id, path, _, _)| (*id, path.clone()))
        .collect();
    let paths: Vec<PathBuf> = unhashed.iter().map(|(_, p)| p.clone()).collect();
    let fresh = crate::hash::many(
        &paths,
        "Reading library files of the same size",
        ctx.cancel,
        ctx.report,
    );
    if ctx.cancel.load(Ordering::Relaxed) {
        return Err(Error::msg("Cancelled"));
    }
    {
        let mut conn = lock(ctx.db)?;
        let tx = conn.transaction()?;
        {
            let mut update = tx.prepare("UPDATE media SET hash = ?1 WHERE id = ?2")?;
            for ((id, _), hash) in unhashed.iter().zip(&fresh) {
                if let Some(hash) = hash {
                    update.execute(params![hash, id])?;
                }
            }
        }
        tx.commit()?;
    }
    let mut sizes: HashSet<u64> = rows.iter().map(|(_, _, size, _)| *size).collect();
    let mut hashes: HashSet<String> = rows.into_iter().filter_map(|(_, _, _, h)| h).collect();
    hashes.extend(fresh.into_iter().flatten());
    // Copies Duplicates removed count as in the library, so they aren't brought back.
    let removed: Vec<(String, u64)> = {
        let conn = lock(ctx.db)?;
        let mut stmt = conn.prepare("SELECT hash, size FROM removed_copies")?;
        let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get::<_, i64>(1)? as u64)))?;
        rows.filter_map(|r| r.ok()).collect()
    };
    for (hash, size) in removed
        .into_iter()
        .filter(|(_, size)| sizes_wanted.contains(size))
    {
        sizes.insert(size);
        hashes.insert(hash);
    }
    Ok(LibraryHashes { sizes, hashes })
}

/// Every photo, video and sidecar under `dir`, leaving out the library if it is inside.
pub fn scan_folder(ctx: &Ctx, dir: &Path) -> Result<(Vec<Found>, u64)> {
    (ctx.report)("Looking for photos and videos", 0, 0);
    let scanned = scan::scan_excluding(dir, Some(ctx.root), ctx.table, ctx.cancel)?;
    let found = scanned
        .files
        .into_iter()
        .map(|file| Found {
            origin: file.path.clone(),
            file,
            hash: None,
        })
        .collect();
    Ok((found, scanned.other_files))
}

/// A phone's new files, copied off into staging.
pub struct PhoneCheck {
    pub found: Vec<Found>,
    /// Files seen on this phone before whose contents are already in the library, and their
    /// total size. They aren't copied again.
    pub already: usize,
    pub already_bytes: u64,
    /// Files the phone wouldn't hand over, even when asked twice. They stay on the phone with
    /// the files that go with them.
    pub unreadable: usize,
}

/// Files failing one after another before a phone check gives up: by then the phone has most
/// likely been unplugged or locked, rather than refusing one file.
const GIVE_UP_AFTER: usize = 5;

/// What [`copy_off`] fetched, in set order, and how many files failed.
struct CopiedOff<T> {
    files: Vec<T>,
    unreadable: usize,
}

/// Fetch every file of each set (indexes into the phone's file list), asking twice for a file
/// the phone fails to hand over. A set with a file that still fails is left out whole, so a
/// photo never arrives without its Live Photo video. `fetch` gets the file's index and how many
/// came before it, and gives `Ok(Err(_))` when the phone failed and `Err(_)` when this PC did
/// (a full disk, the database), which stops the check at once.
///
/// Errors with the last failure once [`GIVE_UP_AFTER`] files fail in a row, or when the last
/// two or more all failed: a phone unplugged or locked near the end, not files it refused.
fn copy_off<T>(
    sets: &[Vec<usize>],
    cancel: &AtomicBool,
    mut fetch: impl FnMut(usize, usize) -> Result<Result<T>>,
) -> Result<CopiedOff<T>> {
    let mut out = CopiedOff {
        files: Vec::new(),
        unreadable: 0,
    };
    let (mut done, mut in_a_row) = (0, 0);
    let mut last_failure = None;
    for set in sets {
        let mut got = Vec::with_capacity(set.len());
        for &i in set {
            if cancel.load(Ordering::Relaxed) {
                return Err(Error::msg("Cancelled"));
            }
            let fetched = match fetch(i, done)? {
                Err(_) => fetch(i, done)?,
                got => got,
            };
            done += 1;
            match fetched {
                Ok(file) => {
                    in_a_row = 0;
                    got.push(file);
                }
                Err(err) => {
                    in_a_row += 1;
                    if in_a_row >= GIVE_UP_AFTER {
                        return Err(err);
                    }
                    log::warn!("Left on the phone: {err}");
                    out.unreadable += 1;
                    last_failure = Some(err);
                    got.clear();
                    break;
                }
            }
        }
        out.files.extend(got);
    }
    match last_failure {
        Some(err) if in_a_row >= 2 => Err(err),
        _ => Ok(out),
    }
}

/// Copy a phone's new photos into `staging` and list them. A file seen on this phone before
/// (same path, size and modified time) whose contents are already in the library isn't copied
/// again.
pub fn fetch_phone(ctx: &Ctx, id: &str, name: &str, staging: &Path) -> Result<PhoneCheck> {
    let provider = mtp::provider()?;
    let phone = mtp::open(&provider, id, name)?;
    (ctx.report)(&format!("Looking for photos on {name}"), 0, 0);
    let files = phone.list(ctx.table, ctx.cancel, ctx.report)?;

    let memo = load_memo(ctx.db, id)?;
    let sizes: HashSet<u64> = files.iter().map(|f| f.size).filter(|&s| s > 0).collect();
    let library = library_hashes(ctx, &sizes)?;
    let known_copy = |f: &mtp::PhoneFile| {
        memo.get(&key_of(&f.path))
            .is_some_and(|(size, modified, hash)| {
                *size == f.size && *modified == secs(f.modified) && library.hashes.contains(hash)
            })
    };

    // Same-name sets (a photo and its Live Photo video) are skipped only as a whole.
    let mut buckets: BTreeMap<String, Vec<usize>> = BTreeMap::new();
    for (i, f) in files.iter().enumerate() {
        let kind = ctx.table.kind_of(&f.path).unwrap_or(Kind::Companion);
        buckets
            .entry(scan::group_key(&f.path, kind, ctx.table))
            .or_default()
            .push(i);
    }
    let (mut already, mut already_bytes) = (0, 0);
    let mut wanted: Vec<Vec<usize>> = Vec::new();
    for members in buckets.values() {
        let media: Vec<usize> = members
            .iter()
            .copied()
            .filter(|&i| ctx.table.kind_of(&files[i].path) != Some(Kind::Companion))
            .collect();
        if !media.is_empty() && media.iter().all(|&i| known_copy(&files[i])) {
            already += members.len();
            already_bytes += members.iter().map(|&i| files[i].size).sum::<u64>();
        } else {
            wanted.push(members.clone());
        }
    }

    let stage = format!("Copying from {name}");
    let total: usize = wanted.iter().map(Vec::len).sum();
    let copied = copy_off(&wanted, ctx.cancel, |i, done| {
        (ctx.report)(&stage, done, total);
        let file = &files[i];
        let to = staging.join(&file.path);
        if let Some(dir) = to.parent() {
            fs::create_dir_all(dir)?;
        }
        let _ = fs::remove_file(&to);
        let hash = match phone.download(file, &to) {
            Ok(hash) => hash,
            Err(err) => return Ok(Err(err)),
        };
        let modified = secs(file.modified);
        save_memo(ctx.db, id, &file.path, file.size, modified, &hash)?;
        let kind = ctx.table.kind_of(&file.path).unwrap_or(Kind::Companion);
        let size = fs::metadata(&to).map_or(file.size, |m| m.len());
        Ok(Ok(Found {
            file: ScannedFile {
                path: to,
                kind,
                size,
                mtime: modified,
            },
            origin: Path::new(name).join(&file.path),
            hash: Some(hash),
        }))
    })?;
    (ctx.report)(&stage, total, total);
    Ok(PhoneCheck {
        found: copied.files,
        already,
        already_bytes,
        unreadable: copied.unreadable,
    })
}

/// Phone files hashed before: path key > (size, modified, hash).
fn load_memo(db: &Mutex<Connection>, device: &str) -> Result<HashMap<String, (u64, i64, String)>> {
    let conn = lock(db)?;
    let mut stmt =
        conn.prepare("SELECT path, size, modified, hash FROM device_files WHERE device = ?1")?;
    let rows = stmt.query_map([device], |r| {
        Ok((
            r.get::<_, String>(0)?,
            (r.get::<_, i64>(1)? as u64, r.get(2)?, r.get(3)?),
        ))
    })?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

fn save_memo(
    db: &Mutex<Connection>,
    device: &str,
    path: &Path,
    size: u64,
    modified: i64,
    hash: &str,
) -> Result<()> {
    lock(db)?.execute(
        "INSERT INTO device_files (device, path, size, modified, hash) VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(device, path) DO UPDATE SET
            size = excluded.size, modified = excluded.modified, hash = excluded.hash",
        params![device, key_of(path), size as i64, modified, hash],
    )?;
    Ok(())
}

fn key_of(path: &Path) -> String {
    index::path_key(path)
}

/// Unix seconds, 0 when unknown.
fn secs(time: Option<std::time::SystemTime>) -> i64 {
    time.and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map_or(0, |d| d.as_secs() as i64)
}

/// Where a phone's files wait between being copied off and coming into the library. Inside
/// the library's hidden `.photolib` folder, so the final step is a rename on the same drive.
pub fn staging_dir(root: &Path) -> PathBuf {
    root.join(".photolib").join("staging")
}

/// Empty the staging folder. Everything in it is a copy of a file still on a phone.
pub fn clear_staging(root: &Path) {
    let dir = staging_dir(root);
    if dir.exists()
        && let Err(err) = fs::remove_dir_all(&dir)
    {
        log::warn!("Couldn't empty {}: {err}", dir.display());
    }
}

/// Check a source and start looking through it in the background. The job's result is an
/// [`ImportPreview`].
#[tauri::command]
pub fn scan_import(app: AppHandle, source: SourceSpec) -> Result<()> {
    start_scan(&app, source)
}

/// The first folder among paths dropped on the window, for Import to check. Dropped files are
/// passed over, so dropping one photo never imports everything beside it. Async, so looking at
/// paths on a slow or sleeping drive doesn't hold up the window.
#[tauri::command(async)]
pub fn dropped_folder(paths: Vec<PathBuf>) -> Option<PathBuf> {
    paths.into_iter().find(|path| path.is_dir())
}

/// [`scan_import`], also started from the tray's "Import from <card>" item.
pub fn start_scan(app: &AppHandle, source: SourceSpec) -> Result<()> {
    let state = app.state::<AppState>();
    let (root, table, trips, naming) = {
        let conn = lock_db(&state)?;
        (
            library_root(&conn)?,
            format_table(&conn)?,
            trips::load(&conn)?,
            Naming::load(&conn)?,
        )
    };
    if let SourceSpec::Folder { path, .. } | SourceSpec::Drive { path, .. } = &source {
        if !path.is_dir() {
            return Err(Error::msg(format!("{} can't be found", path.display())));
        }
        if is_inside(path, &root) {
            return Err(Error::msg(
                "That folder is already part of your library. Use Sort to put its photos in order.",
            ));
        }
    }
    let exiftool = app
        .path()
        .resource_dir()
        .ok()
        .and_then(|dir| exiftool::locate(&dir));
    let handle = app.clone();
    jobs::start(app, "import-scan", move |job| {
        let state = handle.state::<AppState>();
        let ctx = Ctx {
            db: &state.db,
            root: &root,
            table: &table,
            trips: &trips,
            naming,
            exiftool: exiftool.as_deref(),
            cancel: job.cancel_flag(),
            report: &|stage, done, total| job.report(stage, done, total),
        };
        let previews = handle.state::<Previews<PendingImport>>();
        let phone = matches!(source, SourceSpec::Phone { .. });
        // A phone check refills the staging folder, so an older phone preview can't be used.
        if phone && let Some((id, _)) = previews.latest().filter(|(_, p)| p.staging.is_some()) {
            previews.clear(id);
        }
        let looked = look_through(&ctx, source)?;
        let replaced = previews.latest();
        let (_, pending) = previews.store_with(|id| looked.into_pending(id, &root));
        // Only one preview is kept, so a replaced phone preview's copies are no longer needed.
        if !phone && replaced.is_some_and(|(_, p)| p.staging.is_some()) {
            clear_staging(&root);
        }
        Ok(pending.preview.clone())
    })
}

/// A source looked through and planned, before it becomes a preview.
struct Looked {
    spec: SourceSpec,
    /// What History and the preview call the source.
    name: String,
    /// Item paths are shown relative to this.
    source_root: PathBuf,
    transfer: Transfer,
    staging: Option<PathBuf>,
    plan: ImportPlan,
    other_files: u64,
    /// Phone files that couldn't be copied off.
    unreadable: usize,
}

/// Find a source's files, copying a phone's off first, and plan the import.
fn look_through(ctx: &Ctx, source: SourceSpec) -> Result<Looked> {
    let exists = |p: &Path| fs::symlink_metadata(p).is_ok();
    let spec = source.clone();
    let (name, source_root, transfer, staging, found, other_files) = match source {
        SourceSpec::Folder { path, move_files } => {
            let (found, other) = scan_folder(ctx, &path)?;
            let transfer = if move_files {
                Transfer::Move
            } else {
                Transfer::Copy
            };
            // The folder's own name reads better in a headline; a drive root has none.
            let name = path.file_name().map_or_else(
                || path.display().to_string(),
                |n| n.to_string_lossy().into_owned(),
            );
            (name, path, transfer, None, found, other)
        }
        SourceSpec::Drive { path, name } => {
            let (found, other) = scan_folder(ctx, &path)?;
            (name, path, Transfer::Copy, None, found, other)
        }
        SourceSpec::Phone { id, name } => {
            let staging = staging_dir(ctx.root);
            clear_staging(ctx.root);
            fs::create_dir_all(&staging)?;
            let check = fetch_phone(ctx, &id, &name, &staging)?;
            let mut plan = plan(ctx, check.found, &exists)?;
            plan.already += check.already;
            plan.already_bytes += check.already_bytes;
            // Items show where each file is on the phone.
            return Ok(Looked {
                spec,
                source_root: PathBuf::from(&name),
                name,
                transfer: Transfer::Staged,
                staging: Some(staging),
                plan,
                other_files: 0,
                unreadable: check.unreadable,
            });
        }
    };
    Ok(Looked {
        spec,
        name,
        source_root,
        transfer,
        staging,
        plan: plan(ctx, found, &exists)?,
        other_files,
        unreadable: 0,
    })
}

impl Looked {
    fn into_pending(self, id: u64, root: &Path) -> PendingImport {
        let moving = self.transfer == Transfer::Move;
        // History names a folder in full, since its name alone may not say which one it was.
        let from = match &self.spec {
            SourceSpec::Folder { path, .. } => path.display().to_string(),
            _ => self.name.clone(),
        };
        let (preview, thumbs) = describe(id, &self, root);
        PendingImport {
            kind: if moving { "import_move" } else { "import" },
            from,
            root: root.to_path_buf(),
            transfer: self.transfer,
            groups: self.plan.groups,
            thumbs,
            staging: self.staging,
            preview,
        }
    }
}

/// Summarise a planned import for the review screen, plus each item's thumbnail source.
fn describe(id: u64, looked: &Looked, root: &Path) -> (ImportPreview, Vec<(PathBuf, u64, i64)>) {
    let plan = &looked.plan;
    let mut folders: BTreeMap<String, usize> = BTreeMap::new();
    let mut bytes = 0;
    for group in &plan.groups {
        for file in &group.files {
            bytes += file.row["size"].as_u64().unwrap_or(0);
            let folder = relative(root, file.to.parent().unwrap_or(root));
            *folders.entry(folder).or_default() += 1;
        }
    }
    // Every group is listed, one item each, so item indexes line up with the plan's groups.
    let mut thumbs = Vec::with_capacity(plan.groups.len());
    let mut items = Vec::with_capacity(plan.groups.len());
    for (n, (group, (taken_at, uncertain))) in plan.groups.iter().zip(&plan.taken).enumerate() {
        let Some(leader) = group.files.first() else {
            thumbs.push(Default::default());
            continue;
        };
        let mtime = leader.row["mtime"].as_i64().unwrap_or(0);
        let size = leader.row["size"].as_u64().unwrap_or(0);
        thumbs.push((leader.from.clone(), size, mtime));
        items.push(ImportItem {
            thumb: format!("i{id}-{n}"),
            version: mtime,
            from: relative(&looked.source_root, &leader.origin),
            to: relative(root, &leader.to),
            extra: group.files.len() - 1,
            bytes: group
                .files
                .iter()
                .map(|f| f.row["size"].as_u64().unwrap_or(0))
                .sum(),
            taken_at: taken_at.clone(),
            uncertain: *uncertain,
            kind: leader.row["kind"].as_str().unwrap_or("photo").to_owned(),
            ext: formats::ext_of(&leader.to),
            renamed: group.renamed,
        });
    }
    let preview = ImportPreview {
        id,
        source: looked.name.clone(),
        spec: looked.spec.clone(),
        moving: looked.transfer == Transfer::Move,
        files: plan.file_count(),
        bytes,
        already: plan.already,
        already_bytes: plan.already_bytes,
        left_alone: plan.left_alone,
        other_files: looked.other_files,
        unreadable: looked.unreadable,
        empty: plan.empty,
        renamed: plan.groups.iter().filter(|g| g.renamed).count(),
        folders: folders
            .into_iter()
            .map(|(folder, files)| FolderCount { folder, files })
            .collect(),
        items,
    };
    (preview, thumbs)
}

/// The latest import preview, so the page can show it again after switching away.
#[tauri::command]
pub fn import_preview(previews: State<Previews<PendingImport>>) -> Option<ImportPreview> {
    previews
        .latest()
        .map(|(_, pending)| pending.preview.clone())
}

/// Drop a preview the user turned away from, with any phone files copied off for it.
#[tauri::command]
pub fn discard_import(previews: State<Previews<PendingImport>>, id: u64) {
    if let Ok(pending) = previews.get(id) {
        previews.clear(id);
        if pending.staging.is_some() {
            clear_staging(&pending.root);
        }
    }
}

/// The History label for an import of `files` files.
fn import_label(transfer: Transfer, files: usize, from: &str) -> String {
    let files = format!("{files} {}", if files == 1 { "file" } else { "files" });
    if transfer == Transfer::Move {
        format!("Moved {files} in from {from}")
    } else {
        format!("Copied {files} from {from}")
    }
}

/// The groups still wanted once the items at `skip` (indexes into the preview's items) are
/// left out. Out-of-range indexes are ignored.
fn chosen_groups(groups: &[IncomingGroup], skip: &[usize]) -> Vec<IncomingGroup> {
    let skip: HashSet<usize> = skip.iter().copied().collect();
    groups
        .iter()
        .enumerate()
        .filter(|(n, _)| !skip.contains(n))
        .map(|(_, group)| group.clone())
        .collect()
}

/// Run a previewed import in the background as one undoable batch, leaving out the items the
/// user unticked. Files left out stay where they are and show up again on the next check.
#[tauri::command]
pub fn apply_import(
    app: AppHandle,
    previews: State<Previews<PendingImport>>,
    id: u64,
    skip: Vec<usize>,
) -> Result<()> {
    let pending = previews.get(id)?;
    let groups = chosen_groups(&pending.groups, &skip);
    if groups.is_empty() {
        return Err(Error::msg("Select at least one item to import"));
    }
    let files = groups.iter().map(|g| g.files.len()).sum();
    let label = import_label(pending.transfer, files, &pending.from);
    let handle = app.clone();
    jobs::start(&app, "import", move |job| {
        let state = handle.state::<AppState>();
        let table = format_table(&*lock_db(&state)?)?;
        let env = Env {
            db: &state.db,
            root: &pending.root,
            table: &table,
            cancel: job.cancel_flag(),
            report: &|stage, done, total| job.report(stage, done, total),
        };
        let batch = NewBatch {
            kind: pending.kind,
            label: &label,
            on_begin: None,
        };
        let summary = executor::import(&env, &batch, &groups, pending.transfer);
        if pending.staging.is_some() {
            clear_staging(&pending.root);
        }
        summary
    })?;
    previews.clear(id);
    Ok(())
}

/// File, size and modified time behind an import thumbnail id (`<preview id>-<item index>`,
/// without the leading `i`), while that preview is the latest.
pub fn thumb_source(app: &AppHandle<impl tauri::Runtime>, id: &str) -> Option<(PathBuf, u64, i64)> {
    let (preview, item) = id.split_once('-')?;
    let (latest, pending) = app.state::<Previews<PendingImport>>().latest()?;
    if preview.parse::<u64>().ok()? != latest {
        return None;
    }
    pending.thumbs.get(item.parse::<usize>().ok()?).cloned()
}

/// What the viewer needs to show a file waiting in an import preview.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportFile {
    pub path: String,
    /// A photo the webview can show as it is.
    pub viewable: bool,
    /// A video the webview can play.
    pub playable: bool,
    /// The file has gone since the preview was made, as when it was deleted or the card removed.
    pub missing: bool,
}

/// The file behind item `item` of import preview `id`. Phone files are already copied into
/// staging by the time the preview exists, so every item is a file on this PC.
fn preview_file(pending: &PendingImport, item: usize) -> Result<(&Path, &str)> {
    let path = pending.thumbs.get(item).map(|(path, _, _)| path.as_path());
    let kind = pending.preview.items.get(item).map(|i| i.kind.as_str());
    path.zip(kind)
        .ok_or_else(|| Error::msg("That photo isn't in this import any more. Check again."))
}

/// Show a file from an import preview in the viewer. Its path is let into the asset protocol,
/// since a card or folder being imported is outside the library.
#[tauri::command]
pub fn import_file(
    app: AppHandle,
    previews: State<Previews<PendingImport>>,
    id: u64,
    item: usize,
) -> Result<ImportFile> {
    let pending = previews.get(id)?;
    let (path, kind) = preview_file(&pending, item)?;
    let _ = app.asset_protocol_scope().allow_file(path);
    Ok(ImportFile {
        path: path.to_string_lossy().into_owned(),
        viewable: kind == Kind::Photo.as_str() && formats::web_viewable(path),
        playable: kind == Kind::Video.as_str() && formats::web_playable(path),
        missing: !path.exists(),
    })
}

/// Open a file from an import preview in its default Windows app.
#[tauri::command(async)]
pub fn open_import_file(
    previews: State<Previews<PendingImport>>,
    id: u64,
    item: usize,
) -> Result<()> {
    let pending = previews.get(id)?;
    let (path, _) = preview_file(&pending, item)?;
    tauri_plugin_opener::open_path(path, None::<&str>).map_err(|e| Error::msg(e.to_string()))
}

/// What a file from an import preview says about itself: camera, size, settings and location.
#[tauri::command(async)]
pub fn import_file_details(
    app: AppHandle,
    previews: State<'_, Previews<PendingImport>>,
    id: u64,
    item: usize,
) -> Result<details::Details> {
    let path = {
        let pending = previews.get(id)?;
        preview_file(&pending, item)?.0.to_path_buf()
    };
    Ok(details::read(&app, &path))
}

/// Show a file from an import preview selected in Explorer.
#[tauri::command(async)]
pub fn reveal_import_file(
    previews: State<Previews<PendingImport>>,
    id: u64,
    item: usize,
) -> Result<()> {
    let pending = previews.get(id)?;
    let (path, _) = preview_file(&pending, item)?;
    tauri_plugin_opener::reveal_item_in_dir(path).map_err(|e| Error::msg(e.to_string()))
}

fn lock(db: &Mutex<Connection>) -> Result<std::sync::MutexGuard<'_, Connection>> {
    db.lock().map_err(|_| Error::msg("Database lock poisoned"))
}

/// Folder imports planned the way the Import page plans them, shared by the import and
/// executor tests.
#[cfg(test)]
pub mod testing {
    use super::*;
    use crate::executor::testing::no_report;

    /// Plan bringing `source` into the library at `root`. Returns the plan and the count of
    /// files that aren't photos or videos.
    pub fn plan_folder(
        db: &Mutex<Connection>,
        root: &Path,
        source: &Path,
        trips: &[Trip],
    ) -> (ImportPlan, u64) {
        let table = FormatTable::default();
        let cancel = AtomicBool::new(false);
        let ctx = Ctx {
            db,
            root,
            table: &table,
            trips,
            naming: Naming::default(),
            exiftool: None,
            cancel: &cancel,
            report: &no_report,
        };
        let (found, other) = scan_folder(&ctx, source).unwrap();
        let plan = plan(&ctx, found, &|p| fs::symlink_metadata(p).is_ok()).unwrap();
        (plan, other)
    }

    /// Write `contents` to `path`, making its folder.
    pub fn write(path: &Path, contents: &str) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, contents).unwrap();
    }
}

#[cfg(test)]
mod tests {
    use super::testing::{plan_folder, write};
    use super::*;
    use crate::executor::testing::{library, no_report, snapshot};
    use crate::recycle::fake;

    const LIBRARY_PHOTO: &str = "2025\\2025-03\\IMG_20250301_090000.jpg";

    #[test]
    fn dropped_folder_skips_files_and_missing_paths() {
        let dir = tempfile::tempdir().unwrap();
        let photo = dir.path().join("IMG_1.jpg");
        fs::write(&photo, b"x").unwrap();
        let first = dir.path().join("Holiday");
        let second = dir.path().join("Backup");
        fs::create_dir(&first).unwrap();
        fs::create_dir(&second).unwrap();
        let gone = dir.path().join("gone");
        assert_eq!(
            dropped_folder(vec![photo.clone(), gone, first.clone(), second]),
            Some(first)
        );
        assert_eq!(dropped_folder(vec![photo]), None);
        assert_eq!(dropped_folder(Vec::new()), None);
    }

    fn japan() -> Trip {
        Trip {
            id: 1,
            name: "Japan".into(),
            start_at: dates::parse("2025-05-01T00:00:00").unwrap(),
            end_at: dates::parse("2025-05-03T23:59:59").unwrap(),
            folder: "2025-05-01 Japan".into(),
            created_at: 0,
            excluded: Default::default(),
        }
    }

    /// Every planned destination, relative to the library, sorted.
    fn destinations(plan: &ImportPlan, root: &Path) -> Vec<String> {
        let mut out: Vec<String> = plan
            .groups
            .iter()
            .flat_map(|g| &g.files)
            .map(|f| relative(root, &f.to))
            .collect();
        out.sort();
        out
    }

    /// A card-like folder: a renamed copy of the library photo, a photo with its sidecar, the
    /// same photo saved twice, a trip photo, a new photo whose name is taken, a sidecar on its
    /// own, and a text file.
    fn card(library_root: &Path) -> tempfile::TempDir {
        let card = tempfile::tempdir().unwrap();
        let dcim = card.path().join("DCIM");
        let library_bytes = fs::read_to_string(library_root.join(LIBRARY_PHOTO)).unwrap();
        write(&dcim.join("100\\renamed copy.jpg"), &library_bytes);
        write(&dcim.join("100\\IMG_20250312_101500.jpg"), "march photo");
        write(&dcim.join("100\\IMG_20250312_101500.aae"), "march edits");
        write(&dcim.join("100\\IMG_20250401_080000.jpg"), "april");
        write(&dcim.join("101\\IMG_20250401_080000.jpg"), "april");
        write(&dcim.join("100\\IMG_20250502_120000.jpg"), "in japan");
        write(
            &dcim.join("100\\IMG_20250301_090000.jpg"),
            "a different photo",
        );
        write(&dcim.join("100\\IMG_20250601_000000.xmp"), "lonely sidecar");
        write(&card.path().join("notes.txt"), "not a photo");
        card
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

    const IMPORT_BATCH: NewBatch = NewBatch {
        kind: "import",
        label: "test",
        on_begin: None,
    };

    #[test]
    fn viewer_finds_each_previewed_file_and_refuses_a_missing_one() {
        let (lib, db) = library(&[LIBRARY_PHOTO]);
        let root = lib.path();
        let card = card(root);
        let (plan, other_files) = plan_folder(&db, root, card.path(), &[]);
        let looked = Looked {
            spec: SourceSpec::Drive {
                path: card.path().into(),
                name: "Card".into(),
            },
            name: "Card".into(),
            source_root: card.path().into(),
            transfer: Transfer::Copy,
            staging: None,
            plan,
            other_files,
            unreadable: 0,
        };
        let pending = looked.into_pending(7, root);
        let items = &pending.preview.items;
        assert!(!items.is_empty());

        for (n, item) in items.iter().enumerate() {
            let (path, kind) = preview_file(&pending, n).unwrap();
            assert_eq!(path, card.path().join(&item.from), "item {n}");
            assert_eq!(kind, item.kind);
        }
        assert!(preview_file(&pending, items.len()).is_err());
    }

    #[test]
    fn plan_skips_copies_and_places_new_files_by_date_and_trip() {
        let (lib, db) = library(&[LIBRARY_PHOTO]);
        let root = lib.path();
        let card = card(root);
        let (plan, other) = plan_folder(&db, root, card.path(), &[japan()]);

        assert_eq!(
            destinations(&plan, root),
            [
                "2025\\2025-03\\IMG_20250301_090000 (1).jpg",
                "2025\\2025-03\\IMG_20250312_101500.aae",
                "2025\\2025-03\\IMG_20250312_101500.jpg",
                "2025\\2025-04\\IMG_20250401_080000.jpg",
                "Trips\\2025-05-01 Japan\\IMG_20250502_120000.jpg",
            ]
        );
        // The renamed copy and the second April photo are already in; the lone sidecar and
        // the text file stay behind.
        let copy_size = fs::metadata(root.join(LIBRARY_PHOTO)).unwrap().len();
        assert_eq!((plan.already, plan.already_bytes), (2, copy_size + 5));
        assert_eq!((plan.left_alone, other), (1, 1));
        assert_eq!(plan.groups.iter().filter(|g| g.renamed).count(), 1);
        // The April photo that comes in is the first one found.
        let april = plan
            .groups
            .iter()
            .flat_map(|g| &g.files)
            .find(|f| f.to.ends_with("IMG_20250401_080000.jpg"))
            .unwrap();
        assert!(april.from.ends_with("100\\IMG_20250401_080000.jpg"));
    }

    #[test]
    fn copying_leaves_the_card_alone_and_a_second_import_finds_nothing_new() {
        let (lib, db) = library(&[LIBRARY_PHOTO]);
        let root = lib.path();
        let card = card(root);
        let card_before = snapshot(card.path());
        let table = FormatTable::default();
        let cancel = AtomicBool::new(false);

        let (plan, _) = plan_folder(&db, root, card.path(), &[japan()]);
        let summary = executor::import(
            &env(&db, root, &table, &cancel),
            &IMPORT_BATCH,
            &plan.groups,
            Transfer::Copy,
        )
        .unwrap();
        assert_eq!((summary.moved, summary.failed), (5, 0));
        assert_eq!(snapshot(card.path()), card_before);
        assert_eq!(
            fs::read_to_string(root.join("Trips\\2025-05-01 Japan\\IMG_20250502_120000.jpg"))
                .unwrap(),
            "in japan"
        );
        // Every copy is indexed with its hash.
        let rows = index::load_rows(&db.lock().unwrap()).unwrap();
        assert_eq!(rows.len(), 6);
        assert!(
            rows.iter()
                .filter(|r| r.kind != Kind::Companion)
                .all(|r| r.hash.is_some())
        );

        let (again, _) = plan_folder(&db, root, card.path(), &[japan()]);
        assert_eq!(again.file_count(), 0);
        assert_eq!((again.already, again.left_alone), (7, 1));
    }

    #[test]
    fn the_preview_lists_every_group_with_its_date_and_size() {
        let (lib, db) = library(&[LIBRARY_PHOTO]);
        let root = lib.path();
        let card = card(root);
        let (plan, other_files) = plan_folder(&db, root, card.path(), &[japan()]);
        let groups = plan.groups.len();
        let looked = Looked {
            spec: SourceSpec::Folder {
                path: card.path().to_path_buf(),
                move_files: false,
            },
            name: "card".into(),
            source_root: card.path().to_path_buf(),
            transfer: Transfer::Copy,
            staging: None,
            plan,
            other_files,
            unreadable: 0,
        };
        let (preview, thumbs) = describe(7, &looked, root);

        assert_eq!((preview.items.len(), thumbs.len()), (groups, groups));
        for (n, item) in preview.items.iter().enumerate() {
            assert_eq!(item.thumb, format!("i7-{n}"));
        }
        let march = preview
            .items
            .iter()
            .find(|i| i.to.ends_with("IMG_20250312_101500.jpg"))
            .unwrap();
        assert_eq!(march.extra, 1);
        assert_eq!(
            march.bytes,
            ("march photo".len() + "march edits".len()) as u64
        );
        assert_eq!(march.taken_at, "2025-03-12T10:15:00");
        assert_eq!(
            (march.uncertain, march.kind.as_str(), march.ext.as_str()),
            (false, "photo", "jpg")
        );
    }

    #[test]
    fn items_left_out_stay_at_the_source_and_out_of_the_label() {
        let (lib, db) = library(&[LIBRARY_PHOTO]);
        let root = lib.path();
        let card = card(root);
        let table = FormatTable::default();
        let cancel = AtomicBool::new(false);
        let (plan, _) = plan_folder(&db, root, card.path(), &[japan()]);
        let march = plan
            .groups
            .iter()
            .position(|g| {
                g.files
                    .iter()
                    .any(|f| f.to.ends_with("IMG_20250312_101500.jpg"))
            })
            .unwrap();

        // An index past the end is ignored rather than failing the import.
        let chosen = chosen_groups(&plan.groups, &[march, 99]);
        assert_eq!(chosen.len(), plan.groups.len() - 1);
        let files: usize = chosen.iter().map(|g| g.files.len()).sum();
        assert_eq!(
            import_label(Transfer::Copy, files, "EOS_DIGITAL (E:)"),
            "Copied 3 files from EOS_DIGITAL (E:)"
        );
        assert_eq!(
            import_label(Transfer::Move, 1, "C:\\Old"),
            "Moved 1 file in from C:\\Old"
        );

        let summary = executor::import(
            &env(&db, root, &table, &cancel),
            &IMPORT_BATCH,
            &chosen,
            Transfer::Copy,
        )
        .unwrap();
        assert_eq!((summary.moved, summary.failed), (3, 0));
        assert!(!root.join("2025\\2025-03\\IMG_20250312_101500.jpg").exists());
        assert!(!root.join("2025\\2025-03\\IMG_20250312_101500.aae").exists());

        // The photo left out is still new on the next check, with its sidecar.
        let (again, _) = plan_folder(&db, root, card.path(), &[japan()]);
        assert_eq!(
            destinations(&again, root),
            [
                "2025\\2025-03\\IMG_20250312_101500.aae",
                "2025\\2025-03\\IMG_20250312_101500.jpg"
            ]
        );
    }

    #[test]
    fn undoing_a_copy_sends_the_copies_to_the_bin() {
        let (lib, db) = library(&[LIBRARY_PHOTO]);
        let root = lib.path();
        let card = card(root);
        let library_before = snapshot(root);
        let table = FormatTable::default();
        let cancel = AtomicBool::new(false);
        let env = env(&db, root, &table, &cancel);

        let (plan, _) = plan_folder(&db, root, card.path(), &[]);
        let summary = executor::import(&env, &IMPORT_BATCH, &plan.groups, Transfer::Copy).unwrap();
        let landed = root.join("2025\\2025-03\\IMG_20250312_101500.jpg");
        assert!(landed.exists());

        let undone = executor::undo(&env, summary.batch_id).unwrap();
        assert_eq!((undone.restored, undone.failed), (5, 0));
        assert!(!landed.exists() && fake::holds(&landed));
        assert_eq!(snapshot(root), library_before);
        assert_eq!(index::load_rows(&db.lock().unwrap()).unwrap().len(), 1);
    }

    #[test]
    fn a_copy_changed_since_the_check_is_refused() {
        let (lib, db) = library(&[LIBRARY_PHOTO]);
        let root = lib.path();
        let card = tempfile::tempdir().unwrap();
        let photo = card.path().join("IMG_20250312_101500.jpg");
        // Same size as another incoming photo, so the check hashes it.
        write(&photo, "aaaa");
        write(&card.path().join("IMG_20250313_101500.jpg"), "bbbb");
        let (plan, _) = plan_folder(&db, root, card.path(), &[]);
        write(&photo, "cccc");

        let table = FormatTable::default();
        let cancel = AtomicBool::new(false);
        let summary = executor::import(
            &env(&db, root, &table, &cancel),
            &IMPORT_BATCH,
            &plan.groups,
            Transfer::Copy,
        )
        .unwrap();
        assert_eq!((summary.moved, summary.failed), (1, 1));
        assert!(!root.join("2025\\2025-03\\IMG_20250312_101500.jpg").exists());
        assert!(root.join("2025\\2025-03\\IMG_20250313_101500.jpg").exists());
    }

    #[test]
    fn moving_a_folder_in_and_undoing_puts_every_file_back() {
        let (lib, db) = library(&[LIBRARY_PHOTO]);
        let root = lib.path();
        let card = card(root);
        let card_before = snapshot(card.path());
        let library_before = snapshot(root);
        let table = FormatTable::default();
        let cancel = AtomicBool::new(false);
        let env = env(&db, root, &table, &cancel);
        let batch = NewBatch {
            kind: "import_move",
            ..IMPORT_BATCH
        };

        let (plan, _) = plan_folder(&db, root, card.path(), &[japan()]);
        let summary = executor::import(&env, &batch, &plan.groups, Transfer::Move).unwrap();
        assert_eq!(summary.moved, 5);
        // Copies of library files and the lone sidecar stay where they were.
        let left: Vec<String> = snapshot(card.path())
            .into_iter()
            .map(|(p, _, _)| p)
            .collect();
        assert_eq!(
            left,
            [
                "DCIM\\100\\IMG_20250601_000000.xmp",
                "DCIM\\100\\renamed copy.jpg",
                "DCIM\\101\\IMG_20250401_080000.jpg",
                "notes.txt",
            ]
        );

        let undone = executor::undo(&env, summary.batch_id).unwrap();
        assert_eq!((undone.restored, undone.failed), (5, 0));
        assert_eq!(snapshot(card.path()), card_before);
        assert_eq!(snapshot(root), library_before);
        assert_eq!(index::load_rows(&db.lock().unwrap()).unwrap().len(), 1);
    }

    #[test]
    fn a_library_inside_the_source_folder_is_left_out() {
        let outer = tempfile::tempdir().unwrap();
        let root = outer.path().join("Library");
        write(&root.join(LIBRARY_PHOTO), "inside the library");
        write(&outer.path().join("IMG_20250312_101500.jpg"), "new");
        let db = Mutex::new(db::open_in_memory().unwrap());
        let (plan, _) = plan_folder(&db, &root, outer.path(), &[]);
        assert_eq!(
            destinations(&plan, &root),
            ["2025\\2025-03\\IMG_20250312_101500.jpg"]
        );
    }

    #[test]
    fn empty_files_are_left_out_and_counted() {
        let (lib, db) = library(&[LIBRARY_PHOTO]);
        let root = lib.path();
        let card = tempfile::tempdir().unwrap();
        write(
            &card.path().join("DCIM\\IMG_20250312_101500.jpg"),
            "march photo",
        );
        // What a copy that didn't finish leaves behind.
        write(&card.path().join("DCIM\\IMG_20250313_101500.jpg"), "");
        let (plan, _) = plan_folder(&db, root, card.path(), &[]);
        assert_eq!(
            destinations(&plan, root),
            ["2025\\2025-03\\IMG_20250312_101500.jpg"]
        );
        assert_eq!(plan.empty, 1);
    }

    #[test]
    fn a_file_the_phone_refuses_stays_there_with_its_partners() {
        // Sets: a Live Photo whose video (1) always fails, a photo (2) that fails once, and (3).
        let sets = [vec![0, 1], vec![2], vec![3]];
        let mut asked = HashMap::<usize, usize>::new();
        let copied = copy_off(&sets, &AtomicBool::new(false), |i, _| {
            let n = asked.entry(i).or_default();
            *n += 1;
            Ok(match (i, *n) {
                (1, _) | (2, 1) => Err(Error::msg("The device stopped responding")),
                _ => Ok(i),
            })
        })
        .unwrap();
        assert_eq!(copied.files, [2, 3]);
        assert_eq!(copied.unreadable, 1);
        assert_eq!(asked[&1], 2);
    }

    #[test]
    fn a_phone_that_stops_answering_ends_the_check() {
        let sets: Vec<Vec<usize>> = (0..10).map(|i| vec![i]).collect();
        let copied = copy_off(&sets, &AtomicBool::new(false), |i, _| {
            Ok(if i == 0 {
                Ok(i)
            } else {
                Err(Error::msg("The device is no longer connected"))
            })
        });
        let err = copied.err().expect("the check should give up");
        assert!(err.to_string().contains("no longer connected"));
    }

    #[test]
    fn a_phone_that_goes_away_near_the_end_ends_the_check() {
        let sets: Vec<Vec<usize>> = (0..4).map(|i| vec![i]).collect();
        let copied = copy_off(&sets, &AtomicBool::new(false), |i, _| {
            Ok(if i < 2 {
                Ok(i)
            } else {
                Err(Error::msg("The device is no longer connected"))
            })
        });
        assert!(
            copied.is_err(),
            "two failures at the end are a phone gone, not two bad files"
        );
    }

    #[test]
    fn a_problem_on_this_pc_stops_the_check_at_once() {
        let sets: Vec<Vec<usize>> = (0..3).map(|i| vec![i]).collect();
        let mut asked = 0;
        let copied = copy_off(
            &sets,
            &AtomicBool::new(false),
            |_, _| -> Result<Result<usize>> {
                asked += 1;
                Err(Error::msg("There is not enough space on the disk"))
            },
        );
        assert!(
            copied
                .err()
                .unwrap()
                .to_string()
                .contains("not enough space")
        );
        assert_eq!(asked, 1);
    }
}
