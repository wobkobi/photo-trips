// Long-lived ExifTool process for formats the in-process readers can't date (AVI, MTS, WMV,
// older RAW). One process is reused for every file via `-stay_open`, which avoids the
// ~150 ms Perl start-up per file.

use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};

use chrono::{DateTime, Local, NaiveDateTime};
use serde_json::Value;

use crate::dates::{self, DateSource};
use crate::error::{Error, Result};
use crate::metadata::{Embedded, valid_coords};

/// Date tags in priority order. CreationDate is Apple's offset-carrying QuickTime key;
/// DateCreated is the RIFF/AVI ICRD chunk.
const DATE_TAGS: &[&str] = &[
    "DateTimeOriginal",
    "CreationDate",
    "CreateDate",
    "MediaCreateDate",
    "DateCreated",
    "DateTimeCreated",
];

pub struct ExifTool {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
}

impl ExifTool {
    /// Start ExifTool in stay-open mode. Fails when the executable is missing.
    pub fn start(exe: &Path) -> Result<Self> {
        let mut command = Command::new(exe);
        command
            .args(["-stay_open", "True", "-@", "-"])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            // CREATE_NO_WINDOW: no console flashes up while the app is in the tray.
            command.creation_flags(0x0800_0000);
        }
        let mut child = command.spawn()?;
        let stdin = child.stdin.take().ok_or_else(|| Error::msg("ExifTool stdin unavailable"))?;
        let stdout = child.stdout.take().ok_or_else(|| Error::msg("ExifTool stdout unavailable"))?;
        Ok(Self { child, stdin, stdout: BufReader::new(stdout) })
    }

    /// Read the capture date and GPS of one file. `Ok(None)` means ExifTool found no date.
    pub fn read(&mut self, path: &Path) -> Result<Option<Embedded>> {
        let mut request = String::new();
        // -n: GPS as signed decimals. QuickTimeUTC: QuickTime times are UTC, shift them to the
        // PC's zone. charset: let non-ASCII Windows paths through.
        for arg in ["-json", "-n", "-api", "QuickTimeUTC=1", "-charset", "filename=utf8"] {
            request.push_str(arg);
            request.push('\n');
        }
        for tag in DATE_TAGS.iter().chain(&["OffsetTimeOriginal", "GPSLatitude", "GPSLongitude"]) {
            request.push_str(&format!("-{tag}\n"));
        }
        request.push_str(&path.to_string_lossy());
        request.push_str("\n-execute\n");
        self.stdin.write_all(request.as_bytes())?;
        self.stdin.flush()?;

        let mut output = String::new();
        loop {
            let mut line = String::new();
            if self.stdout.read_line(&mut line)? == 0 {
                return Err(Error::msg("ExifTool exited unexpectedly"));
            }
            if line.trim_end() == "{ready}" {
                break;
            }
            output.push_str(&line);
        }
        Ok(parse_output(&output))
    }
}

impl Drop for ExifTool {
    fn drop(&mut self) {
        let _ = self.stdin.write_all(b"-stay_open\nFalse\n");
        let _ = self.stdin.flush();
        let _ = self.child.wait();
    }
}

/// Pull the best date and GPS out of ExifTool's JSON (an array with one object per file).
fn parse_output(json: &str) -> Option<Embedded> {
    let parsed: Value = serde_json::from_str(json).ok()?;
    let entry = parsed.as_array()?.first()?;
    let (taken_at, offset_min) = DATE_TAGS
        .iter()
        .filter_map(|tag| entry.get(*tag)?.as_str())
        .find_map(parse_date)?;
    let offset_min = offset_min.or_else(|| {
        entry.get("OffsetTimeOriginal")?.as_str().and_then(parse_offset)
    });
    let coords = entry
        .get("GPSLatitude")
        .and_then(Value::as_f64)
        .zip(entry.get("GPSLongitude").and_then(Value::as_f64))
        .and_then(|(lat, lon)| valid_coords(lat, lon));
    Some(Embedded {
        taken_at,
        offset_min,
        source: DateSource::Exiftool,
        lat: coords.map(|c| c.0),
        lon: coords.map(|c| c.1),
    })
}

/// Parse "YYYY:MM:DD HH:MM:SS[.sss][Z|+HH:MM|-HH:MM]".
///
/// The wall-clock part is kept as-is, because with an offset it is already the capture-local
/// (or PC-local, after QuickTimeUTC) time. A trailing Z means UTC, which is shifted into the
/// PC's zone. All-zero placeholder dates fail to parse and are skipped.
fn parse_date(text: &str) -> Option<(NaiveDateTime, Option<i32>)> {
    let text = text.trim();
    let wall = NaiveDateTime::parse_from_str(text.get(..19)?, "%Y:%m:%d %H:%M:%S").ok()?;
    let rest = text[19..].trim_start_matches(|c: char| c == '.' || c.is_ascii_digit());
    let (taken_at, offset) = if rest.eq_ignore_ascii_case("z") {
        let local = DateTime::<Local>::from(wall.and_utc()).naive_local();
        (local, None)
    } else {
        (wall, parse_offset(rest))
    };
    dates::plausible(&taken_at).then_some((taken_at, offset))
}

/// "+13:00" / "-07:00" / "+0530" as minutes east of UTC.
fn parse_offset(text: &str) -> Option<i32> {
    let text = text.trim();
    let sign = match text.chars().next()? {
        '+' => 1,
        '-' => -1,
        _ => return None,
    };
    let digits: String = text[1..].chars().filter(char::is_ascii_digit).collect();
    if digits.len() != 4 {
        return None;
    }
    let hours: i32 = digits[..2].parse().ok()?;
    let minutes: i32 = digits[2..].parse().ok()?;
    Some(sign * (hours * 60 + minutes))
}

/// Path of the bundled ExifTool, when it is present.
pub fn locate(resource_dir: &Path) -> Option<PathBuf> {
    let exe = resource_dir.join("resources").join("exiftool").join("exiftool.exe");
    exe.is_file().then_some(exe)
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn manifest() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
    }

    fn exiftool() -> Option<ExifTool> {
        locate(&manifest()).map(|exe| ExifTool::start(&exe).unwrap())
    }

    fn dt(text: &str) -> NaiveDateTime {
        dates::parse(text).unwrap()
    }

    #[test]
    fn parses_date_variants() {
        assert_eq!(parse_date("2024:07:15 09:34:00"), Some((dt("2024-07-15T09:34:00"), None)));
        assert_eq!(
            parse_date("2024:07:15 09:31:00-07:00"),
            Some((dt("2024-07-15T09:31:00"), Some(-420)))
        );
        assert_eq!(
            parse_date("2024:07:15 09:31:00.123+05:30"),
            Some((dt("2024-07-15T09:31:00"), Some(330)))
        );
        let utc = parse_date("2024:07:15 16:33:00Z").unwrap();
        assert_eq!(utc.0, Local.from_utc_datetime(&dt("2024-07-15T16:33:00")).naive_local());
        assert_eq!(parse_date("0000:00:00 00:00:00"), None);
        assert_eq!(parse_date("garbage"), None);
    }

    #[test]
    fn picks_highest_priority_tag_and_gps() {
        let json = r#"[{"SourceFile":"x","CreateDate":"2024:01:01 00:00:00",
            "DateTimeOriginal":"2024:07:15 09:30:00","OffsetTimeOriginal":"-07:00",
            "GPSLatitude":-36.85,"GPSLongitude":174.76}]"#;
        let e = parse_output(json).unwrap();
        assert_eq!(e.taken_at, dt("2024-07-15T09:30:00"));
        assert_eq!(e.offset_min, Some(-420));
        assert_eq!((e.lat, e.lon), (Some(-36.85), Some(174.76)));
        assert_eq!(parse_output(r#"[{"SourceFile":"x"}]"#), None);
    }

    #[test]
    fn reads_avi_that_only_exiftool_understands() {
        let Some(mut tool) = exiftool() else {
            eprintln!("ExifTool not fetched; skipping");
            return;
        };
        let fixtures = manifest().join("tests/fixtures");
        let e = tool.read(&fixtures.join("old.avi")).unwrap().unwrap();
        assert_eq!(e.taken_at, dt("2024-07-15T09:34:00"));
        assert_eq!(e.source, DateSource::Exiftool);
        // Camcorder MPEG-TS without a date: no answer, and the process keeps working after.
        assert_eq!(tool.read(&fixtures.join("00001.mts")).unwrap(), None);
        let mov = tool.read(&fixtures.join("apple.mov")).unwrap().unwrap();
        assert_eq!(mov.taken_at, dt("2024-07-15T09:31:00"));
    }
}
