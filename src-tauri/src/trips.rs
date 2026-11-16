// Trips: named date ranges whose photos live together in `<library>\Trips\<start> <name>`.
// Saving, editing or deleting a trip is previewed and applied like any other batch. The trip
// row changes in the same transaction that records the batch, so undo can restore the files
// and the trip together.

use std::collections::{BTreeSet, HashMap, HashSet};
use std::path::Path;
use std::sync::Arc;

use chrono::{Datelike, NaiveDateTime};
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::AppState;
use crate::commands::{format_table, library_root, lock_db};
use crate::dates;
use crate::db;
use crate::error::{Error, Result};
use crate::executor::OnBegin;
use crate::formats::FormatTable;
use crate::groups::{self, Group};
use crate::index;
use crate::library::{self, Tile};
use crate::naming::Naming;
use crate::organise::{self, PendingBatch, Preview, Previews};
use crate::planner::{self, Plan, Rules, same_path};

/// Folder under the library root that holds one folder per trip.
pub const TRIPS_DIR: &str = "Trips";
/// Trip colours the UI has (tag-1 to tag-6 in index.css).
const COLOURS: i64 = 6;
/// Longest trip name used in a folder name, in characters.
const MAX_NAME: usize = 80;
/// Sample photos sent with a trip or suggestion: the Trips page covers use four, and a
/// suggestion's strip as many as fit across a wide window.
const SAMPLE_SIZE: usize = 12;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Trip {
    pub id: i64,
    pub name: String,
    /// Inclusive local wall-clock times.
    pub start_at: NaiveDateTime,
    pub end_at: NaiveDateTime,
    /// Folder name under `Trips`, e.g. "2025-03-12 Japan".
    pub folder: String,
    pub created_at: i64,
    /// Media ids taken out of the trip: every file of each photo left out. Part of the trip,
    /// so undo records carry them and they survive date changes. Absent from undo records
    /// written before exclusions existed.
    #[serde(default)]
    pub excluded: BTreeSet<i64>,
}

impl Trip {
    /// Inclusive at both ends: a photo taken exactly at the start or end time belongs.
    pub fn contains(&self, at: &NaiveDateTime) -> bool {
        self.start_at <= *at && *at <= self.end_at
    }

    /// The photo was taken out of this trip.
    pub fn excludes(&self, group: &Group) -> bool {
        group.members.iter().any(|m| self.excluded.contains(&m.id))
    }

    fn overlaps(&self, start: &NaiveDateTime, end: &NaiveDateTime) -> bool {
        self.start_at <= *end && *start <= self.end_at
    }
}

/// The trip fields the user edits.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TripDraft {
    pub name: String,
    pub start_at: NaiveDateTime,
    pub end_at: NaiveDateTime,
    /// Ids of photos within the dates that are left out of the trip (any file of each photo).
    /// `None` keeps an edited trip's exclusions as they are.
    #[serde(default)]
    pub excluded: Option<Vec<i64>>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", tag = "action")]
pub enum TripChange {
    Create { draft: TripDraft },
    Update { id: i64, draft: TripDraft },
    Delete { id: i64 },
}

/// What undo needs to put a trip back: the row before and after the change.
#[derive(Debug, Serialize, Deserialize)]
struct UndoData {
    before: Option<Trip>,
    after: Option<Trip>,
}

/// Every trip with its exclusions, earliest first.
pub fn load(conn: &Connection) -> Result<Vec<Trip>> {
    let mut excluded: HashMap<i64, BTreeSet<i64>> = HashMap::new();
    let mut stmt = conn.prepare("SELECT trip_id, media_id FROM trip_exclusions")?;
    for row in stmt.query_map([], |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)))? {
        let (trip, media) = row?;
        excluded.entry(trip).or_default().insert(media);
    }
    let mut stmt = conn.prepare(
        "SELECT id, name, start_at, end_at, folder, created_at FROM trips ORDER BY start_at",
    )?;
    let rows = stmt.query_map([], |row| {
        let start: String = row.get(2)?;
        let end: String = row.get(3)?;
        let id: i64 = row.get(0)?;
        Ok(Trip {
            id,
            name: row.get(1)?,
            start_at: dates::parse(&start).unwrap_or_default(),
            end_at: dates::parse(&end).unwrap_or_default(),
            folder: row.get(4)?,
            created_at: row.get(5)?,
            excluded: excluded.remove(&id).unwrap_or_default(),
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// Replace a trip's exclusions.
fn write_exclusions(conn: &Connection, trip: i64, excluded: &BTreeSet<i64>) -> Result<()> {
    conn.execute("DELETE FROM trip_exclusions WHERE trip_id = ?1", [trip])?;
    let mut insert =
        conn.prepare("INSERT INTO trip_exclusions (trip_id, media_id) VALUES (?1, ?2)")?;
    for media in excluded {
        insert.execute(params![trip, media])?;
    }
    Ok(())
}

fn get(conn: &Connection, id: i64) -> Result<Option<Trip>> {
    Ok(load(conn)?.into_iter().find(|t| t.id == id))
}

/// The trip whose dates cover `at`, if any, whether or not a photo was taken out of it.
pub fn trip_for<'a>(trips: &'a [Trip], at: &NaiveDateTime) -> Option<&'a Trip> {
    trips.iter().find(|t| t.contains(at))
}

/// The trip a photo belongs in: the one covering its date, unless it was taken out of it.
pub fn trip_of<'a>(trips: &'a [Trip], group: &Group) -> Option<&'a Trip> {
    trip_for(trips, &group.taken_at).filter(|t| !t.excludes(group))
}

/// A trip name made safe for a Windows folder: no `\ / : * ? " < > |` or control characters,
/// single spaces, no trailing dots (Windows drops them), and at most 80 characters.
pub fn clean_name(name: &str) -> String {
    let kept: String = name
        .chars()
        .map(|c| {
            if c.is_control() || r#"\/:*?"<>|"#.contains(c) {
                ' '
            } else {
                c
            }
        })
        .collect();
    let single: String = kept.split_whitespace().collect::<Vec<_>>().join(" ");
    let short: String = single.chars().take(MAX_NAME).collect();
    short.trim_end_matches(['.', ' ']).to_string()
}

/// The trip's folder name in the chosen style (`2025-03-12 Japan`, say), numbered " (2)",
/// " (3)" and so on when another trip already has it.
pub fn folder_for(start: &NaiveDateTime, name: &str, others: &[&Trip], naming: Naming) -> String {
    let base = naming.trip_folder(start, &clean_name(name));
    let taken = |folder: &str| others.iter().any(|t| t.folder.eq_ignore_ascii_case(folder));
    if !taken(&base) {
        return base;
    }
    (2..)
        .map(|n| format!("{base} ({n})"))
        .find(|f| !taken(f))
        .unwrap_or(base)
}

/// Short date range for messages: "12 Mar 2025", "12-18 Mar 2025", "28 Feb - 3 Mar 2025",
/// "30 Dec 2024 - 2 Jan 2025".
pub fn range_text(start: &NaiveDateTime, end: &NaiveDateTime) -> String {
    let (s, e) = (start.date(), end.date());
    if s == e {
        s.format("%-d %b %Y").to_string()
    } else if (s.year(), s.month()) == (e.year(), e.month()) {
        format!("{}-{}", s.format("%-d"), e.format("%-d %b %Y"))
    } else if s.year() == e.year() {
        format!("{} - {}", s.format("%-d %b"), e.format("%-d %b %Y"))
    } else {
        format!("{} - {}", s.format("%-d %b %Y"), e.format("%-d %b %Y"))
    }
}

/// Check a draft's name and dates against the other trips.
fn validate(draft: &TripDraft, others: &[&Trip]) -> Result<()> {
    if clean_name(&draft.name).is_empty() {
        return Err(Error::msg("Give the trip a name"));
    }
    if draft.end_at < draft.start_at {
        return Err(Error::msg("The trip has to end after it starts"));
    }
    if let Some(clash) = others
        .iter()
        .find(|t| t.overlaps(&draft.start_at, &draft.end_at))
    {
        return Err(Error::msg(format!(
            "These dates overlap {} ({}). Trips can't overlap.",
            clash.name,
            range_text(&clash.start_at, &clash.end_at)
        )));
    }
    Ok(())
}

/// A trip change ready to preview and apply.
pub struct Prepared {
    pub plan: Plan,
    pub label: String,
    /// Saves the trip row in the batch's transaction.
    pub on_begin: Arc<OnBegin>,
}

/// Work out the moves a trip change causes. Only photos in the old or new date range, or
/// already in the trip's folder, are planned, so unrelated unsorted files stay out of it.
pub fn prepare(
    conn: &Connection,
    root: &Path,
    table: &FormatTable,
    change: &TripChange,
    exists: &dyn Fn(&Path) -> bool,
) -> Result<Prepared> {
    let trips = load(conn)?;
    let find = |id: i64| {
        trips
            .iter()
            .find(|t| t.id == id)
            .cloned()
            .ok_or_else(|| Error::msg("That trip no longer exists"))
    };
    let naming = Naming::load(conn)?;
    let (groups, _orphans) = groups::build(index::load_rows(conn)?);
    let (before, after) = match change {
        TripChange::Create { draft } => {
            let mut new = draft_trip(draft, &trips, None, naming)?;
            new.excluded = exclusions(&new, None, draft.excluded.as_deref(), &groups);
            (None, Some(new))
        }
        TripChange::Update { id, draft } => {
            let old = find(*id)?;
            let mut new = draft_trip(draft, &trips, Some(*id), naming)?;
            new.created_at = old.created_at;
            new.excluded = exclusions(&new, Some(&old), draft.excluded.as_deref(), &groups);
            (Some(old), Some(new))
        }
        TripChange::Delete { id } => (Some(find(*id)?), None),
    };

    // Rules as they will be once the change is saved.
    let changed_id = before.as_ref().map(|t| t.id);
    let mut new_trips: Vec<Trip> = trips
        .into_iter()
        .filter(|t| Some(t.id) != changed_id)
        .collect();
    new_trips.extend(after.clone());

    let old_dir = before
        .as_ref()
        .map(|t| root.join(TRIPS_DIR).join(&t.folder));
    let in_range =
        |trip: &Option<Trip>, g: &Group| trip.as_ref().is_some_and(|t| t.contains(&g.taken_at));
    let affected: Vec<Group> = groups
        .into_iter()
        .filter(|g| {
            in_range(&before, g)
                || in_range(&after, g)
                || old_dir
                    .as_ref()
                    .is_some_and(|dir| g.leader().path.parent().is_some_and(|p| same_path(p, dir)))
        })
        .collect();
    let rules = Rules {
        root,
        trips: &new_trips,
        naming,
    };
    let plan = planner::plan(&rules, &affected, 0, table, exists);
    let label = label_for(before.as_ref(), after.as_ref());
    let on_begin: Arc<OnBegin> =
        Arc::new(move |conn: &Connection| save(conn, before.as_ref(), after.as_ref()));
    Ok(Prepared {
        plan,
        label,
        on_begin,
    })
}

/// The exclusions a trip has once a draft is saved. The draft speaks for the photos within its
/// dates: those it lists are out (every file of each), the rest are in. Photos outside the
/// dates keep whatever the trip had, so narrowing the dates and widening them again doesn't
/// pull a left-out photo back in. A draft without a list keeps the trip's exclusions as they
/// are.
fn exclusions(
    trip: &Trip,
    old: Option<&Trip>,
    draft: Option<&[i64]>,
    groups: &[Group],
) -> BTreeSet<i64> {
    let kept = old.map(|t| t.excluded.clone()).unwrap_or_default();
    let Some(draft) = draft else {
        return kept;
    };
    let draft: HashSet<i64> = draft.iter().copied().collect();
    let mut out = kept;
    for group in groups.iter().filter(|g| trip.contains(&g.taken_at)) {
        let ids = group.members.iter().map(|m| m.id);
        if group.members.iter().any(|m| draft.contains(&m.id)) {
            out.extend(ids);
        } else {
            for id in ids {
                out.remove(&id);
            }
        }
    }
    out
}

/// A trip from a validated draft, with its folder name. The id is filled in when saved, and
/// the exclusions by [`exclusions`].
fn draft_trip(
    draft: &TripDraft,
    trips: &[Trip],
    editing: Option<i64>,
    naming: Naming,
) -> Result<Trip> {
    let others: Vec<&Trip> = trips.iter().filter(|t| Some(t.id) != editing).collect();
    validate(draft, &others)?;
    Ok(Trip {
        id: editing.unwrap_or_default(),
        name: clean_name(&draft.name),
        start_at: draft.start_at,
        end_at: draft.end_at,
        folder: folder_for(&draft.start_at, &draft.name, &others, naming),
        created_at: db::now(),
        excluded: BTreeSet::new(),
    })
}

fn label_for(before: Option<&Trip>, after: Option<&Trip>) -> String {
    match (before, after) {
        (None, Some(new)) => format!("Created trip {}", new.name),
        (Some(old), None) => format!("Deleted trip {}", old.name),
        (Some(old), Some(new))
            if (old.start_at, old.end_at) == (new.start_at, new.end_at) && old.name != new.name =>
        {
            format!("Renamed trip {} to {}", old.name, new.name)
        }
        (Some(old), Some(new))
            if (old.start_at, old.end_at, &old.name) == (new.start_at, new.end_at, &new.name) =>
        {
            format!("Changed which photos are in trip {}", new.name)
        }
        (Some(_), Some(new)) => format!("Changed the dates of trip {}", new.name),
        (None, None) => String::new(),
    }
}

/// Write a trip change, re-checking it against trips saved since the preview. Returns the
/// undo data.
fn save(conn: &Connection, before: Option<&Trip>, after: Option<&Trip>) -> Result<Option<String>> {
    let current = load(conn)?;
    if let Some(old) = before
        && !current.contains(old)
    {
        return Err(Error::msg(
            "This trip changed since the preview. Check the changes again.",
        ));
    }
    let others: Vec<&Trip> = current
        .iter()
        .filter(|t| Some(t.id) != before.map(|b| b.id))
        .collect();
    let saved = match after {
        Some(new) => {
            let draft = TripDraft {
                name: new.name.clone(),
                start_at: new.start_at,
                end_at: new.end_at,
                excluded: None,
            };
            validate(&draft, &others)?;
            if others
                .iter()
                .any(|t| t.folder.eq_ignore_ascii_case(&new.folder))
            {
                return Err(Error::msg("Another trip already uses that folder name"));
            }
            let mut new = new.clone();
            match before {
                Some(old) => {
                    conn.execute(
                        "UPDATE trips SET name = ?1, start_at = ?2, end_at = ?3, folder = ?4
                         WHERE id = ?5",
                        params![
                            new.name,
                            dates::format(&new.start_at),
                            dates::format(&new.end_at),
                            new.folder,
                            old.id
                        ],
                    )?;
                    new.id = old.id;
                }
                None => {
                    conn.execute(
                        "INSERT INTO trips (name, start_at, end_at, folder, created_at)
                         VALUES (?1, ?2, ?3, ?4, ?5)",
                        params![
                            new.name,
                            dates::format(&new.start_at),
                            dates::format(&new.end_at),
                            new.folder,
                            new.created_at
                        ],
                    )?;
                    new.id = conn.last_insert_rowid();
                }
            }
            write_exclusions(conn, new.id, &new.excluded)?;
            Some(new)
        }
        None => {
            if let Some(old) = before {
                conn.execute("DELETE FROM trips WHERE id = ?1", [old.id])?;
                write_exclusions(conn, old.id, &BTreeSet::new())?;
            }
            None
        }
    };
    let data = UndoData {
        before: before.cloned(),
        after: saved,
    };
    serde_json::to_string(&data)
        .map(Some)
        .map_err(|e| Error::msg(e.to_string()))
}

fn parse_undo(data: &str) -> Result<UndoData> {
    serde_json::from_str(data).map_err(|e| Error::msg(format!("Unreadable undo record: {e}")))
}

/// Refuse to undo a trip change when the trip has changed again since, or when restoring it
/// would clash with a trip added later. Runs before any file moves back.
pub fn check_undo(conn: &Connection, data: &str) -> Result<()> {
    let data = parse_undo(data)?;
    if let Some(after) = &data.after
        && get(conn, after.id)?.as_ref() != Some(after)
    {
        return Err(Error::msg(format!(
            "Trip {} has changed since. Undo the later changes to it first.",
            after.name
        )));
    }
    if let Some(before) = &data.before
        && let Some(clash) = load(conn)?.iter().find(|t| {
            t.id != before.id
                && (t.overlaps(&before.start_at, &before.end_at)
                    || t.folder.eq_ignore_ascii_case(&before.folder))
        })
    {
        return Err(Error::msg(format!(
            "Trip {} now uses these dates, so {} can't go back to them.",
            clash.name, before.name
        )));
    }
    Ok(())
}

/// Put the trip row back the way it was before the change.
pub fn restore(conn: &Connection, data: &str) -> Result<()> {
    let data = parse_undo(data)?;
    match (data.before, data.after) {
        (None, Some(after)) => {
            conn.execute("DELETE FROM trips WHERE id = ?1", [after.id])?;
            write_exclusions(conn, after.id, &BTreeSet::new())?;
        }
        (Some(before), _) => {
            let exists: Option<i64> = conn
                .query_row("SELECT id FROM trips WHERE id = ?1", [before.id], |r| {
                    r.get(0)
                })
                .optional()?;
            let sql = if exists.is_some() {
                "UPDATE trips SET name = ?2, start_at = ?3, end_at = ?4, folder = ?5,
                 created_at = ?6 WHERE id = ?1"
            } else {
                "INSERT INTO trips (id, name, start_at, end_at, folder, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)"
            };
            conn.execute(
                sql,
                params![
                    before.id,
                    before.name,
                    dates::format(&before.start_at),
                    dates::format(&before.end_at),
                    before.folder,
                    before.created_at
                ],
            )?;
            write_exclusions(conn, before.id, &before.excluded)?;
        }
        (None, None) => {}
    }
    Ok(())
}

/// A trip for the Trips page.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TripInfo {
    pub id: i64,
    pub name: String,
    pub start_at: String,
    pub end_at: String,
    pub folder: String,
    /// 1 to 6: which trip colour the UI uses.
    pub colour: i64,
    /// Photos and videos (groups) in the trip, not counting any taken out of it.
    pub files: usize,
    /// A few photos from the trip.
    pub sample: Vec<SampleTile>,
    /// Ids of every file taken out of the trip.
    pub excluded: Vec<i64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SampleTile {
    pub id: i64,
    pub version: i64,
}

/// Live feedback for the trip form.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TripMatches {
    /// Every photo and video taken within the dates, newest first, for the form's picker.
    pub tiles: Vec<Tile>,
    /// Why the dates can't be used, when they overlap another trip.
    pub problem: Option<String>,
}

/// Colour slot for a trip, stable for its lifetime.
pub fn colour(id: i64) -> i64 {
    (id - 1).rem_euclid(COLOURS) + 1
}

/// Up to `SAMPLE_SIZE` leaders spread evenly through `groups`.
pub(crate) fn sample(groups: &[&Group]) -> Vec<SampleTile> {
    let step = groups.len().div_ceil(SAMPLE_SIZE).max(1);
    groups
        .iter()
        .step_by(step)
        .take(SAMPLE_SIZE)
        .map(|g| SampleTile {
            id: g.leader().id,
            version: g.leader().mtime,
        })
        .collect()
}

#[tauri::command(async)]
pub fn list_trips(state: State<'_, AppState>) -> Result<Vec<TripInfo>> {
    let (trips, rows) = {
        let conn = lock_db(&state)?;
        (load(&conn)?, index::load_rows(&conn)?)
    };
    let (groups, _) = groups::build(rows);
    let mut by_trip: HashMap<i64, Vec<&Group>> = HashMap::new();
    for group in &groups {
        if let Some(trip) = trip_of(&trips, group) {
            by_trip.entry(trip.id).or_default().push(group);
        }
    }
    // Newest trip first, like the library.
    Ok(trips
        .iter()
        .rev()
        .map(|t| {
            let members = by_trip.get(&t.id).map(Vec::as_slice).unwrap_or_default();
            TripInfo {
                id: t.id,
                name: t.name.clone(),
                start_at: dates::format(&t.start_at),
                end_at: dates::format(&t.end_at),
                folder: t.folder.clone(),
                colour: colour(t.id),
                files: members.len(),
                sample: sample(members),
                excluded: t.excluded.iter().copied().collect(),
            }
        })
        .collect())
}

/// The photos a draft's dates take in, and whether the dates can be used.
#[tauri::command(async)]
pub fn trip_matches(
    state: State<'_, AppState>,
    start_at: NaiveDateTime,
    end_at: NaiveDateTime,
    editing: Option<i64>,
) -> Result<TripMatches> {
    let (trips, rows) = {
        let conn = lock_db(&state)?;
        (load(&conn)?, index::load_rows(&conn)?)
    };
    let others: Vec<&Trip> = trips.iter().filter(|t| Some(t.id) != editing).collect();
    let draft = TripDraft {
        name: "trip".into(),
        start_at,
        end_at,
        excluded: None,
    };
    let problem = validate(&draft, &others).err().map(|e| e.to_string());
    let (groups, _) = groups::build(rows);
    // The form shows which photos are in by their ticks, so tiles carry no trip band.
    let tiles = groups
        .iter()
        .rev()
        .filter(|g| start_at <= g.taken_at && g.taken_at <= end_at)
        .map(|g| library::tile(g, &[]))
        .collect();
    Ok(TripMatches { tiles, problem })
}

/// Preview the moves a trip change causes. Apply it with `apply_plan`.
#[tauri::command(async)]
pub fn plan_trip(
    state: State<'_, AppState>,
    previews: State<'_, Previews>,
    change: TripChange,
) -> Result<Preview> {
    let (root, prepared, versions) = {
        let conn = lock_db(&state)?;
        let root = library_root(&conn)?;
        let table = format_table(&conn)?;
        let prepared = prepare(&conn, &root, &table, &change, &|p| {
            std::fs::symlink_metadata(p).is_ok()
        })?;
        let versions: HashMap<i64, i64> = index::load_rows(&conn)?
            .iter()
            .map(|r| (r.id, r.mtime))
            .collect();
        (root, prepared, versions)
    };
    let mut preview = organise::describe(&root, &prepared.plan, &versions);
    preview.id = previews.store(PendingBatch {
        kind: "trip",
        label: prepared.label,
        root,
        plan: prepared.plan,
        on_begin: Some(prepared.on_begin),
    });
    Ok(preview)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::sync::Mutex;
    use std::sync::atomic::AtomicBool;

    use crate::executor::testing::{library, no_report, snapshot};
    use crate::executor::{self, Env, NewBatch};
    use crate::history;

    fn at(text: &str) -> NaiveDateTime {
        dates::parse(text).unwrap()
    }

    fn trip(id: i64, start: &str, end: &str) -> Trip {
        Trip {
            id,
            name: format!("Trip {id}"),
            start_at: at(start),
            end_at: at(end),
            folder: format!("{} Trip {id}", &start[..10]),
            created_at: 0,
            excluded: Default::default(),
        }
    }

    #[test]
    fn names_are_made_safe_for_folders() {
        assert_eq!(clean_name("  Japan: Tokyo / Kyoto?  "), "Japan Tokyo Kyoto");
        assert_eq!(clean_name("Road trip..."), "Road trip");
        assert_eq!(clean_name("a\tb\nc"), "a b c");
        assert_eq!(clean_name("<>|*"), "");
        assert_eq!(clean_name(&"x".repeat(200)).len(), MAX_NAME);
    }

    #[test]
    fn folders_are_numbered_when_taken() {
        let start = at("2025-03-12T00:00:00");
        let other = trip(1, "2025-03-12T00:00:00", "2025-03-12T11:59:59");
        let naming = Naming::default();
        assert_eq!(folder_for(&start, "Japan", &[], naming), "2025-03-12 Japan");
        // Folder names compare without case, as Windows does.
        assert_eq!(
            folder_for(&start, "trip 1", &[&other], naming),
            "2025-03-12 trip 1 (2)"
        );
    }

    #[test]
    fn ranges_read_naturally() {
        let r = |a: &str, b: &str| range_text(&at(a), &at(b));
        assert_eq!(
            r("2025-03-12T00:00:00", "2025-03-12T23:59:59"),
            "12 Mar 2025"
        );
        assert_eq!(
            r("2025-03-12T00:00:00", "2025-03-18T23:59:59"),
            "12-18 Mar 2025"
        );
        assert_eq!(
            r("2025-02-28T00:00:00", "2025-03-03T23:59:59"),
            "28 Feb - 3 Mar 2025"
        );
        assert_eq!(
            r("2024-12-30T00:00:00", "2025-01-02T23:59:59"),
            "30 Dec 2024 - 2 Jan 2025"
        );
    }

    #[test]
    fn boundaries_are_inclusive_and_overlaps_rejected() {
        let japan = trip(1, "2025-03-12T00:00:00", "2025-03-18T23:59:59");
        assert!(japan.contains(&at("2025-03-12T00:00:00")));
        assert!(japan.contains(&at("2025-03-18T23:59:59")));
        assert!(!japan.contains(&at("2025-03-11T23:59:59")));
        assert!(!japan.contains(&at("2025-03-19T00:00:00")));

        let draft = |start: &str, end: &str| TripDraft {
            name: "Next".into(),
            start_at: at(start),
            end_at: at(end),
            excluded: None,
        };
        // Starting the second the first trip ends is fine; sharing that second is not.
        assert!(
            validate(
                &draft("2025-03-19T00:00:00", "2025-03-20T23:59:59"),
                &[&japan]
            )
            .is_ok()
        );
        let err = validate(
            &draft("2025-03-18T23:59:59", "2025-03-20T23:59:59"),
            &[&japan],
        )
        .unwrap_err()
        .to_string();
        assert!(err.contains("overlap Trip 1 (12-18 Mar 2025)"), "{err}");
        assert!(validate(&draft("2025-03-20T00:00:00", "2025-03-19T00:00:00"), &[]).is_err());
        let mut nameless = draft("2025-04-01T00:00:00", "2025-04-02T00:00:00");
        nameless.name = " ? ".into();
        assert!(validate(&nameless, &[]).is_err());
    }

    /// Prepare and apply a trip change on the temp library, as the app does.
    fn change(db: &Mutex<Connection>, root: &Path, change: TripChange) -> i64 {
        let table = FormatTable::default();
        let prepared = prepare(&db.lock().unwrap(), root, &table, &change, &|p| {
            fs::symlink_metadata(p).is_ok()
        })
        .unwrap();
        let cancel = AtomicBool::new(false);
        let env = Env {
            db,
            root,
            table: &table,
            cancel: &cancel,
            report: &no_report,
        };
        let batch = NewBatch {
            kind: "trip",
            label: &prepared.label,
            on_begin: Some(prepared.on_begin.as_ref()),
        };
        let summary = executor::apply(&env, &batch, &prepared.plan).unwrap();
        assert_eq!(summary.failed, 0);
        summary.batch_id
    }

    fn undo(db: &Mutex<Connection>, root: &Path, batch_id: i64) -> Result<()> {
        let table = FormatTable::default();
        let cancel = AtomicBool::new(false);
        let env = Env {
            db,
            root,
            table: &table,
            cancel: &cancel,
            report: &no_report,
        };
        history::undo(&env, batch_id).map(|_| ())
    }

    fn files(root: &Path) -> Vec<String> {
        snapshot(root)
            .into_iter()
            .map(|(path, _, _)| path)
            .collect()
    }

    fn trip_names(db: &Mutex<Connection>) -> Vec<String> {
        load(&db.lock().unwrap())
            .unwrap()
            .into_iter()
            .map(|t| format!("{} {}", t.folder, range_text(&t.start_at, &t.end_at)))
            .collect()
    }

    fn draft(name: &str, start: &str, end: &str) -> TripDraft {
        TripDraft {
            name: name.into(),
            start_at: at(start),
            end_at: at(end),
            excluded: None,
        }
    }

    /// The media id of the library file named `name`.
    fn media_id(db: &Mutex<Connection>, name: &str) -> i64 {
        index::load_rows(&db.lock().unwrap())
            .unwrap()
            .into_iter()
            .find(|r| r.path.file_name().is_some_and(|n| n == name))
            .unwrap()
            .id
    }

    /// The batch label History shows for a change, as the last batch recorded.
    fn last_label(db: &Mutex<Connection>) -> String {
        db.lock()
            .unwrap()
            .query_row("SELECT label FROM batches ORDER BY id DESC LIMIT 1", [], |r| r.get(0))
            .unwrap()
    }

    #[test]
    fn a_photo_left_out_stays_out_through_date_changes_until_put_back() {
        let (dir, db) = library(&[
            r"in\IMG_20250312_000000.jpg",
            r"in\IMG_20250315_120000.jpg",
            r"in\IMG_20250315_120000.aae",
            r"in\IMG_20250318_235959.jpg",
        ]);
        let root = dir.path();
        let sidecar = media_id(&db, "IMG_20250315_120000.aae");
        let photo = media_id(&db, "IMG_20250315_120000.jpg");
        let with = |name: &str, start: &str, end: &str, excluded: Option<Vec<i64>>| TripDraft {
            excluded,
            ..draft(name, start, end)
        };
        let out_folder = [
            r"2025\2025-03\IMG_20250315_120000.aae",
            r"2025\2025-03\IMG_20250315_120000.jpg",
        ];

        // Naming any file of a photo leaves the whole photo out, in its month folder.
        let japan = with("Japan", "2025-03-12T00:00:00", "2025-03-18T23:59:59", Some(vec![sidecar]));
        change(&db, root, TripChange::Create { draft: japan });
        let trip = load(&db.lock().unwrap()).unwrap().remove(0);
        assert_eq!(trip.excluded, BTreeSet::from([photo, sidecar]));
        assert_eq!(
            files(root),
            [
                out_folder[0],
                out_folder[1],
                r"Trips\2025-03-12 Japan\IMG_20250312_000000.jpg",
                r"Trips\2025-03-12 Japan\IMG_20250318_235959.jpg",
            ]
        );

        // Narrowing the dates past it and widening them again doesn't pull it back in.
        let id = trip.id;
        let narrow = with("Japan", "2025-03-12T00:00:00", "2025-03-13T23:59:59", Some(vec![]));
        change(&db, root, TripChange::Update { id, draft: narrow });
        let wide = with("Japan", "2025-03-11T00:00:00", "2025-03-19T23:59:59", None);
        change(&db, root, TripChange::Update { id, draft: wide });
        assert!(out_folder.iter().all(|f| root.join(f).exists()));
        assert!(root.join(r"Trips\2025-03-11 Japan\IMG_20250318_235959.jpg").exists());

        // Putting it back moves the photo and its sidecar into the trip.
        let back = with("Japan", "2025-03-11T00:00:00", "2025-03-19T23:59:59", Some(vec![]));
        let put_back = change(&db, root, TripChange::Update { id, draft: back });
        assert_eq!(last_label(&db), "Changed which photos are in trip Japan");
        assert!(root.join(r"Trips\2025-03-11 Japan\IMG_20250315_120000.aae").exists());
        assert!(load(&db.lock().unwrap()).unwrap()[0].excluded.is_empty());

        // Undo leaves it out again, files and all.
        undo(&db, root, put_back).unwrap();
        assert!(out_folder.iter().all(|f| root.join(f).exists()));
        assert_eq!(load(&db.lock().unwrap()).unwrap()[0].excluded, BTreeSet::from([photo, sidecar]));

        // Deleting the trip forgets its exclusions; undoing the delete brings them back.
        let delete = change(&db, root, TripChange::Delete { id });
        let rows: i64 = db
            .lock()
            .unwrap()
            .query_row("SELECT COUNT(*) FROM trip_exclusions", [], |r| r.get(0))
            .unwrap();
        assert_eq!(rows, 0);
        undo(&db, root, delete).unwrap();
        assert_eq!(load(&db.lock().unwrap()).unwrap()[0].excluded, BTreeSet::from([photo, sidecar]));
        assert!(out_folder.iter().all(|f| root.join(f).exists()));
    }

    #[test]
    fn create_rename_redate_and_delete_each_move_the_right_files_and_undo() {
        let (dir, db) = library(&[
            "in\\IMG_20250311_235959.jpg",
            "in\\IMG_20250312_000000.jpg",
            "in\\IMG_20250315_120000.jpg",
            "in\\IMG_20250315_120000.aae",
            "in\\IMG_20250318_235959.jpg",
            "in\\IMG_20250319_000000.jpg",
        ]);
        let root = dir.path();
        let original = files(root);

        // Create: exactly the photos from 00:00 on the first day to 23:59:59 on the last.
        let japan = draft("Japan: Tokyo", "2025-03-12T00:00:00", "2025-03-18T23:59:59");
        let created = change(
            &db,
            root,
            TripChange::Create {
                draft: japan.clone(),
            },
        );
        assert_eq!(
            files(root),
            [
                "Trips\\2025-03-12 Japan Tokyo\\IMG_20250312_000000.jpg",
                "Trips\\2025-03-12 Japan Tokyo\\IMG_20250315_120000.aae",
                "Trips\\2025-03-12 Japan Tokyo\\IMG_20250315_120000.jpg",
                "Trips\\2025-03-12 Japan Tokyo\\IMG_20250318_235959.jpg",
                "in\\IMG_20250311_235959.jpg",
                "in\\IMG_20250319_000000.jpg",
            ]
        );
        assert_eq!(trip_names(&db), ["2025-03-12 Japan Tokyo 12-18 Mar 2025"]);
        undo(&db, root, created).unwrap();
        assert_eq!(files(root), original);
        assert!(trip_names(&db).is_empty());

        // Rename: the folder follows the name.
        change(
            &db,
            root,
            TripChange::Create {
                draft: japan.clone(),
            },
        );
        let id = load(&db.lock().unwrap()).unwrap()[0].id;
        let mut renamed = japan.clone();
        renamed.name = "Japan 2025".into();
        let rename = change(
            &db,
            root,
            TripChange::Update {
                id,
                draft: renamed.clone(),
            },
        );
        assert!(
            root.join("Trips\\2025-03-12 Japan 2025\\IMG_20250315_120000.aae")
                .exists()
        );
        assert!(!root.join("Trips\\2025-03-12 Japan Tokyo").exists());
        undo(&db, root, rename).unwrap();
        assert!(
            root.join("Trips\\2025-03-12 Japan Tokyo\\IMG_20250315_120000.aae")
                .exists()
        );
        assert_eq!(trip_names(&db), ["2025-03-12 Japan Tokyo 12-18 Mar 2025"]);

        // New dates: the 12th leaves for its month folder, the 19th joins, the folder moves.
        let later = draft("Japan Tokyo", "2025-03-13T00:00:00", "2025-03-19T23:59:59");
        let redate = change(&db, root, TripChange::Update { id, draft: later });
        assert_eq!(
            files(root),
            [
                "2025\\2025-03\\IMG_20250312_000000.jpg",
                "Trips\\2025-03-13 Japan Tokyo\\IMG_20250315_120000.aae",
                "Trips\\2025-03-13 Japan Tokyo\\IMG_20250315_120000.jpg",
                "Trips\\2025-03-13 Japan Tokyo\\IMG_20250318_235959.jpg",
                "Trips\\2025-03-13 Japan Tokyo\\IMG_20250319_000000.jpg",
                "in\\IMG_20250311_235959.jpg",
            ]
        );
        undo(&db, root, redate).unwrap();
        assert!(root.join("in\\IMG_20250319_000000.jpg").exists());
        assert!(
            root.join("Trips\\2025-03-12 Japan Tokyo\\IMG_20250312_000000.jpg")
                .exists()
        );
        assert!(!root.join("2025").exists());

        // Delete: everything goes to its month folder, and undo brings the trip back.
        let delete = change(&db, root, TripChange::Delete { id });
        assert!(trip_names(&db).is_empty());
        assert!(!root.join("Trips").exists());
        assert!(root.join("2025\\2025-03\\IMG_20250318_235959.jpg").exists());
        undo(&db, root, delete).unwrap();
        assert_eq!(trip_names(&db), ["2025-03-12 Japan Tokyo 12-18 Mar 2025"]);
        assert!(
            root.join("Trips\\2025-03-12 Japan Tokyo\\IMG_20250318_235959.jpg")
                .exists()
        );
        assert_eq!(load(&db.lock().unwrap()).unwrap()[0].id, id);
    }

    #[test]
    fn undoing_an_older_trip_change_is_refused_once_the_trip_changed_again() {
        let (dir, db) = library(&["in\\IMG_20250315_120000.jpg"]);
        let root = dir.path();
        let japan = draft("Japan", "2025-03-12T00:00:00", "2025-03-18T23:59:59");
        let created = change(
            &db,
            root,
            TripChange::Create {
                draft: japan.clone(),
            },
        );
        let id = load(&db.lock().unwrap()).unwrap()[0].id;
        let mut renamed = japan;
        renamed.name = "Japan 2025".into();
        change(&db, root, TripChange::Update { id, draft: renamed });

        let before = files(root);
        let err = undo(&db, root, created).unwrap_err().to_string();
        assert!(err.contains("has changed since"), "{err}");
        assert_eq!(files(root), before);
    }

    #[test]
    fn undo_is_refused_when_a_later_trip_took_the_old_dates() {
        let (dir, db) = library(&["in\\IMG_20250315_120000.jpg"]);
        let root = dir.path();
        let japan = draft("Japan", "2025-03-12T00:00:00", "2025-03-18T23:59:59");
        change(&db, root, TripChange::Create { draft: japan });
        let id = load(&db.lock().unwrap()).unwrap()[0].id;
        let shorter = draft("Japan", "2025-03-12T00:00:00", "2025-03-14T23:59:59");
        let shrink = change(&db, root, TripChange::Update { id, draft: shorter });
        let korea = draft("Korea", "2025-03-15T00:00:00", "2025-03-18T23:59:59");
        change(&db, root, TripChange::Create { draft: korea });

        let err = undo(&db, root, shrink).unwrap_err().to_string();
        assert!(err.contains("Trip Korea now uses these dates"), "{err}");
        assert!(
            root.join("Trips\\2025-03-15 Korea\\IMG_20250315_120000.jpg")
                .exists()
        );
    }

    #[test]
    fn a_trip_with_no_photos_still_saves_and_undoes() {
        let (dir, db) = library(&["in\\IMG_20250315_120000.jpg"]);
        let root = dir.path();
        let empty = draft(
            "Quiet weekend",
            "2024-01-06T00:00:00",
            "2024-01-07T23:59:59",
        );
        let batch = change(&db, root, TripChange::Create { draft: empty });
        assert_eq!(trip_names(&db), ["2024-01-06 Quiet weekend 6-7 Jan 2024"]);
        undo(&db, root, batch).unwrap();
        assert!(trip_names(&db).is_empty());
    }
}
