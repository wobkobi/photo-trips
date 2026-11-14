// Where a "taken" date came from, and parsing dates out of file names.

use std::sync::LazyLock;

use chrono::{Datelike, Local, NaiveDate, NaiveDateTime, NaiveTime, TimeZone};
use regex::Regex;
use serde::{Deserialize, Serialize};

/// Storage format for local wall-clock datetimes in SQLite. Sorts correctly as text.
pub const DT_FORMAT: &str = "%Y-%m-%dT%H:%M:%S";

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DateSource {
    /// EXIF DateTimeOriginal in a photo.
    Exif,
    /// Creation date in a video's metadata.
    Video,
    /// The Windows property system (System.Photo.DateTaken / System.Media.DateEncoded).
    Windows,
    /// ExifTool, for formats the built-in readers don't handle.
    Exiftool,
    /// A date in the file name (IMG_20250312_141500.jpg).
    Filename,
    /// The file's last-modified time. Only a guess, flagged as uncertain in the UI.
    Modified,
}

impl DateSource {
    pub fn as_str(self) -> &'static str {
        match self {
            DateSource::Exif => "exif",
            DateSource::Video => "video",
            DateSource::Windows => "windows",
            DateSource::Exiftool => "exiftool",
            DateSource::Filename => "filename",
            DateSource::Modified => "modified",
        }
    }

    pub fn parse(text: &str) -> DateSource {
        match text {
            "exif" => DateSource::Exif,
            "video" => DateSource::Video,
            "windows" => DateSource::Windows,
            "exiftool" => DateSource::Exiftool,
            "filename" => DateSource::Filename,
            _ => DateSource::Modified,
        }
    }

    /// True for dates read from inside the file, as opposed to guessed from its name or mtime.
    pub fn is_embedded(self) -> bool {
        self <= DateSource::Exiftool
    }
}

/// Reject obviously bogus metadata dates: unset camera clocks (1970, 2000-01-01 on some
/// models), QuickTime's 1904 epoch, and dates in the future.
pub fn plausible(dt: &NaiveDateTime) -> bool {
    let max_year = Local::now().year() + 1;
    (1990..=max_year).contains(&dt.year())
}

/// Year, month and day (time optional) anywhere in a name, with optional separators:
/// IMG_20250312_141500, PXL_20250312_141500123, IMG-20250312-WA0001,
/// Screenshot_2025-03-12-14-15-00, "2025-03-12 14.15.00". The leading guard stops a match
/// starting mid-number (DSC_120250312 is not a date); the trailing guard stops 9+ digit runs.
/// Pixel names glue milliseconds onto the seconds (141500123), so three extra digits are allowed
/// after a full time.
static NAME_DATE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"(?x)
        (?:^|[^0-9])
        (?P<y>19[89]\d|20\d{2}) [-_.]?
        (?P<mo>0[1-9]|1[0-2]) [-_.]?
        (?P<d>0[1-9]|[12]\d|3[01])
        (?:
            [-_\ T.]?
            (?P<h>[01]\d|2[0-3]) [-_.:]?
            (?P<mi>[0-5]\d) [-_.:]?
            (?P<s>[0-5]\d)
            (?:\d{3})?
        )?
        (?:[^0-9]|$)",
    )
    .expect("valid regex")
});

/// Date (and time, if present) in a file name. A date without a time is placed at midday so it
/// sits safely inside that day for trip matching.
pub fn from_filename(name: &str) -> Option<NaiveDateTime> {
    for caps in NAME_DATE.captures_iter(name) {
        let num = |key: &str| caps.name(key).and_then(|m| m.as_str().parse::<u32>().ok());
        let (Some(y), Some(mo), Some(d)) = (num("y"), num("mo"), num("d")) else {
            continue;
        };
        let Some(date) = NaiveDate::from_ymd_opt(y as i32, mo, d) else {
            continue;
        };
        let time = match (num("h"), num("mi"), num("s")) {
            (Some(h), Some(mi), Some(s)) => NaiveTime::from_hms_opt(h, mi, s),
            _ => NaiveTime::from_hms_opt(12, 0, 0),
        };
        let dt = date.and_time(time?);
        if plausible(&dt) {
            return Some(dt);
        }
    }
    None
}

/// A Unix timestamp as wall-clock time in this PC's time zone.
pub fn from_unix_local(secs: i64) -> Option<NaiveDateTime> {
    Local.timestamp_opt(secs, 0).single().map(|dt| dt.naive_local())
}

pub fn format(dt: &NaiveDateTime) -> String {
    dt.format(DT_FORMAT).to_string()
}

pub fn parse(text: &str) -> Option<NaiveDateTime> {
    NaiveDateTime::parse_from_str(text, DT_FORMAT).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dt(text: &str) -> Option<NaiveDateTime> {
        Some(parse(text).unwrap())
    }

    #[test]
    fn reads_common_camera_and_app_name_patterns() {
        assert_eq!(from_filename("IMG_20250312_141500.jpg"), dt("2025-03-12T14:15:00"));
        assert_eq!(from_filename("PXL_20250312_141500123.jpg"), dt("2025-03-12T14:15:00"));
        assert_eq!(from_filename("VID_20250312_141500.mp4"), dt("2025-03-12T14:15:00"));
        assert_eq!(from_filename("IMG-20250312-WA0001.jpg"), dt("2025-03-12T12:00:00"));
        assert_eq!(
            from_filename("Screenshot_2025-03-12-14-15-00-123_com.app.png"),
            dt("2025-03-12T14:15:00")
        );
        assert_eq!(from_filename("2025-03-12 14.15.00.jpg"), dt("2025-03-12T14:15:00"));
        assert_eq!(from_filename("signal-2025-03-12-141500.jpg"), dt("2025-03-12T14:15:00"));
        assert_eq!(from_filename("20250312_141500.heic"), dt("2025-03-12T14:15:00"));
    }

    #[test]
    fn ignores_names_without_a_real_date() {
        for name in [
            "IMG_1234.JPG",
            "DSC01234.NEF",
            "P1020345.RW2",
            "GX010001.MP4",
            "IMG_20251332.jpg",     // month 13
            "IMG_20250230_1200.jpg", // 30 February
            "photo_120250312.jpg",   // starts mid-number
            "id_2025031299.jpg",     // runs into more digits
            "IMG_18990101.jpg",      // implausibly old
        ] {
            assert_eq!(from_filename(name), None, "{name}");
        }
    }

    #[test]
    fn source_ordering_marks_embedded_dates() {
        assert!(DateSource::Exif.is_embedded());
        assert!(DateSource::Exiftool.is_embedded());
        assert!(!DateSource::Filename.is_embedded());
        assert!(DateSource::Exif < DateSource::Modified);
        assert_eq!(DateSource::parse("windows"), DateSource::Windows);
    }

    #[test]
    fn plausibility_rejects_epoch_and_future_dates() {
        assert!(!plausible(&parse("1904-01-01T00:00:00").unwrap()));
        assert!(!plausible(&parse("1970-01-01T00:00:00").unwrap()));
        assert!(!plausible(&parse("2999-01-01T00:00:00").unwrap()));
        assert!(plausible(&parse("2025-03-12T14:15:00").unwrap()));
    }
}
