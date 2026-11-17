// Inbox folders: photos and videos saved into them are moved into the library on their own,
// once they have finished arriving. Each run is one History batch that can be undone, and a
// file that undo put back stays where it is.
//
// Folder events only say that something changed, not that a copy has finished, so every file
// they mention is kept in `Arrivals` and looked at once a second until its size and modified
// time have held still for `QUIET` and no other program is writing to it.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::sync::atomic::AtomicBool;
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::time::{Duration, Instant};

use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher as _};
use rusqlite::Connection;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_notification::NotificationExt;

use crate::AppState;
use crate::commands::{format_table, lock_db};
use crate::db;
use crate::error::{Error, Result};
use crate::executor::{self, ApplySummary, Env, NewBatch, Transfer};
use crate::exiftool;
use crate::formats::{FormatTable, Kind};
use crate::groups::MediaRow;
use crate::import::{self, Ctx, Found, Late};
use crate::index;
use crate::jobs::{self, Jobs};
use crate::index::path_key;
use crate::planner::is_inside;
use crate::scan::{self, ScannedFile};
use crate::menu;
use crate::naming::Naming;
use crate::tray;
use crate::trips;

/// A file counts as arrived once its size and modified time have held still this long.
const QUIET: Duration = Duration::from_secs(5);
/// How long a photo or RAW holds still instead, since its Live Photo video, RAW twin or sidecar
/// is often saved a few seconds after it, and arriving together keeps them one batch.
const LEAD_QUIET: Duration = Duration::from_secs(20);
/// While other files are still arriving, an arrived file waits this long at most before it
/// goes in without them.
const MAX_WAIT: Duration = Duration::from_secs(60);
/// How often waiting files are looked at.
const TICK: Duration = Duration::from_secs(1);
/// How often to check whether an inbox folder's drive has been plugged in or out.
const RECHECK: Duration = Duration::from_secs(30);
/// Settings keys: a JSON list of folder paths, and "true" while watching is paused.
const FOLDERS_KEY: &str = "inbox_folders";
const PAUSED_KEY: &str = "watch_paused";
/// Sent with a [`WatchStatus`] whenever it changes.
const CHANGED_EVENT: &str = "watch://changed";

/// What the Settings page shows about the inbox folders.
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchStatus {
    /// Folders being watched (or that would be, when paused).
    pub folders: Vec<String>,
    /// Inbox folders that can't be found, so aren't watched.
    pub missing: Vec<String>,
    pub paused: bool,
    /// Files seen arriving that haven't settled yet.
    pub waiting: usize,
}

#[derive(Debug, Clone, Copy)]
struct Seen {
    size: u64,
    mtime: i64,
    /// When the size or modified time last changed.
    changed: Instant,
    first: Instant,
    /// How long it must hold still: [`QUIET`] or [`LEAD_QUIET`].
    quiet: Duration,
}

/// Files seen arriving in the inbox folders and when each last changed.
#[derive(Debug, Default)]
struct Arrivals {
    files: HashMap<PathBuf, Seen>,
}

impl Arrivals {
    /// Note a file's size and modified time. A change starts its quiet period again. `quiet`
    /// only counts for a file not seen before.
    fn see(&mut self, path: PathBuf, size: u64, mtime: i64, quiet: Duration, now: Instant) {
        match self.files.get_mut(&path) {
            Some(seen) if seen.size == size && seen.mtime == mtime => {}
            Some(seen) => {
                seen.size = size;
                seen.mtime = mtime;
                seen.changed = now;
            }
            None => {
                self.files.insert(path, Seen { size, mtime, changed: now, first: now, quiet });
            }
        }
    }

    /// Start a file's quiet period again, as when another program still has it open.
    fn still_changing(&mut self, path: &Path, now: Instant) {
        if let Some(seen) = self.files.get_mut(path) {
            seen.changed = now;
        }
    }

    fn is_quiet(seen: &Seen, now: Instant) -> bool {
        now.duration_since(seen.changed) >= seen.quiet
    }

    /// Remove and return the files ready to go in. Once every file is quiet they all go, so a
    /// photo and its companions copied together go in together. While something is still
    /// arriving, only quiet files that have waited past [`MAX_WAIT`] go.
    fn take_ready(&mut self, now: Instant) -> Vec<PathBuf> {
        let all_quiet = self.files.values().all(|seen| Self::is_quiet(seen, now));
        let mut ready: Vec<PathBuf> = self
            .files
            .iter()
            .filter(|(_, seen)| {
                Self::is_quiet(seen, now) && (all_quiet || now.duration_since(seen.first) >= MAX_WAIT)
            })
            .map(|(path, _)| path.clone())
            .collect();
        for path in &ready {
            self.files.remove(path);
        }
        ready.sort();
        ready
    }
}

#[derive(Default)]
struct Inner {
    /// Dropped to stop watching. Replaced as a whole when the settings change.
    watcher: Option<RecommendedWatcher>,
    folders: Vec<PathBuf>,
    missing: Vec<PathBuf>,
    root: Option<PathBuf>,
    table: FormatTable,
    paused: bool,
    /// The folders should be looked through in full: at start, on resuming, after a change.
    catch_up: bool,
    arrivals: Arrivals,
    /// The status last sent, so an unchanged one isn't sent again every tick.
    sent: Option<WatchStatus>,
}

impl Inner {
    fn status(&self) -> WatchStatus {
        let text = |paths: &[PathBuf]| paths.iter().map(|p| p.display().to_string()).collect();
        WatchStatus {
            folders: text(&self.folders),
            missing: text(&self.missing),
            paused: self.paused,
            waiting: self.arrivals.files.len(),
        }
    }

    /// The inbox folder holding `path`, unless it is inside the library or a skipped folder.
    fn inbox_of(&self, path: &Path) -> Option<&PathBuf> {
        if self.root.as_deref().is_some_and(|root| is_inside(path, root)) {
            return None;
        }
        let folder = self.folders.iter().find(|f| is_inside(path, f))?;
        let inside = path.strip_prefix(folder).ok()?;
        let parent = inside.parent().unwrap_or(Path::new(""));
        let skipped = parent
            .components()
            .any(|c| scan::skip_dir(&c.as_os_str().to_string_lossy()));
        (!skipped).then_some(folder)
    }
}

/// Managed state: the inbox watcher and the files it is waiting on.
pub struct Watch {
    inner: Mutex<Inner>,
    /// Folder events, handed to the worker thread. The watcher's callback only ever sends
    /// here, so it never waits on `inner` while the watcher is being replaced.
    events: Sender<notify::Result<Event>>,
}

impl Watch {
    fn lock(&self) -> Result<std::sync::MutexGuard<'_, Inner>> {
        self.inner.lock().map_err(|_| Error::msg("Watcher lock poisoned"))
    }
}

/// Start watching the inbox folders from Settings, and the thread that sorts what arrives.
pub fn start(app: &AppHandle) {
    let (events, received) = mpsc::channel();
    app.manage(Watch {
        inner: Mutex::new(Inner::default()),
        events,
    });
    reload(app);
    let handle = app.clone();
    let spawned = std::thread::Builder::new()
        .name("inbox-watch".into())
        .spawn(move || run(&handle, &received));
    if let Err(err) = spawned {
        log::error!("Couldn't start watching the inbox folders: {err}");
    }
}

/// Read the inbox settings again and watch accordingly. Called at start and whenever the
/// folders, the library or the file types change.
pub fn reload(app: &AppHandle) {
    if let Err(err) = try_reload(app) {
        log::error!("Couldn't watch the inbox folders: {err}");
    }
}

fn try_reload(app: &AppHandle) -> Result<()> {
    let (folders, paused, root, table) = {
        let state = app.state::<AppState>();
        let conn = lock_db(&state)?;
        (
            inbox_folders(&conn)?,
            db::get_bool(&conn, PAUSED_KEY, false)?,
            db::get_setting(&conn, "library_root")?.map(PathBuf::from),
            format_table(&conn)?,
        )
    };
    let watch = app.state::<Watch>();
    let (existing, missing): (Vec<PathBuf>, Vec<PathBuf>) = folders.into_iter().partition(|f| f.is_dir());
    // Without a library there is nowhere to sort into.
    let watcher = if root.is_some() && !existing.is_empty() {
        let events = watch.events.clone();
        let mut watcher = notify::recommended_watcher(move |event| {
            let _ = events.send(event);
        })
        .map_err(|err| Error::msg(format!("Couldn't watch the inbox folders: {err}")))?;
        for folder in &existing {
            if let Err(err) = watcher.watch(folder, RecursiveMode::Recursive) {
                log::warn!("Couldn't watch {}: {err}", folder.display());
            }
        }
        Some(watcher)
    } else {
        None
    };
    let old = {
        let mut inner = watch.lock()?;
        let old = std::mem::replace(&mut inner.watcher, watcher);
        inner.folders = existing;
        inner.missing = missing;
        inner.root = root;
        inner.table = table;
        inner.paused = paused;
        inner.catch_up = true;
        inner.arrivals = Arrivals::default();
        old
    };
    // Stopping the old watcher waits for its thread, so it happens outside the lock.
    drop(old);
    send_status(app);
    Ok(())
}

/// The inbox folders saved in Settings.
pub fn inbox_folders(conn: &Connection) -> Result<Vec<PathBuf>> {
    let Some(text) = db::get_setting(conn, FOLDERS_KEY)? else {
        return Ok(Vec::new());
    };
    if text.trim().is_empty() {
        return Ok(Vec::new());
    }
    let list: Vec<String> =
        serde_json::from_str(&text).map_err(|err| Error::msg(format!("Inbox folders aren't readable: {err}")))?;
    Ok(list.into_iter().map(PathBuf::from).collect())
}

/// Check a new inbox folder list from Settings before it is saved. Each folder must be outside
/// the library and not inside another inbox folder. Folders being added must exist; ones already
/// in `saved` may be missing (a drive that's unplugged), so the rest of the list can still change.
pub fn check_folders(text: &str, root: Option<&Path>, saved: &[PathBuf]) -> Result<()> {
    let list: Vec<String> =
        serde_json::from_str(text).map_err(|_| Error::msg("Inbox folders must be a list of folders"))?;
    let folders: Vec<PathBuf> = list.into_iter().map(PathBuf::from).collect();
    for (i, folder) in folders.iter().enumerate() {
        let shown = folder.display();
        let was_saved = saved.iter().any(|old| path_key(old) == path_key(folder));
        if !folder.is_absolute() || (!was_saved && !folder.is_dir()) {
            return Err(Error::msg(format!("{shown} can't be found")));
        }
        if root.is_some_and(|root| is_inside(folder, root)) {
            return Err(Error::msg(format!(
                "{shown} is inside your library. Choose a folder outside it; photos already in the library are sorted from the Sort page."
            )));
        }
        if let Some(outer) = folders
            .iter()
            .enumerate()
            .find(|(j, other)| *j != i && is_inside(folder, other))
        {
            return Err(Error::msg(format!(
                "{shown} is already watched as part of {}",
                outer.1.display()
            )));
        }
    }
    Ok(())
}

/// The watcher's state, for the Settings page.
#[tauri::command]
pub fn watch_status(watch: State<Watch>) -> Result<WatchStatus> {
    Ok(watch.lock()?.status())
}

/// Pause or resume watching, from Settings or the tray. Files that arrived while paused are
/// picked up on resuming.
#[tauri::command]
pub fn set_watch_paused(app: AppHandle, paused: bool) -> Result<WatchStatus> {
    {
        let state = app.state::<AppState>();
        db::set_setting(&*lock_db(&state)?, PAUSED_KEY, if paused { "true" } else { "false" })?;
    }
    let watch = app.state::<Watch>();
    {
        let mut inner = watch.lock()?;
        inner.paused = paused;
        if paused {
            inner.arrivals = Arrivals::default();
        } else {
            inner.catch_up = true;
        }
    }
    send_status(&app);
    watch_status(watch)
}

/// The tray's "Pause watching" / "Resume watching" item.
pub fn toggle_pause(app: &AppHandle) {
    let paused = app
        .state::<Watch>()
        .lock()
        .map(|inner| inner.paused)
        .unwrap_or(false);
    if let Err(err) = set_watch_paused(app.clone(), !paused) {
        log::error!("Couldn't change watching: {err}");
    }
}

/// Send the status to the page and match the tray and menu to it, when it has changed.
fn send_status(app: &AppHandle) {
    let watch = app.state::<Watch>();
    let Ok(mut inner) = watch.lock() else { return };
    let status = inner.status();
    if inner.sent.as_ref() == Some(&status) {
        return;
    }
    let watching = !status.folders.is_empty() && inner.watcher.is_some();
    inner.sent = Some(status.clone());
    drop(inner);
    tray::set_watch_state(app, watching.then_some(status.paused));
    menu::show_watch_state(app, watching.then_some(status.paused));
    let _ = app.emit(CHANGED_EVENT, status);
}

/// The worker: take in folder events as they come, look at waiting files every [`TICK`], and
/// watch again when an inbox folder's drive is plugged in or out (checked every [`RECHECK`]).
fn run(app: &AppHandle, received: &Receiver<notify::Result<Event>>) {
    let mut last_tick = Instant::now();
    let mut last_recheck = Instant::now();
    loop {
        if last_recheck.elapsed() >= RECHECK {
            last_recheck = Instant::now();
            let folders = app
                .state::<Watch>()
                .lock()
                .map(|inner| (inner.folders.clone(), inner.missing.clone()));
            // The folders are looked at outside the lock: a network drive can be slow to answer.
            if let Ok((watched, missing)) = folders
                && came_or_went(&watched, &missing)
            {
                reload(app);
            }
        }
        match received.recv_timeout(TICK) {
            Ok(Ok(event)) => note_event(app, &event),
            Ok(Err(err)) => log::warn!("Inbox watch error: {err}"),
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => return,
        }
        // Events can arrive faster than once a second, so ticks go by the clock.
        if last_tick.elapsed() >= TICK {
            last_tick = Instant::now();
            if let Err(err) = tick(app) {
                log::error!("Inbox watch failed: {err}");
            }
        }
    }
}

/// True when a watched folder has gone or a missing one is back, as when its drive is unplugged
/// or plugged in again.
fn came_or_went(watched: &[PathBuf], missing: &[PathBuf]) -> bool {
    watched.iter().any(|f| !f.is_dir()) || missing.iter().any(|f| f.is_dir())
}

/// Note the files an event mentions. A folder moved in whole is looked through, since only the
/// folder itself is reported.
fn note_event(app: &AppHandle, event: &Event) {
    if !matches!(event.kind, EventKind::Create(_) | EventKind::Modify(_) | EventKind::Any) {
        return;
    }
    let watch = app.state::<Watch>();
    let Ok(mut inner) = watch.lock() else { return };
    if inner.paused {
        return;
    }
    let now = Instant::now();
    for path in &event.paths {
        if inner.inbox_of(path).is_none() {
            continue;
        }
        let Ok(meta) = fs::metadata(path) else { continue };
        if meta.is_dir() {
            let found = scan::scan(path, &inner.table, &AtomicBool::new(false));
            for file in found.map(|r| r.files).unwrap_or_default() {
                if inner.inbox_of(&file.path).is_some() {
                    let quiet = quiet_for(&file.path, &inner.table);
                    inner.arrivals.see(file.path, file.size, file.mtime, quiet, now);
                }
            }
        } else if scan::file_kind(path, &inner.table).is_some() {
            let quiet = quiet_for(path, &inner.table);
            inner.arrivals.see(path.clone(), meta.len(), scan::mtime_secs(&meta), quiet, now);
        }
    }
}

/// Look at the waiting files and sort the ones that have arrived.
fn tick(app: &AppHandle) -> Result<()> {
    let watch = app.state::<Watch>();
    let catch_up = {
        let mut inner = watch.lock()?;
        if inner.paused || inner.watcher.is_none() {
            drop(inner);
            send_status(app);
            return Ok(());
        }
        std::mem::take(&mut inner.catch_up).then(|| (inner.folders.clone(), inner.root.clone(), inner.table.clone()))
    };
    // Everything already in the folders, e.g. saved while Pic Cabinet was closed. The walk
    // happens outside the lock so events keep flowing.
    if let Some((folders, root, table)) = catch_up {
        let never = AtomicBool::new(false);
        let mut files = Vec::new();
        for folder in &folders {
            match scan::scan_excluding(folder, root.as_deref(), &table, &never) {
                Ok(found) => files.extend(found.files),
                Err(err) => log::warn!("Couldn't look through {}: {err}", folder.display()),
            }
        }
        let now = Instant::now();
        let mut inner = watch.lock()?;
        for file in files {
            if inner.inbox_of(&file.path).is_some() {
                let quiet = quiet_for(&file.path, &inner.table);
                inner.arrivals.see(file.path, file.size, file.mtime, quiet, now);
            }
        }
    }

    let now = Instant::now();
    let ready = {
        let mut inner = watch.lock()?;
        let paths: Vec<PathBuf> = inner.arrivals.files.keys().cloned().collect();
        for path in paths {
            match fs::metadata(&path) {
                Ok(meta) if meta.is_file() => {
                    // Already waiting, so its quiet period was set when it was first seen.
                    inner.arrivals.see(path.clone(), meta.len(), scan::mtime_secs(&meta), QUIET, now);
                    let quiet = inner.arrivals.files.get(&path).is_some_and(|s| Arrivals::is_quiet(s, now));
                    if quiet && being_written(&path) {
                        inner.arrivals.still_changing(&path, now);
                    }
                }
                // Gone again (moved on, or a temporary file), or replaced by a folder.
                _ => {
                    inner.arrivals.files.remove(&path);
                }
            }
        }
        // Another task has the library; try again on a later tick.
        if app.state::<Jobs>().is_running() {
            Vec::new()
        } else {
            inner.arrivals.take_ready(now)
        }
    };
    if !ready.is_empty()
        && let Err(err) = start_sorting(app, ready.clone())
    {
        log::info!("Inbox files wait for the next try: {err}");
        let mut inner = watch.lock()?;
        let now = Instant::now();
        for path in ready {
            if let Ok(meta) = fs::metadata(&path) {
                let quiet = quiet_for(&path, &inner.table);
                inner.arrivals.see(path, meta.len(), scan::mtime_secs(&meta), quiet, now);
            }
        }
    }
    send_status(app);
    Ok(())
}

/// How long a file must hold still before it counts as arrived.
fn quiet_for(path: &Path, table: &FormatTable) -> Duration {
    match table.kind_of(path) {
        Some(Kind::Photo | Kind::Raw) => LEAD_QUIET,
        _ => QUIET,
    }
}

/// True while another program has the file open for writing, as during a copy that pauses.
#[cfg(windows)]
fn being_written(path: &Path) -> bool {
    use std::os::windows::fs::OpenOptionsExt;
    const FILE_SHARE_READ: u32 = 1;
    const ERROR_SHARING_VIOLATION: i32 = 32;
    // Asking to share with readers only fails when someone else can write to it.
    match fs::OpenOptions::new().read(true).share_mode(FILE_SHARE_READ).open(path) {
        Ok(_) => false,
        Err(err) => err.raw_os_error() == Some(ERROR_SHARING_VIOLATION),
    }
}

#[cfg(not(windows))]
fn being_written(_path: &Path) -> bool {
    false
}

/// Move `paths` into the library in the background, as job kind `inbox`.
fn start_sorting(app: &AppHandle, paths: Vec<PathBuf>) -> Result<()> {
    let state = app.state::<AppState>();
    let (root, table, trips, naming) = {
        let conn = lock_db(&state)?;
        (
            crate::commands::library_root(&conn)?,
            format_table(&conn)?,
            trips::load(&conn)?,
            Naming::load(&conn)?,
        )
    };
    let folders = app.state::<Watch>().lock()?.folders.clone();
    let exiftool = app
        .path()
        .resource_dir()
        .ok()
        .and_then(|dir| exiftool::locate(&dir));
    let handle = app.clone();
    jobs::start(app, "inbox", move |job| {
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
        let summary = sort_in(&ctx, &folders, &paths)?;
        if let Some(summary) = &summary
            && summary.moved > 0
        {
            notify_sorted(&handle, summary.moved);
        }
        Ok(summary)
    })
}

/// Move the files at `paths`, all inside `inboxes`, into the library as one batch. Copies of
/// library photos stay where they are, as with any folder moved in, and so do files that undo
/// put back. Returns `None` when nothing went in.
fn sort_in(ctx: &Ctx, inboxes: &[PathBuf], paths: &[PathBuf]) -> Result<Option<ApplySummary>> {
    let kept = put_back_by_undo(&*lock(ctx.db)?)?;
    let found: Vec<Found> = paths
        .iter()
        .filter_map(|path| {
            let kind = scan::file_kind(path, ctx.table)?;
            let meta = fs::metadata(path).ok().filter(fs::Metadata::is_file)?;
            let file = ScannedFile {
                path: path.clone(),
                kind,
                size: meta.len(),
                mtime: scan::mtime_secs(&meta),
            };
            let key = (path_key(path), file.size, file.mtime);
            (!kept.contains(&key)).then(|| Found {
                origin: path.clone(),
                file,
                hash: None,
            })
        })
        .collect();
    if found.is_empty() {
        return Ok(None);
    }
    let exists = |p: &Path| fs::symlink_metadata(p).is_ok();
    let (late, mut found) = split_late(&*lock(ctx.db)?, found, ctx.table)?;
    let (beside, not_late) = import::plan_beside(ctx, late, &exists)?;
    found.extend(not_late);
    let mut groups = import::plan(ctx, found, &exists)?.groups;
    groups.extend(beside);
    if groups.is_empty() {
        return Ok(None);
    }
    let files: usize = groups.iter().map(|g| g.files.len()).sum();
    let files = format!("{files} {}", if files == 1 { "file" } else { "files" });
    let from: HashSet<&PathBuf> = groups
        .iter()
        .flat_map(|g| &g.files)
        .filter_map(|f| inboxes.iter().find(|inbox| is_inside(&f.origin, inbox)))
        .collect();
    let label = match from.iter().next() {
        Some(inbox) if from.len() == 1 => format!("Moved {files} in from the inbox {}", inbox.display()),
        _ => format!("Moved {files} in from {} inbox folders", from.len()),
    };
    let env = Env {
        db: ctx.db,
        root: ctx.root,
        table: ctx.table,
        cancel: ctx.cancel,
        report: ctx.report,
    };
    let batch = NewBatch {
        kind: "import_move",
        label: &label,
        on_begin: None,
    };
    executor::import(&env, &batch, &groups, Transfer::Move).map(Some)
}

/// How long after its partners were filed a file can still join them. The halves of a Live
/// Photo or a RAW+JPEG pair arrive seconds or minutes apart; the same name much later is
/// usually a camera's counter come round again.
const LATE_WINDOW_SECS: i64 = 60 * 60;

/// Split arrivals into sets of same-name files whose name was filed from the same folder by a
/// move-in within the last hour (a Live Photo video saved after its photo), with the library
/// files those became, and the rest.
///
/// A set is late only when it holds nothing the filed files already have: an arriving photo
/// beside a filed photo is a new picture, and any clip or sidecar that came with it belongs to
/// it, not to the old one.
fn split_late(conn: &Connection, found: Vec<Found>, table: &FormatTable) -> Result<(Vec<Late>, Vec<Found>)> {
    let mut sets: BTreeMap<String, Vec<Found>> = BTreeMap::new();
    for f in found {
        sets.entry(scan::group_key(&f.file.path, f.file.kind, table)).or_default().push(f);
    }
    let mut filed: HashMap<String, Vec<MediaRow>> = HashMap::new();
    let mut stmt = conn.prepare(
        "SELECT j.src, j.dst, j.media_id FROM journal j JOIN batches b ON b.id = j.batch_id
         WHERE j.op = 'import' AND j.status = 'done' AND j.media_id IS NOT NULL
           AND b.created_at >= ?1",
    )?;
    let rows = stmt.query_map([db::now() - LATE_WINDOW_SECS], |r| {
        Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, i64>(2)?))
    })?;
    for (src, dst, id) in rows.filter_map(|r| r.ok()) {
        let src = Path::new(&src);
        // The file has left the inbox, so its kind comes from its name alone.
        let kind = table.kind_of(src).unwrap_or(Kind::Companion);
        let key = scan::group_key(src, kind, table);
        // Ids are reused once a row is deleted, so the row must still be the file filed.
        if sets.contains_key(&key)
            && let Some(row) = index::load_row(conn, id)?
            && path_key(&row.path) == path_key(Path::new(&dst))
        {
            filed.entry(key).or_default().push(row);
        }
    }
    let (mut late, mut rest) = (Vec::new(), Vec::new());
    for (key, files) in sets {
        let Some(rows) = filed.remove(&key) else {
            rest.extend(files);
            continue;
        };
        let mut kinds = HashSet::new();
        let fits = files
            .iter()
            .filter(|f| f.file.kind != Kind::Companion)
            .all(|f| kinds.insert(f.file.kind) && rows.iter().all(|r| r.kind != f.file.kind));
        if fits {
            late.push(Late { found: files, filed: rows });
        } else {
            rest.extend(files);
        }
    }
    Ok((late, rest))
}

/// Files that an undone move-in put back, by path (as [`path_key`]), size and modified time.
/// A file changed since then counts as new.
fn put_back_by_undo(conn: &Connection) -> Result<HashSet<(String, u64, i64)>> {
    let mut stmt = conn.prepare("SELECT src, media_row FROM journal WHERE op = 'import' AND status = 'undone'")?;
    let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?)))?;
    let mut kept = HashSet::new();
    for (src, row) in rows.filter_map(|r| r.ok()) {
        let Some(row) = row.and_then(|r| serde_json::from_str::<serde_json::Value>(&r).ok()) else {
            continue;
        };
        if let (Some(size), Some(mtime)) = (row["size"].as_u64(), row["mtime"].as_i64()) {
            kept.insert((path_key(Path::new(&src)), size, mtime));
        }
    }
    Ok(kept)
}

fn lock(db: &Mutex<Connection>) -> Result<std::sync::MutexGuard<'_, Connection>> {
    db.lock().map_err(|_| Error::msg("Database lock poisoned"))
}

/// Say that new photos were sorted, unless the window is open in front of the user.
fn notify_sorted(app: &AppHandle, moved: usize) {
    let in_front = app
        .get_webview_window("main")
        .is_some_and(|w| w.is_visible().unwrap_or(false) && w.is_focused().unwrap_or(false));
    if in_front {
        return;
    }
    let (title, body) = sorted_message(moved);
    let shown = app.notification().builder().title(title).body(body).show();
    if let Err(err) = shown {
        log::warn!("Couldn't show the inbox notification: {err}");
    }
}

/// Title and body for {@link notify_sorted}, worded for one file or several.
fn sorted_message(moved: usize) -> (String, String) {
    if moved == 1 {
        (
            "Sorted 1 new file into your library".to_owned(),
            "It came from an inbox folder. History can undo it.".to_owned(),
        )
    } else {
        (
            format!("Sorted {moved} new files into your library"),
            "They came from an inbox folder. History can undo it.".to_owned(),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::executor::testing::{library, no_report, snapshot};
    use crate::import::testing::write;

    #[test]
    fn the_notification_matches_the_number_of_files() {
        assert_eq!(
            sorted_message(1),
            (
                "Sorted 1 new file into your library".to_owned(),
                "It came from an inbox folder. History can undo it.".to_owned()
            )
        );
        assert_eq!(
            sorted_message(6),
            (
                "Sorted 6 new files into your library".to_owned(),
                "They came from an inbox folder. History can undo it.".to_owned()
            )
        );
    }

    #[test]
    fn a_file_goes_in_once_it_has_held_still() {
        let start = Instant::now();
        let mut arrivals = Arrivals::default();
        let photo = PathBuf::from("C:\\Inbox\\IMG_0001.jpg");
        arrivals.see(photo.clone(), 100, 1, QUIET, start);
        assert!(arrivals.take_ready(start + Duration::from_secs(4)).is_empty());
        // Still growing: the wait starts again.
        arrivals.see(photo.clone(), 200, 2, QUIET, start + Duration::from_secs(4));
        assert!(arrivals.take_ready(start + Duration::from_secs(8)).is_empty());
        assert_eq!(arrivals.take_ready(start + Duration::from_secs(9)), [photo]);
        assert!(arrivals.files.is_empty());
    }

    #[test]
    fn files_arriving_together_go_in_together() {
        let start = Instant::now();
        let mut arrivals = Arrivals::default();
        let photo = PathBuf::from("C:\\Inbox\\IMG_0001.heic");
        let video = PathBuf::from("C:\\Inbox\\IMG_0001.mov");
        arrivals.see(photo.clone(), 100, 1, QUIET, start);
        arrivals.see(video.clone(), 10, 1, QUIET, start + Duration::from_secs(3));
        // The photo has settled but its video is still copying.
        assert!(arrivals.take_ready(start + Duration::from_secs(6)).is_empty());
        assert_eq!(arrivals.take_ready(start + Duration::from_secs(8)), [photo, video]);
    }

    #[test]
    fn a_settled_file_stops_waiting_for_a_slow_one() {
        let start = Instant::now();
        let mut arrivals = Arrivals::default();
        let photo = PathBuf::from("C:\\Inbox\\a.jpg");
        let video = PathBuf::from("C:\\Inbox\\b.mp4");
        arrivals.see(photo.clone(), 100, 1, QUIET, start);
        arrivals.see(video.clone(), 1, 1, QUIET, start);
        for second in 1..=60 {
            arrivals.see(video.clone(), 1 + second, 1, QUIET, start + Duration::from_secs(second));
        }
        assert_eq!(arrivals.take_ready(start + Duration::from_secs(60)), [photo]);
        assert_eq!(arrivals.files.len(), 1);
    }

    #[test]
    fn a_photo_waits_longer_for_its_partners() {
        let table = FormatTable::default();
        let photo = PathBuf::from("C:\\Inbox\\IMG_0001.heic");
        let video = PathBuf::from("C:\\Inbox\\IMG_0001.mov");
        assert_eq!(quiet_for(&photo, &table), LEAD_QUIET);
        assert_eq!(quiet_for(&video, &table), QUIET);

        let start = Instant::now();
        let mut arrivals = Arrivals::default();
        arrivals.see(photo.clone(), 100, 1, LEAD_QUIET, start);
        // Its Live Photo video starts copying ten seconds later, and both go in together.
        assert!(arrivals.take_ready(start + Duration::from_secs(9)).is_empty());
        arrivals.see(video.clone(), 10, 1, QUIET, start + Duration::from_secs(10));
        assert!(arrivals.take_ready(start + Duration::from_secs(16)).is_empty());
        assert_eq!(arrivals.take_ready(start + Duration::from_secs(20)), [photo, video]);
    }

    #[test]
    fn a_file_held_open_keeps_waiting() {
        let start = Instant::now();
        let mut arrivals = Arrivals::default();
        let photo = PathBuf::from("C:\\Inbox\\IMG_0001.jpg");
        arrivals.see(photo.clone(), 100, 1, QUIET, start);
        arrivals.still_changing(&photo, start + Duration::from_secs(5));
        assert!(arrivals.take_ready(start + Duration::from_secs(9)).is_empty());
        assert_eq!(arrivals.take_ready(start + Duration::from_secs(10)), [photo]);
    }

    #[cfg(windows)]
    #[test]
    fn a_file_open_for_writing_is_being_written() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("IMG_0001.jpg");
        let open = fs::File::create(&path).unwrap();
        assert!(being_written(&path));
        drop(open);
        assert!(!being_written(&path));
    }

    #[test]
    fn inbox_folders_are_checked_before_saving() {
        let lib = tempfile::tempdir().unwrap();
        let inbox = tempfile::tempdir().unwrap();
        let inner = inbox.path().join("Phone");
        fs::create_dir_all(&inner).unwrap();
        let list = |paths: &[&Path]| serde_json::to_string(&paths).unwrap();

        assert!(check_folders(&list(&[inbox.path()]), Some(lib.path()), &[]).is_ok());
        assert!(check_folders("[]", Some(lib.path()), &[]).is_ok());
        let err = |text: &str| check_folders(text, Some(lib.path()), &[]).unwrap_err().to_string();
        assert!(err(&list(&[lib.path()])).contains("inside your library"));
        assert!(err(&list(&[&lib.path().join("2025")])).contains("can't be found"));
        assert!(err(&list(&[inbox.path(), &inner])).contains("already watched as part of"));
        assert!(err("C:\\Inbox").contains("list of folders"));
    }

    #[test]
    fn a_drive_coming_back_or_going_restarts_watching() {
        let here = tempfile::tempdir().unwrap();
        let gone = PathBuf::from("Q:\\Unplugged\\Camera");
        let here = here.path().to_path_buf();

        assert!(!came_or_went(std::slice::from_ref(&here), std::slice::from_ref(&gone)));
        assert!(came_or_went(&[], std::slice::from_ref(&here)));
        assert!(came_or_went(&[gone], &[]));
    }

    #[test]
    fn a_saved_folder_on_an_unplugged_drive_doesnt_block_changes() {
        let lib = tempfile::tempdir().unwrap();
        let inbox = tempfile::tempdir().unwrap();
        let gone = PathBuf::from("Q:\\Unplugged\\Camera");
        let list = |paths: &[&Path]| serde_json::to_string(&paths).unwrap();
        let saved = [gone.clone()];

        // Adding another folder, or keeping the missing one alone, is fine.
        assert!(check_folders(&list(&[&gone, inbox.path()]), Some(lib.path()), &saved).is_ok());
        assert!(check_folders(&list(&[&gone]), Some(lib.path()), &saved).is_ok());
        // A missing folder that isn't saved yet still can't be added.
        let err = check_folders(&list(&[&gone]), Some(lib.path()), &[]).unwrap_err();
        assert!(err.to_string().contains("can't be found"));
    }

    /// Run [`sort_in`] on every photo, video and sidecar in `inbox`.
    fn sort_all(db: &Mutex<Connection>, root: &Path, inbox: &Path) -> Option<ApplySummary> {
        let table = FormatTable::default();
        let cancel = AtomicBool::new(false);
        let ctx = Ctx {
            db,
            root,
            table: &table,
            trips: &[],
            naming: Default::default(),
            exiftool: None,
            cancel: &cancel,
            report: &no_report,
        };
        let paths: Vec<PathBuf> = scan::scan(inbox, &table, &cancel)
            .unwrap()
            .files
            .into_iter()
            .map(|f| f.path)
            .collect();
        sort_in(&ctx, &[inbox.to_path_buf()], &paths).unwrap()
    }

    const LIBRARY_PHOTO: &str = "2025\\2025-03\\IMG_20250301_090000.jpg";

    #[test]
    fn new_photos_move_in_and_copies_stay_behind() {
        let (lib, db) = library(&[LIBRARY_PHOTO]);
        let root = lib.path();
        let inbox = tempfile::tempdir().unwrap();
        let copy = fs::read_to_string(root.join(LIBRARY_PHOTO)).unwrap();
        write(&inbox.path().join("IMG_20250412_101500.jpg"), "april");
        write(&inbox.path().join("IMG_20250412_101500.aae"), "april edits");
        write(&inbox.path().join("Phone\\IMG_20250520_080000.jpg"), "may");
        write(&inbox.path().join("copy of march.jpg"), &copy);
        write(&inbox.path().join("notes.txt"), "not a photo");
        write(&inbox.path().join(".hidden\\IMG_20250601_000000.jpg"), "hidden");

        let summary = sort_all(&db, root, inbox.path()).unwrap();
        assert_eq!((summary.moved, summary.failed), (3, 0));
        let left: Vec<String> = snapshot(inbox.path()).into_iter().map(|(p, _, _)| p).collect();
        assert_eq!(left, [".hidden\\IMG_20250601_000000.jpg", "copy of march.jpg", "notes.txt"]);
        assert!(root.join("2025\\2025-04\\IMG_20250412_101500.aae").is_file());
        assert!(root.join("2025\\2025-05\\IMG_20250520_080000.jpg").is_file());
        assert_eq!(index::load_rows(&db.lock().unwrap()).unwrap().len(), 4);

        let label: String = db
            .lock()
            .unwrap()
            .query_row("SELECT label FROM batches WHERE id = ?1", [summary.batch_id], |r| r.get(0))
            .unwrap();
        assert_eq!(label, format!("Moved 3 files in from the inbox {}", inbox.path().display()));
        // Only the copy is left, and it is already in the library.
        assert!(sort_all(&db, root, inbox.path()).is_none());
    }

    #[test]
    fn files_put_back_by_undo_stay_until_they_change() {
        let (lib, db) = library(&[LIBRARY_PHOTO]);
        let root = lib.path();
        let inbox = tempfile::tempdir().unwrap();
        let photo = inbox.path().join("IMG_20250412_101500.jpg");
        write(&photo, "april");
        write(&inbox.path().join("IMG_20250413_101500.jpg"), "the next day");
        let before = snapshot(inbox.path());

        let summary = sort_all(&db, root, inbox.path()).unwrap();
        assert_eq!(summary.moved, 2);
        let table = FormatTable::default();
        let cancel = AtomicBool::new(false);
        let env = Env {
            db: &db,
            root,
            table: &table,
            cancel: &cancel,
            report: &no_report,
        };
        executor::undo(&env, summary.batch_id).unwrap();
        assert_eq!(snapshot(inbox.path()), before);

        // Back where they were and unchanged, so the watcher leaves them.
        assert!(sort_all(&db, root, inbox.path()).is_none());
        assert_eq!(snapshot(inbox.path()), before);

        // An edited file is a new arrival.
        write(&photo, "april, edited");
        let again = sort_all(&db, root, inbox.path()).unwrap();
        assert_eq!(again.moved, 1);
        assert!(!photo.exists());
        assert!(inbox.path().join("IMG_20250413_101500.jpg").is_file());
    }

    #[test]
    fn a_video_arriving_after_its_photo_joins_it_under_its_new_name() {
        // A different photo already has the name, so the inbox photo comes in numbered.
        let taken = "2025\\2025-04\\IMG_20250412_101500.jpg";
        let (lib, db) = library(&[LIBRARY_PHOTO, taken]);
        let root = lib.path();
        let inbox = tempfile::tempdir().unwrap();
        write(&inbox.path().join("IMG_20250412_101500.jpg"), "april");
        assert_eq!(sort_all(&db, root, inbox.path()).unwrap().moved, 1);
        let numbered = root.join("2025\\2025-04\\IMG_20250412_101500 (1).jpg");
        assert!(numbered.is_file());

        write(&inbox.path().join("IMG_20250412_101500.mov"), "april clip");
        assert_eq!(sort_all(&db, root, inbox.path()).unwrap().moved, 1);
        assert!(root.join("2025\\2025-04\\IMG_20250412_101500 (1).mov").is_file());
        assert!(!root.join("2025\\2025-04\\IMG_20250412_101500.mov").exists());
    }

    #[test]
    fn a_sidecar_arriving_after_its_photo_is_brought_in() {
        let (lib, db) = library(&[LIBRARY_PHOTO]);
        let root = lib.path();
        let inbox = tempfile::tempdir().unwrap();
        write(&inbox.path().join("IMG_20250412_101500.jpg"), "april");
        sort_all(&db, root, inbox.path()).unwrap();

        write(&inbox.path().join("IMG_20250412_101500.aae"), "april edits");
        assert_eq!(sort_all(&db, root, inbox.path()).unwrap().moved, 1);
        assert!(root.join("2025\\2025-04\\IMG_20250412_101500.aae").is_file());
        assert!(snapshot(inbox.path()).is_empty());
    }

    #[test]
    fn a_second_photo_of_the_same_name_is_not_a_late_partner() {
        let (lib, db) = library(&[LIBRARY_PHOTO]);
        let root = lib.path();
        let inbox = tempfile::tempdir().unwrap();
        write(&inbox.path().join("IMG_20250412_101500.jpg"), "april");
        sort_all(&db, root, inbox.path()).unwrap();

        write(&inbox.path().join("IMG_20250412_101500.png"), "a screenshot");
        assert_eq!(sort_all(&db, root, inbox.path()).unwrap().moved, 1);
        let rows = index::load_rows(&db.lock().unwrap()).unwrap();
        let (groups, _) = crate::groups::build(rows);
        assert!(groups.iter().all(|g| g.members.len() == 1));
    }

    #[test]
    fn an_edited_photo_keeps_the_sidecar_it_arrived_with() {
        let (lib, db) = library(&[LIBRARY_PHOTO]);
        let root = lib.path();
        let inbox = tempfile::tempdir().unwrap();
        write(&inbox.path().join("IMG_20250412_101500.jpg"), "april");
        sort_all(&db, root, inbox.path()).unwrap();

        write(&inbox.path().join("IMG_20250412_101500.jpg"), "april, edited");
        write(&inbox.path().join("IMG_20250412_101500.aae"), "the edits");
        assert_eq!(sort_all(&db, root, inbox.path()).unwrap().moved, 2);
        let month = root.join("2025\\2025-04");
        assert!(month.join("IMG_20250412_101500 (1).aae").is_file());
        assert!(!month.join("IMG_20250412_101500.aae").exists());
    }

    #[test]
    fn a_name_filed_long_ago_is_not_a_partner() {
        let taken = "2025\\2025-04\\IMG_20250412_101500.jpg";
        let (lib, db) = library(&[LIBRARY_PHOTO, taken]);
        let root = lib.path();
        let inbox = tempfile::tempdir().unwrap();
        write(&inbox.path().join("IMG_20250412_101500.jpg"), "april");
        sort_all(&db, root, inbox.path()).unwrap();
        db.lock()
            .unwrap()
            .execute("UPDATE batches SET created_at = created_at - 2 * 3600", [])
            .unwrap();

        write(&inbox.path().join("IMG_20250412_101500.mov"), "a clip from another day");
        sort_all(&db, root, inbox.path()).unwrap();
        assert!(!root.join("2025\\2025-04\\IMG_20250412_101500 (1).mov").exists());
    }

    #[test]
    fn a_reused_library_id_is_not_a_partner() {
        let (lib, db) = library(&[LIBRARY_PHOTO]);
        let root = lib.path();
        let inbox = tempfile::tempdir().unwrap();
        write(&inbox.path().join("IMG_20250412_101500.jpg"), "april");
        sort_all(&db, root, inbox.path()).unwrap();
        // The photo leaves the library, and the next file filed takes over its id.
        let first = root.join("2025\\2025-04\\IMG_20250412_101500.jpg");
        let id: i64 = {
            let conn = db.lock().unwrap();
            let id = conn
                .query_row("SELECT id FROM media WHERE path = ?1", [first.to_string_lossy()], |r| {
                    r.get(0)
                })
                .unwrap();
            conn.execute("DELETE FROM media WHERE id = ?1", [id]).unwrap();
            id
        };
        fs::remove_file(&first).unwrap();
        write(&inbox.path().join("IMG_20250412_111500.jpg"), "an hour later");
        sort_all(&db, root, inbox.path()).unwrap();
        let reused: String = db
            .lock()
            .unwrap()
            .query_row("SELECT path FROM media WHERE id = ?1", [id], |r| r.get(0))
            .unwrap();
        assert!(reused.ends_with("IMG_20250412_111500.jpg"), "{reused}");

        write(&inbox.path().join("IMG_20250412_101500.aae"), "edits of the first");
        sort_all(&db, root, inbox.path());
        assert!(!root.join("2025\\2025-04\\IMG_20250412_111500.aae").exists());
    }
}
