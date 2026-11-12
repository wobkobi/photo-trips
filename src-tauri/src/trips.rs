// Trips: named date ranges whose photos live together in `<library>\Trips\<start> <name>`.
// Saving, editing or deleting a trip is previewed and applied like any other batch. The trip
// row changes in the same transaction that records the batch, so undo can restore the files
// and the trip together.

use std::collections::HashMap;
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
use crate::organise::{self, PendingBatch, Preview, Previews};
use crate::planner::{self, Plan, Rules, same_path};

/// Folder under the library root that holds one folder per trip.
pub const TRIPS_DIR: &str = "Trips";
/// Trip colours the UI has (tag-1 to tag-6 in index.css).
const COLOURS: i64 = 6;
/// Longest trip name used in a folder name, in characters.
const MAX_NAME: usize = 80;
/// Thumbnails shown under the trip form.
const SAMPLE_SIZE: usize = 8;

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
}

impl Trip {
    /// Inclusive at both ends: a photo taken exactly at the start or end time belongs.
    pub fn contains(&self, at: &NaiveDateTime) -> bool {
        self.start_at <= *at && *at <= self.end_at
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

/// Every trip, earliest first.
pub fn load(conn: &Connection) -> Result<Vec<Trip>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, start_at, end_at, folder, created_at FROM trips ORDER BY start_at",
    )?;
    let rows = stmt.query_map([], |row| {
        let start: String = row.get(2)?;
        let end: String = row.get(3)?;
        Ok(Trip {
            id: row.get(0)?,
            name: row.get(1)?,
            start_at: dates::parse(&start).unwrap_or_default(),
            end_at: dates::parse(&end).unwrap_or_default(),
            folder: row.get(4)?,
            created_at: row.get(5)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

fn get(conn: &Connection, id: i64) -> Result<Option<Trip>> {
    Ok(load(conn)?.into_iter().find(|t| t.id == id))
}

/// The trip a photo taken at `at` belongs to, if any.
pub fn trip_for<'a>(trips: &'a [Trip], at: &NaiveDateTime) -> Option<&'a Trip> {
    trips.iter().find(|t| t.contains(at))
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

/// `<start date> <clean name>`, numbered when another trip already has that folder.
fn folder_for(start: &NaiveDateTime, name: &str, others: &[&Trip]) -> String {
    let base = format!("{} {}", start.format("%Y-%m-%d"), clean_name(name));
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
    let (before, after) = match change {
        TripChange::Create { draft } => (None, Some(draft_trip(draft, &trips, None)?)),
        TripChange::Update { id, draft } => {
            let old = find(*id)?;
            let mut new = draft_trip(draft, &trips, Some(*id))?;
            new.created_at = old.created_at;
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
    let (groups, _orphans) = groups::build(index::load_rows(conn)?);
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

/// A trip from a validated draft, with its folder name. The id is filled in when saved.
fn draft_trip(draft: &TripDraft, trips: &[Trip], editing: Option<i64>) -> Result<Trip> {
    let others: Vec<&Trip> = trips.iter().filter(|t| Some(t.id) != editing).collect();
    validate(draft, &others)?;
    Ok(Trip {
        id: editing.unwrap_or_default(),
        name: clean_name(&draft.name),
        start_at: draft.start_at,
        end_at: draft.end_at,
        folder: folder_for(&draft.start_at, &draft.name, &others),
        created_at: db::now(),
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
            Some(new)
        }
        None => {
            if let Some(old) = before {
                conn.execute("DELETE FROM trips WHERE id = ?1", [old.id])?;
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
    /// Photos and videos (groups) taken during the trip.
    pub files: usize,
    /// A few photos from the trip.
    pub sample: Vec<SampleTile>,
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
    pub files: usize,
    pub sample: Vec<SampleTile>,
    /// Why the dates can't be used, when they overlap another trip.
    pub problem: Option<String>,
}

/// Colour slot for a trip, stable for its lifetime.
pub fn colour(id: i64) -> i64 {
    (id - 1).rem_euclid(COLOURS) + 1
}

/// Up to `SAMPLE_SIZE` leaders spread evenly through `groups`.
fn sample(groups: &[&Group]) -> Vec<SampleTile> {
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
        if let Some(trip) = trip_for(&trips, &group.taken_at) {
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
            }
        })
        .collect())
}

/// How many photos a draft's dates would take in, and whether the dates can be used.
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
    };
    let problem = validate(&draft, &others).err().map(|e| e.to_string());
    let (groups, _) = groups::build(rows);
    let inside: Vec<&Group> = groups
        .iter()
        .filter(|g| start_at <= g.taken_at && g.taken_at <= end_at)
        .collect();
    Ok(TripMatches {
        files: inside.len(),
        sample: sample(&inside),
        problem,
    })
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
        assert_eq!(folder_for(&start, "Japan", &[]), "2025-03-12 Japan");
        // Folder names compare without case, as Windows does.
        assert_eq!(
            folder_for(&start, "trip 1", &[&other]),
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
        }
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
