// Long-lived ExifTool process for formats the in-process readers can't date (AVI, MTS, WMV,
// older RAW), and for fingerprinting a file's picture or video data apart from its details. One
// process is reused for every file via `-stay_open`, which avoids the ~150 ms Perl start-up per
// file.

use std::collections::HashMap;
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

/// What ExifTool makes of a file's picture or video data alone.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Picture {
    /// SHA-256 of the image or media data, leaving out every block of details (EXIF, XMP,
    /// QuickTime keys), so copies whose details differ still match. None for types ExifTool
    /// can't hash (MTS, MKV) and damaged files.
    pub fingerprint: Option<String>,
    /// The file names the camera or phone that took it.
    pub camera: bool,
}

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
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| Error::msg("ExifTool stdin unavailable"))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| Error::msg("ExifTool stdout unavailable"))?;
        Ok(Self {
            child,
            stdin,
            stdout: BufReader::new(stdout),
        })
    }

    /// Read the capture date and GPS of one file. `Ok(None)` means ExifTool found no date.
    pub fn read(&mut self, path: &Path) -> Result<Option<Embedded>> {
        let tags: Vec<&str> = DATE_TAGS
            .iter()
            .copied()
            .chain(["OffsetTimeOriginal", "GPSLatitude", "GPSLongitude"])
            .collect();
        Ok(parse_output(&self.tags(path, &tags)?))
    }

    /// ExifTool's JSON for `tags` of one file: an array with one object, holding the tags it
    /// found. Values are numbers where ExifTool has one (-n), so GPS comes as signed decimals.
    pub fn tags(&mut self, path: &Path, tags: &[&str]) -> Result<String> {
        // QuickTimeUTC: QuickTime times are UTC, shift them to the PC's zone.
        let mut args: Vec<String> = ["-json", "-n", "-api", "QuickTimeUTC=1"]
            .into_iter()
            .map(String::from)
            .collect();
        args.extend(tags.iter().map(|tag| format!("-{tag}")));
        args.push(path.to_string_lossy().into_owned());
        self.execute(&args)
    }

    /// Fingerprint the picture or video data of `paths` in one request, which is much faster
    /// than one request per file. A file ExifTool couldn't open (gone, locked) gets None, so it
    /// is tried again later.
    pub fn pictures(&mut self, paths: &[PathBuf]) -> Result<Vec<Option<Picture>>> {
        let mut args: Vec<String> = [
            "-json",
            "-api",
            "ImageHashType=SHA256",
            "-ImageDataHash",
            "-Make",
            "-Model",
        ]
        .into_iter()
        .map(String::from)
        .collect();
        args.extend(paths.iter().map(|p| p.to_string_lossy().into_owned()));
        Ok(parse_pictures(&self.execute(&args)?, paths))
    }

    /// Send one request, one argument per line, and return everything ExifTool printed for it.
    fn execute(&mut self, args: &[String]) -> Result<String> {
        // charset: let non-ASCII Windows paths through, both ways.
        let mut request = String::from("-charset\nfilename=utf8\n");
        for arg in args {
            request.push_str(arg);
            request.push('\n');
        }
        request.push_str("-execute\n");
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
        Ok(output)
    }
}

impl Drop for ExifTool {
    fn drop(&mut self) {
        let _ = self.stdin.write_all(b"-stay_open\nFalse\n");
        let _ = self.stdin.flush();
        let _ = self.child.wait();
    }
}

/// Match ExifTool's JSON for a fingerprint request back to `paths`. Files it couldn't open are
/// left out of the array, so entries are matched by SourceFile, which ExifTool prints with
/// forward slashes.
fn parse_pictures(json: &str, paths: &[PathBuf]) -> Vec<Option<Picture>> {
    let key = |path: &str| path.replace('\\', "/").to_lowercase();
    let entries: Vec<Value> = serde_json::from_str(json).unwrap_or_default();
    let found: HashMap<String, &Value> = entries
        .iter()
        .filter_map(|e| Some((key(e.get("SourceFile")?.as_str()?), e)))
        .collect();
    // A model made only of digits comes back as a JSON number.
    let text = |entry: &Value, tag: &str| {
        entry
            .get(tag)
            .map(|v| v.as_str().map_or_else(|| v.to_string(), str::to_owned))
            .filter(|v| !v.trim().is_empty())
    };
    paths
        .iter()
        .map(|path| {
            let entry = found.get(&key(&path.to_string_lossy()))?;
            Some(Picture {
                fingerprint: text(entry, "ImageDataHash"),
                camera: text(entry, "Make").is_some() || text(entry, "Model").is_some(),
            })
        })
        .collect()
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
        entry
            .get("OffsetTimeOriginal")?
            .as_str()
            .and_then(parse_offset)
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

/// [`ExifTool::pictures`] on `session`, starting ExifTool from `exe` first when there is no
/// session. A failed request drops the session, so the next call starts a fresh process. None
/// when ExifTool couldn't start or answer.
pub fn pictures_with(
    session: &mut Option<ExifTool>,
    exe: &Path,
    paths: &[PathBuf],
) -> Option<Vec<Option<Picture>>> {
    if session.is_none() {
        *session = ExifTool::start(exe)
            .inspect_err(|err| log::warn!("ExifTool failed to start: {err}"))
            .ok();
    }
    match session.as_mut()?.pictures(paths) {
        Ok(found) => Some(found),
        Err(err) => {
            log::warn!(
                "ExifTool failed fingerprinting {} files: {err}",
                paths.len()
            );
            *session = None;
            None
        }
    }
}

/// Path of the bundled ExifTool, when it is present.
pub fn locate(resource_dir: &Path) -> Option<PathBuf> {
    let exe = resource_dir
        .join("resources")
        .join("exiftool")
        .join("exiftool.exe");
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
        assert_eq!(
            parse_date("2024:07:15 09:34:00"),
            Some((dt("2024-07-15T09:34:00"), None))
        );
        assert_eq!(
            parse_date("2024:07:15 09:31:00-07:00"),
            Some((dt("2024-07-15T09:31:00"), Some(-420)))
        );
        assert_eq!(
            parse_date("2024:07:15 09:31:00.123+05:30"),
            Some((dt("2024-07-15T09:31:00"), Some(330)))
        );
        let utc = parse_date("2024:07:15 16:33:00Z").unwrap();
        assert_eq!(
            utc.0,
            Local
                .from_utc_datetime(&dt("2024-07-15T16:33:00"))
                .naive_local()
        );
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

    #[test]
    fn pictures_match_without_their_details_in_one_request() {
        let Some(mut tool) = exiftool() else {
            eprintln!("ExifTool not fetched; skipping");
            return;
        };
        let fixtures = manifest().join("tests/fixtures");
        let dir = tempfile::tempdir().unwrap();
        let stripped = dir.path().join("stripped.jpg");
        let exe = locate(&manifest()).unwrap();
        let status = Command::new(&exe)
            .args(["-q", "-all=", "-o"])
            .arg(&stripped)
            .arg(fixtures.join("exif_gps.jpg"))
            .status()
            .unwrap();
        assert!(status.success());

        let paths = [
            fixtures.join("exif_gps.jpg"),
            stripped,
            dir.path().join("missing.jpg"),
            fixtures.join("00001.mts"),
            fixtures.join("plain.png"),
        ];
        let found = tool.pictures(&paths).unwrap();
        let print = |i: usize| found[i].as_ref().unwrap().fingerprint.clone();
        assert!(print(0).is_some());
        assert_eq!(print(0), print(1), "the same picture without its details");
        assert!(found[2].is_none(), "a missing file is tried again later");
        assert_eq!(print(3), None, "a type ExifTool can't fingerprint");
        assert_ne!(print(4), print(0));
    }

    #[test]
    fn picture_entries_are_matched_by_file_not_order() {
        let paths = [PathBuf::from(r"C:\L\a.jpg"), PathBuf::from(r"C:\L\b.jpg")];
        let json = r#"[{"SourceFile":"C:/L/B.jpg","ImageDataHash":"bb","Model":5},
            {"SourceFile":"C:/L/a.jpg","ImageDataHash":"","Make":" "}]"#;
        let found = parse_pictures(json, &paths);
        assert_eq!(
            found,
            [
                Some(Picture {
                    fingerprint: None,
                    camera: false
                }),
                Some(Picture {
                    fingerprint: Some("bb".into()),
                    camera: true
                }),
            ]
        );
        assert_eq!(parse_pictures("not json", &paths), [None, None]);
    }
}
