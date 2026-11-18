// SQLite index of the library: media rows, trips, the move journal and settings.

use std::path::Path;

use rusqlite::{Connection, OptionalExtension, params};

use crate::error::Result;

/// Ordered schema migrations. Index + 1 is the `user_version` each one brings the database to.
/// Never edit a shipped migration; append a new one instead.
const MIGRATIONS: &[&str] = &[
    r#"
    CREATE TABLE settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
    );

    -- One row per supported file under the library root.
    -- taken_at is the wall-clock time where the photo was taken (no time zone), so trips abroad
    -- match the dates the user remembers.
    CREATE TABLE media (
        id            INTEGER PRIMARY KEY,
        path          TEXT NOT NULL UNIQUE,
        group_key     TEXT NOT NULL,
        kind          TEXT NOT NULL,
        size          INTEGER NOT NULL,
        mtime         INTEGER NOT NULL,
        taken_at      TEXT NOT NULL,
        tz_offset_min INTEGER,
        date_source   TEXT NOT NULL,
        lat           REAL,
        lon           REAL,
        hash          TEXT,
        indexed_at    INTEGER NOT NULL
    );
    CREATE INDEX media_taken ON media(taken_at);
    CREATE INDEX media_group ON media(group_key);
    CREATE INDEX media_size  ON media(size);
    CREATE INDEX media_hash  ON media(hash);

    -- start_at / end_at are inclusive local wall-clock times ("YYYY-MM-DDTHH:MM:SS").
    CREATE TABLE trips (
        id         INTEGER PRIMARY KEY,
        name       TEXT NOT NULL,
        start_at   TEXT NOT NULL,
        end_at     TEXT NOT NULL,
        folder     TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL
    );

    -- A batch is one user action (sort, trip change, import, duplicate clean-up) that can be undone.
    CREATE TABLE batches (
        id         INTEGER PRIMARY KEY,
        kind       TEXT NOT NULL,
        label      TEXT NOT NULL,
        status     TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        undone_at  INTEGER
    );

    -- Write-ahead log of file operations. Rows are inserted as 'pending' before anything touches
    -- the disk, so a crash mid-batch can be reconciled at the next start.
    CREATE TABLE journal (
        id       INTEGER PRIMARY KEY,
        batch_id INTEGER NOT NULL REFERENCES batches(id),
        seq      INTEGER NOT NULL,
        op       TEXT NOT NULL,
        src      TEXT NOT NULL,
        dst      TEXT NOT NULL,
        status   TEXT NOT NULL,
        media_id INTEGER
    );
    CREATE INDEX journal_batch ON journal(batch_id, seq);

    CREATE TABLE dismissed_suggestions (
        start_day TEXT NOT NULL,
        end_day   TEXT NOT NULL,
        PRIMARY KEY (start_day, end_day)
    );
"#,
    r#"
    -- Why an entry failed or couldn't be undone, shown in History.
    ALTER TABLE journal ADD COLUMN error TEXT;
    CREATE INDEX journal_status ON journal(status);
"#,
    r#"
    -- JSON a batch needs to reverse its non-file change on undo (a trip's previous dates).
    ALTER TABLE batches ADD COLUMN undo_data TEXT;
"#,
    r#"
    -- The media row of a file sent to the Recycle Bin, as JSON, so undo can put it back in the
    -- index along with the file.
    ALTER TABLE journal ADD COLUMN media_row TEXT;
"#,
    r#"
    -- Hashes of phone files already copied off once. A phone can only be read by copying each
    -- file over, so a file seen before (same path, size and modified time) is matched against
    -- the library by this hash instead of being copied again.
    CREATE TABLE device_files (
        device   TEXT NOT NULL,
        path     TEXT NOT NULL,
        size     INTEGER NOT NULL,
        modified INTEGER NOT NULL,
        hash     TEXT NOT NULL,
        PRIMARY KEY (device, path)
    );
"#,
    r#"
    -- Photos taken during a trip that the user took out of it; they stay in their year and
    -- month folders. Every file of a photo's group is listed. Kept with the trip, not the
    -- dates, so they stay out when the trip's dates change.
    CREATE TABLE trip_exclusions (
        trip_id  INTEGER NOT NULL,
        media_id INTEGER NOT NULL,
        PRIMARY KEY (trip_id, media_id)
    );
"#,
    // A date the user set, used over taken_at. A rescan rewrites taken_at from the file, so the
    // user's date lives in its own column that only Pic Cabinet writes.
    r#"
    ALTER TABLE media ADD COLUMN date_set TEXT;
"#,
    // Phone times were stored as the phone's wall-clock time read as UTC. SQLite's 'utc'
    // modifier reads a time as this PC's local time, giving the real moment, so files already
    // seen still match and aren't copied off the phone again. 0 means the phone gave no time.
    r#"
    UPDATE device_files
    SET modified = CAST(strftime('%s', modified, 'unixepoch', 'utc') AS INTEGER)
    WHERE modified > 0;
"#,
    // A fingerprint of a file's picture or video data alone, leaving out its details, so
    // Duplicates can spot copies whose details differ. '' when ExifTool can't fingerprint the
    // type. camera is 1 when the file names the camera that took it, for choosing which copy
    // to keep. A refresh clears both when the file changes, as it does the hash.
    r#"
    ALTER TABLE media ADD COLUMN fingerprint TEXT;
    ALTER TABLE media ADD COLUMN camera INTEGER;
"#,
    // Hashes of copies Duplicates removed. Import leaves them out, so a copy whose details differ
    // from the one kept (and so has a different hash) doesn't come back from the phone or card
    // it was imported from.
    r#"
    CREATE TABLE removed_copies (
        hash TEXT PRIMARY KEY,
        size INTEGER NOT NULL
    );
"#,
];

/// Index into [`MIGRATIONS`] of the one that turns stored phone times into real moments.
#[cfg(test)]
const PHONE_TIMES: usize = 7;

/// Open (or create) the database and bring it up to the latest schema.
pub fn open(path: &Path) -> Result<Connection> {
    let conn = Connection::open(path)?;
    configure(&conn)?;
    migrate(&conn)?;
    Ok(conn)
}

/// In-memory database with the full schema, for tests.
#[cfg(test)]
pub fn open_in_memory() -> Result<Connection> {
    let conn = Connection::open_in_memory()?;
    configure(&conn)?;
    migrate(&conn)?;
    Ok(conn)
}

fn configure(conn: &Connection) -> Result<()> {
    // WAL lets background jobs write while the UI reads; busy_timeout absorbs short lock waits.
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    conn.busy_timeout(std::time::Duration::from_secs(5))?;
    Ok(())
}

fn migrate(conn: &Connection) -> Result<()> {
    let current: i64 = conn.pragma_query_value(None, "user_version", |row| row.get(0))?;
    for (index, sql) in MIGRATIONS.iter().enumerate().skip(current.max(0) as usize) {
        conn.execute_batch(&format!(
            "BEGIN; {sql} PRAGMA user_version = {}; COMMIT;",
            index + 1
        ))?;
    }
    Ok(())
}

/// Read one setting, or `None` when it has never been set.
pub fn get_setting(conn: &Connection, key: &str) -> Result<Option<String>> {
    Ok(conn
        .query_row("SELECT value FROM settings WHERE key = ?1", [key], |row| {
            row.get(0)
        })
        .optional()?)
}

/// Insert or replace one setting.
pub fn set_setting(conn: &Connection, key: &str, value: &str) -> Result<()> {
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )?;
    Ok(())
}

/// Current time as Unix seconds, for the `*_at` bookkeeping columns.
pub fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_secs() as i64)
}

/// Read a boolean setting stored as "true"/"false", falling back to `default`.
pub fn get_bool(conn: &Connection, key: &str, default: bool) -> Result<bool> {
    Ok(get_setting(conn, key)?.map_or(default, |v| v == "true"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrations_run_once_and_settings_round_trip() {
        let conn = open_in_memory().unwrap();
        migrate(&conn).unwrap();
        assert_eq!(get_setting(&conn, "library_root").unwrap(), None);
        set_setting(&conn, "library_root", "D:\\Photos").unwrap();
        set_setting(&conn, "library_root", "E:\\Photos").unwrap();
        assert_eq!(
            get_setting(&conn, "library_root").unwrap().as_deref(),
            Some("E:\\Photos")
        );
        assert!(get_bool(&conn, "close_to_tray", true).unwrap());
    }

    #[test]
    fn stored_phone_times_become_the_real_moment() {
        use chrono::{Local, NaiveDate, TimeZone};
        // A summer and a winter time, so a daylight-saving zone is tried both ways. Each was
        // stored as its wall-clock time read as UTC; afterwards it must match what the phone
        // reader now gives for the same file.
        let walls = [
            NaiveDate::from_ymd_opt(2026, 11, 14)
                .unwrap()
                .and_hms_opt(13, 36, 13)
                .unwrap(),
            NaiveDate::from_ymd_opt(2025, 6, 2)
                .unwrap()
                .and_hms_opt(8, 5, 0)
                .unwrap(),
        ];
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE device_files (device TEXT, path TEXT, size INTEGER, modified INTEGER,
             hash TEXT)",
        )
        .unwrap();
        for (i, wall) in walls.iter().enumerate() {
            conn.execute(
                "INSERT INTO device_files VALUES ('phone', ?1, 1, ?2, 'h')",
                params![i.to_string(), wall.and_utc().timestamp()],
            )
            .unwrap();
        }
        conn.execute(
            "INSERT INTO device_files VALUES ('phone', 'none', 1, 0, 'h')",
            [],
        )
        .unwrap();
        conn.execute_batch(MIGRATIONS[PHONE_TIMES]).unwrap();
        for (i, wall) in walls.iter().enumerate() {
            let stored: i64 = conn
                .query_row(
                    "SELECT modified FROM device_files WHERE path = ?1",
                    [i.to_string()],
                    |r| r.get(0),
                )
                .unwrap();
            let moment = Local
                .from_local_datetime(wall)
                .earliest()
                .unwrap()
                .timestamp();
            assert_eq!(stored, moment, "{wall}");
        }
        let unset: i64 = conn
            .query_row(
                "SELECT modified FROM device_files WHERE path = 'none'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(unset, 0);
    }
}
