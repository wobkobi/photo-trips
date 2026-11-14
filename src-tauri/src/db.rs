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
];

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
}
