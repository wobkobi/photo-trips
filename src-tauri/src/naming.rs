// Folder name presets: how month folders and trip folders are named, and the batch that
// renames every existing folder when a preset changes. The presets live in the settings table
// but are only ever written by that batch, so the folders on disk always match them.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use chrono::{Datelike, NaiveDateTime};
use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::AppState;
use crate::commands::{format_table, library_root, lock_db};
use crate::db;
use crate::error::{Error, Result};
use crate::executor::OnBegin;
use crate::formats::FormatTable;
use crate::groups::{self, Group};
use crate::index;
use crate::organise::{self, PendingBatch, Preview, Previews};
use crate::planner::{self, Plan, Rules, same_path};
use crate::trips::{self, Trip};

const MONTH_KEY: &str = "month_folders";
const TRIP_KEY: &str = "trip_folders";

/// Fixed English month names, so folder names don't change with the PC's language.
const MONTHS: [&str; 12] = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
];

/// How the folder for each month is named, inside its year folder.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum MonthStyle {
    /// `2026\2026-03`
    #[default]
    YearMonth,
    /// `2026\03 March`
    NumberName,
    /// `2026\March 2026`
    NameYear,
}

/// How a trip's folder is named, inside `Trips`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum TripStyle {
    /// `2026-03-12 Japan`
    #[default]
    DateName,
    /// `Japan 2026`
    NameYear,
    /// `2026 Japan`
    YearName,
}

/// The chosen presets. Anything missing or unknown in the settings reads as the default.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Naming {
    pub months: MonthStyle,
    pub trips: TripStyle,
}

/// The settings value for a preset: its serde name, e.g. "number-name".
fn value_of<T: Serialize>(style: T) -> Result<String> {
    match serde_json::to_value(style) {
        Ok(serde_json::Value::String(text)) => Ok(text),
        _ => Err(Error::msg("Couldn't save the folder names")),
    }
}

/// A preset from its settings value, or None when it isn't one.
fn parse<T: for<'de> Deserialize<'de>>(value: &str) -> Option<T> {
    serde_json::from_value(serde_json::Value::String(value.to_string())).ok()
}

impl Naming {
    /// The presets saved in the settings.
    pub fn load(conn: &Connection) -> Result<Naming> {
        let read = |key| db::get_setting(conn, key);
        Ok(Naming {
            months: read(MONTH_KEY)?.and_then(|v| parse(&v)).unwrap_or_default(),
            trips: read(TRIP_KEY)?.and_then(|v| parse(&v)).unwrap_or_default(),
        })
    }

    fn save(self, conn: &Connection) -> Result<()> {
        db::set_setting(conn, MONTH_KEY, &value_of(self.months)?)?;
        db::set_setting(conn, TRIP_KEY, &value_of(self.trips)?)?;
        Ok(())
    }

    /// The month folder a photo taken at `taken` belongs in, inside its year folder.
    pub fn month_dir(self, root: &Path, taken: &NaiveDateTime) -> PathBuf {
        let (year, month) = (taken.year(), taken.month());
        let name = MONTHS[month as usize - 1];
        let folder = match self.months {
            MonthStyle::YearMonth => format!("{year:04}-{month:02}"),
            MonthStyle::NumberName => format!("{month:02} {name}"),
            MonthStyle::NameYear => format!("{name} {year:04}"),
        };
        root.join(format!("{year:04}")).join(folder)
    }

    /// A trip's folder name before any clash number. `name` is already cleaned for Windows.
    pub fn trip_folder(self, start: &NaiveDateTime, name: &str) -> String {
        match self.trips {
            TripStyle::DateName => format!("{} {name}", start.format("%Y-%m-%d")),
            TripStyle::NameYear => format!("{name} {:04}", start.year()),
            TripStyle::YearName => format!("{:04} {name}", start.year()),
        }
    }
}

/// What undoing a naming change needs: the presets either side, and each trip's folder name
/// either side.
#[derive(Debug, Serialize, Deserialize)]
struct UndoData {
    before: Naming,
    after: Naming,
    /// Trip id > (old folder, new folder).
    folders: Vec<(i64, String, String)>,
}

/// The trips with their folders renamed for `naming`. Earlier trips keep the plain name and a
/// later trip that would share it gets " (2)", " (3)" and so on.
pub fn renamed_trips(trips: &[Trip], naming: Naming) -> Vec<Trip> {
    let mut sorted: Vec<&Trip> = trips.iter().collect();
    sorted.sort_by_key(|t| (t.start_at, t.id));
    let mut out: Vec<Trip> = Vec::with_capacity(trips.len());
    for trip in sorted {
        let assigned: Vec<&Trip> = out.iter().collect();
        let folder = trips::folder_for(&trip.start_at, &trip.name, &assigned, naming);
        out.push(Trip {
            folder,
            ..trip.clone()
        });
    }
    out
}

/// The moves and database change that switch the library to new presets.
pub struct Prepared {
    pub plan: Plan,
    pub label: String,
    pub on_begin: Arc<OnBegin>,
}

/// Plan the renames for new presets. Only photos already in the folder the current presets
/// pick are moved, so unsorted files stay where they are.
pub fn prepare(
    conn: &Connection,
    root: &Path,
    table: &FormatTable,
    next: Naming,
    exists: &dyn Fn(&Path) -> bool,
) -> Result<Prepared> {
    let current = Naming::load(conn)?;
    let trips = trips::load(conn)?;
    let renamed = renamed_trips(&trips, next);
    let (groups, _orphans) = groups::build(index::load_rows(conn)?);

    let old_rules = Rules {
        root,
        trips: &trips,
        naming: current,
    };
    let sorted = |g: &Group| {
        let dir = old_rules.target_dir(g);
        g.members
            .iter()
            .all(|m| m.path.parent().is_some_and(|p| same_path(p, &dir)))
    };
    let affected: Vec<Group> = groups.into_iter().filter(sorted).collect();
    let new_rules = Rules {
        root,
        trips: &renamed,
        naming: next,
    };
    let plan = planner::plan(&new_rules, &affected, 0, table, exists);

    let folders: Vec<(i64, String, String)> = trips
        .iter()
        .filter_map(|old| {
            let new = renamed.iter().find(|t| t.id == old.id)?;
            (new.folder != old.folder).then(|| (old.id, old.folder.clone(), new.folder.clone()))
        })
        .collect();
    let data = UndoData {
        before: current,
        after: next,
        folders,
    };
    let on_begin: Arc<OnBegin> = Arc::new(move |conn: &Connection| save(conn, &data));
    Ok(Prepared {
        plan,
        label: "Changed how folders are named".into(),
        on_begin,
    })
}

/// Save new presets and trip folder names with the batch, re-checking that nothing changed
/// since the preview. Returns the undo data.
fn save(conn: &Connection, data: &UndoData) -> Result<Option<String>> {
    let changed =
        || Error::msg("Something changed since the preview. Check the folder names again.");
    if Naming::load(conn)? != data.before {
        return Err(changed());
    }
    let folders: HashMap<i64, String> = trips::load(conn)?
        .into_iter()
        .map(|t| (t.id, t.folder))
        .collect();
    for (id, old, new) in &data.folders {
        if folders.get(id) != Some(old) {
            return Err(changed());
        }
        conn.execute(
            "UPDATE trips SET folder = ?1 WHERE id = ?2",
            params![new, id],
        )?;
    }
    data.after.save(conn)?;
    serde_json::to_string(data)
        .map(Some)
        .map_err(|e| Error::msg(e.to_string()))
}

fn parse_undo(data: &str) -> Result<UndoData> {
    serde_json::from_str(data).map_err(|e| Error::msg(format!("Unreadable undo record: {e}")))
}

/// Refuse to undo a naming change once the presets or a renamed trip have changed again.
/// A trip deleted since is skipped.
pub fn check_undo(conn: &Connection, data: &str) -> Result<()> {
    let data = parse_undo(data)?;
    if Naming::load(conn)? != data.after {
        return Err(Error::msg(
            "The folder names have been changed again since. Undo that change first.",
        ));
    }
    let current = trips::load(conn)?;
    for (id, _, new) in &data.folders {
        if let Some(trip) = current.iter().find(|t| t.id == *id)
            && &trip.folder != new
        {
            return Err(Error::msg(format!(
                "Trip {} has changed since. Undo the later changes to it first.",
                trip.name
            )));
        }
    }
    Ok(())
}

/// Put the presets and trip folder names back the way they were.
pub fn restore(conn: &Connection, data: &str) -> Result<()> {
    let data = parse_undo(data)?;
    for (id, old, _) in &data.folders {
        conn.execute(
            "UPDATE trips SET folder = ?1 WHERE id = ?2",
            params![old, id],
        )?;
    }
    data.before.save(conn)
}

/// Preview renaming every sorted folder to new presets.
#[tauri::command(async)]
pub fn plan_naming(
    state: State<'_, AppState>,
    previews: State<'_, Previews>,
    naming: Naming,
) -> Result<Preview> {
    let (root, prepared, versions) = {
        let conn = lock_db(&state)?;
        let root = library_root(&conn)?;
        let table = format_table(&conn)?;
        let prepared = prepare(&conn, &root, &table, naming, &|p| p.exists())?;
        let versions: HashMap<i64, i64> = index::load_rows(&conn)?
            .iter()
            .map(|r| (r.id, r.mtime))
            .collect();
        (root, prepared, versions)
    };
    let mut preview = organise::describe(&root, &prepared.plan, &versions);
    preview.id = previews.store(PendingBatch {
        kind: "naming",
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
    use chrono::NaiveDate;

    fn at(y: i32, m: u32, d: u32) -> NaiveDateTime {
        NaiveDate::from_ymd_opt(y, m, d)
            .unwrap()
            .and_hms_opt(10, 0, 0)
            .unwrap()
    }

    #[test]
    fn each_month_preset_names_the_folder_inside_its_year() {
        let root = Path::new("L");
        let taken = at(2026, 3, 12);
        let dir = |months| {
            Naming {
                months,
                trips: TripStyle::default(),
            }
            .month_dir(root, &taken)
        };
        assert_eq!(
            dir(MonthStyle::YearMonth),
            root.join("2026").join("2026-03")
        );
        assert_eq!(
            dir(MonthStyle::NumberName),
            root.join("2026").join("03 March")
        );
        assert_eq!(
            dir(MonthStyle::NameYear),
            root.join("2026").join("March 2026")
        );
    }

    #[test]
    fn each_trip_preset_names_the_folder_from_the_start_date() {
        let start = at(2026, 3, 12);
        let name = |trips| {
            Naming {
                months: MonthStyle::default(),
                trips,
            }
            .trip_folder(&start, "Japan")
        };
        assert_eq!(name(TripStyle::DateName), "2026-03-12 Japan");
        assert_eq!(name(TripStyle::NameYear), "Japan 2026");
        assert_eq!(name(TripStyle::YearName), "2026 Japan");
    }

    #[test]
    fn presets_round_trip_through_their_settings_values() {
        assert_eq!(value_of(MonthStyle::NumberName).unwrap(), "number-name");
        assert_eq!(value_of(TripStyle::NameYear).unwrap(), "name-year");
        assert_eq!(parse::<TripStyle>("year-name"), Some(TripStyle::YearName));
        assert_eq!(parse::<MonthStyle>("nonsense"), None);
    }

    #[test]
    fn trips_that_would_share_a_name_get_numbers_in_date_order() {
        let trip = |id, start, name: &str| Trip {
            id,
            name: name.into(),
            start_at: start,
            end_at: start,
            folder: String::new(),
            created_at: 0,
            excluded: Default::default(),
        };
        let trips = vec![
            trip(1, at(2026, 9, 1), "Japan"),
            trip(2, at(2026, 3, 1), "Japan"),
            trip(3, at(2025, 3, 1), "Japan"),
        ];
        let naming = Naming {
            months: MonthStyle::default(),
            trips: TripStyle::NameYear,
        };
        let folders: Vec<(i64, String)> = renamed_trips(&trips, naming)
            .into_iter()
            .map(|t| (t.id, t.folder))
            .collect();
        assert_eq!(
            folders,
            vec![
                (3, "Japan 2025".to_string()),
                (2, "Japan 2026".to_string()),
                (1, "Japan 2026 (2)".to_string()),
            ]
        );
    }
}

#[cfg(test)]
mod batch_tests {
    use super::*;
    use std::fs;
    use std::sync::Mutex;
    use std::sync::atomic::AtomicBool;

    use crate::dates;
    use crate::executor::testing::{library, no_report, snapshot};
    use crate::executor::{self, Env, NewBatch};
    use crate::history;

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

    /// Prepare and apply a naming change on the temp library, as the app does.
    fn rename(db: &Mutex<Connection>, root: &Path, next: Naming) -> (i64, usize) {
        let table = FormatTable::default();
        let prepared = prepare(&db.lock().unwrap(), root, &table, next, &|p| {
            fs::symlink_metadata(p).is_ok()
        })
        .unwrap();
        let files = prepared.plan.file_count();
        let cancel = AtomicBool::new(false);
        let batch = NewBatch {
            kind: "naming",
            label: &prepared.label,
            on_begin: Some(prepared.on_begin.as_ref()),
        };
        let summary =
            executor::apply(&env(db, root, &table, &cancel), &batch, &prepared.plan).unwrap();
        assert_eq!(summary.failed, 0);
        (summary.batch_id, files)
    }

    fn undo(db: &Mutex<Connection>, root: &Path, batch_id: i64) -> Result<()> {
        let table = FormatTable::default();
        let cancel = AtomicBool::new(false);
        history::undo(&env(db, root, &table, &cancel), batch_id).map(|_| ())
    }

    fn files(root: &Path) -> Vec<String> {
        snapshot(root)
            .into_iter()
            .map(|(path, _, _)| path)
            .collect()
    }

    fn folders(db: &Mutex<Connection>) -> Vec<String> {
        trips::load(&db.lock().unwrap())
            .unwrap()
            .into_iter()
            .map(|t| t.folder)
            .collect()
    }

    #[test]
    fn a_new_preset_renames_sorted_folders_and_undo_puts_them_back() {
        let (dir, db) = library(&[
            r"2025\2025-03\IMG_20250301_100000.jpg",
            r"2025\2025-03\IMG_20250301_100000.aae",
            r"Trips\2025-03-12 Japan\IMG_20250312_100000.jpg",
            r"in\IMG_20250401_100000.jpg",
        ]);
        let root = dir.path();
        db.lock()
            .unwrap()
            .execute(
                "INSERT INTO trips (name, start_at, end_at, folder, created_at)
                 VALUES ('Japan', ?1, ?2, '2025-03-12 Japan', 0)",
                params![
                    dates::format(&dates::parse("2025-03-12T00:00:00").unwrap()),
                    dates::format(&dates::parse("2025-03-18T23:59:59").unwrap())
                ],
            )
            .unwrap();
        let before = files(root);
        let words = Naming {
            months: MonthStyle::NumberName,
            trips: TripStyle::NameYear,
        };

        // Sorted photos follow the new names, companions included; unsorted ones stay put.
        let (first, moved) = rename(&db, root, words);
        assert_eq!(moved, 3);
        assert_eq!(
            files(root),
            [
                r"2025\03 March\IMG_20250301_100000.aae",
                r"2025\03 March\IMG_20250301_100000.jpg",
                r"Trips\Japan 2025\IMG_20250312_100000.jpg",
                r"in\IMG_20250401_100000.jpg",
            ]
        );
        assert_eq!(folders(&db), ["Japan 2025"]);
        assert_eq!(Naming::load(&db.lock().unwrap()).unwrap(), words);

        // Nothing left to rename under the same presets.
        let table = FormatTable::default();
        let again = prepare(&db.lock().unwrap(), root, &table, words, &|p| p.exists()).unwrap();
        assert_eq!(again.plan.file_count(), 0);

        // A later change has to be undone first.
        let (second, _) = rename(&db, root, Naming::default());
        let err = undo(&db, root, first).unwrap_err().to_string();
        assert!(err.contains("changed again since"), "{err}");
        undo(&db, root, second).unwrap();
        undo(&db, root, first).unwrap();
        assert_eq!(files(root), before);
        assert_eq!(folders(&db), ["2025-03-12 Japan"]);
        assert_eq!(
            Naming::load(&db.lock().unwrap()).unwrap(),
            Naming::default()
        );
    }
}
