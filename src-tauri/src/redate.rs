// Dates the user sets for photos whose own date is wrong or only a guess. Kept in the database
// only (media.date_set): the files are never changed, so other apps still show their own dates.
// Each change is a History entry that can be undone.

use chrono::{Datelike, Duration, Local, NaiveDateTime};
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::AppState;
use crate::commands::lock_db;
use crate::db;
use crate::dates;
use crate::error::{Error, Result};
use crate::groups;
use crate::index;

/// Earliest date that can be set. Older still would be a typo, not a photo.
const EARLIEST_YEAR: i32 = 1826;

/// What undoing a date change needs, kept as the batch's undo data.
#[derive(Debug, Serialize, Deserialize)]
struct Undo {
    /// The date the change set, or None when it went back to the files' own dates.
    set: Option<String>,
    /// Each file's set date before the change, by media id.
    before: Vec<(i64, Option<String>)>,
}

/// Set the date of picked photos, with every file that goes with each (Live Photo video, RAW
/// twin, sidecars), or with `date` None go back to the dates in the files. `ids` are leader media
/// ids; `date` is local wall-clock time, `YYYY-MM-DDTHH:MM:SS`. Returns the History batch id,
/// for an Undo button.
#[tauri::command(async)]
pub fn set_dates(state: State<'_, AppState>, ids: Vec<i64>, date: Option<String>) -> Result<i64> {
    let when = date.as_deref().map(checked).transpose()?;
    let mut conn = lock_db(&state)?;
    let (groups, _orphans) = groups::build(index::load_rows(&conn)?);
    let picked: Vec<_> = groups
        .iter()
        .filter(|g| ids.contains(&g.leader().id))
        .collect();
    if picked.is_empty() {
        return Err(Error::msg("These photos are no longer in the library"));
    }
    let members: Vec<i64> = picked
        .iter()
        .flat_map(|g| g.members.iter().map(|m| m.id))
        .collect();
    let label = label(picked.len(), when.as_ref());
    let tx = conn.transaction()?;
    let batch = record(&tx, &members, when.map(|w| dates::format(&w)), &label)?;
    tx.commit()?;
    Ok(batch)
}

/// Parse a date from the UI and refuse one that can't be right.
fn checked(text: &str) -> Result<NaiveDateTime> {
    let when = dates::parse(text).ok_or_else(|| Error::msg("That date isn't a real date"))?;
    if when.year() < EARLIEST_YEAR {
        return Err(Error::msg("That date is too long ago"));
    }
    if when > Local::now().naive_local() + Duration::days(1) {
        return Err(Error::msg("That date is in the future"));
    }
    Ok(when)
}

/// History's line for a date change.
fn label(photos: usize, when: Option<&NaiveDateTime>) -> String {
    let noun = if photos == 1 { "photo" } else { "photos" };
    match when {
        Some(when) => format!(
            "Set the date of {photos} {noun} to {}",
            when.format("%-d %B %Y")
        ),
        None => format!("Went back to the file's own date for {photos} {noun}"),
    }
}

/// Write the new dates and the History entry that can undo them, in the caller's transaction.
/// Returns the batch id.
fn record(conn: &Connection, members: &[i64], set: Option<String>, label: &str) -> Result<i64> {
    let mut before = Vec::with_capacity(members.len());
    {
        let mut read = conn.prepare("SELECT date_set FROM media WHERE id = ?1")?;
        let mut write = conn.prepare("UPDATE media SET date_set = ?1 WHERE id = ?2")?;
        for &id in members {
            let old: Option<String> = read.query_row([id], |r| r.get(0))?;
            before.push((id, old));
            write.execute(params![set, id])?;
        }
    }
    let undo =
        serde_json::to_string(&Undo { set, before }).map_err(|e| Error::msg(e.to_string()))?;
    conn.execute(
        "INSERT INTO batches (kind, label, status, created_at, undo_data)
         VALUES ('date', ?1, 'done', ?2, ?3)",
        params![label, db::now(), undo],
    )?;
    Ok(conn.last_insert_rowid())
}

fn parse_undo(data: &str) -> Result<Undo> {
    serde_json::from_str(data).map_err(|_| Error::msg("This change can't be undone"))
}

/// Refuse to undo a date change when any of its photos has had its date changed again since,
/// so a later change isn't lost. Photos gone from the library are passed over.
pub fn check_undo(conn: &Connection, data: &str) -> Result<()> {
    let undo = parse_undo(data)?;
    let mut read = conn.prepare("SELECT date_set FROM media WHERE id = ?1")?;
    for (id, _) in &undo.before {
        let now: Option<Option<String>> = read.query_row([id], |r| r.get(0)).optional()?;
        if let Some(now) = now
            && now != undo.set
        {
            return Err(Error::msg(
                "Some of these dates have been changed again since. Undo that change first.",
            ));
        }
    }
    Ok(())
}

/// Put each photo's set date back the way it was before the change.
pub fn restore(conn: &Connection, data: &str) -> Result<()> {
    let undo = parse_undo(data)?;
    let mut write = conn.prepare("UPDATE media SET date_set = ?1 WHERE id = ?2")?;
    for (id, old) in &undo.before {
        write.execute(params![old, id])?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dates::DateSource;

    fn insert(conn: &Connection, id: i64, path: &str) {
        conn.execute(
            "INSERT INTO media (id, path, group_key, kind, size, mtime, taken_at, date_source,
                                indexed_at)
             VALUES (?1, ?2, ?2, 'photo', 1, 1, '2023-07-23T16:42:00', 'modified', 0)",
            params![id, path],
        )
        .unwrap();
    }

    fn date_of(conn: &Connection, id: i64) -> (String, DateSource) {
        let row = index::load_rows(conn)
            .unwrap()
            .into_iter()
            .find(|r| r.id == id)
            .unwrap();
        (dates::format(&row.taken_at), row.date_source)
    }

    #[test]
    fn a_set_date_wins_over_the_file_and_undoes_back_to_it() {
        let conn = db::open_in_memory().unwrap();
        insert(&conn, 1, "C:\\L\\scan1.png");
        insert(&conn, 2, "C:\\L\\scan2.png");

        let set = Some("1998-12-25T09:00:00".to_string());
        let batch = record(&conn, &[1], set, "label").unwrap();
        assert_eq!(date_of(&conn, 1), ("1998-12-25T09:00:00".into(), DateSource::Set));
        assert_eq!(date_of(&conn, 2).1, DateSource::Modified);

        let data: String = conn
            .query_row("SELECT undo_data FROM batches WHERE id = ?1", [batch], |r| r.get(0))
            .unwrap();
        check_undo(&conn, &data).unwrap();
        restore(&conn, &data).unwrap();
        assert_eq!(date_of(&conn, 1), ("2023-07-23T16:42:00".into(), DateSource::Modified));
    }

    #[test]
    fn undo_is_refused_once_the_date_has_changed_again() {
        let conn = db::open_in_memory().unwrap();
        insert(&conn, 1, "C:\\L\\scan1.png");
        record(&conn, &[1], Some("1998-12-25T09:00:00".into()), "first").unwrap();
        let first: String = conn
            .query_row("SELECT undo_data FROM batches ORDER BY id LIMIT 1", [], |r| r.get(0))
            .unwrap();
        record(&conn, &[1], Some("1999-01-01T09:00:00".into()), "second").unwrap();
        assert!(check_undo(&conn, &first).is_err());
    }

    #[test]
    fn dates_that_cannot_be_right_are_refused() {
        assert!(checked("1998-12-25T09:00:00").is_ok());
        assert!(checked("1998-12-25").is_err());
        assert!(checked("1700-01-01T00:00:00").is_err());
        assert!(checked("2999-01-01T00:00:00").is_err());
    }

    #[test]
    fn history_labels_read_naturally() {
        let when = dates::parse("1998-12-05T09:00:00").unwrap();
        assert_eq!(label(1, Some(&when)), "Set the date of 1 photo to 5 December 1998");
        assert_eq!(label(3, None), "Went back to the file's own date for 3 photos");
    }
}
