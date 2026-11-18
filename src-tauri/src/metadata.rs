// Work out when each photo or video was taken, plus GPS where the file has it.
//
// Readers are tried fastest first: nom-exif (in-process), then the Windows property system,
// then ExifTool (see exiftool.rs, run as a separate batch pass), then the file name, then the
// file's modified time.

use std::panic::{AssertUnwindSafe, catch_unwind};
use std::path::Path;

use chrono::{DateTime, FixedOffset, Local, NaiveDateTime, TimeZone};
use nom_exif::{
    ExifTag, GPSInfo, LatRef, LonRef, MediaKind, MediaParser, MediaSource, TrackInfoTag,
};

use crate::dates::{self, DateSource};
use crate::formats::{Kind, ext_of};

/// A date read from inside the file.
#[derive(Debug, Clone, PartialEq)]
pub struct Embedded {
    /// Wall-clock time where the photo was taken.
    pub taken_at: NaiveDateTime,
    /// UTC offset at capture, when the file records one.
    pub offset_min: Option<i32>,
    pub source: DateSource,
    pub lat: Option<f64>,
    pub lon: Option<f64>,
}

/// Final answer for one file after every fallback.
#[derive(Debug, Clone, PartialEq)]
pub struct MediaMeta {
    pub taken_at: NaiveDateTime,
    pub offset_min: Option<i32>,
    pub source: DateSource,
    pub lat: Option<f64>,
    pub lon: Option<f64>,
}

impl From<Embedded> for MediaMeta {
    fn from(e: Embedded) -> Self {
        MediaMeta {
            taken_at: e.taken_at,
            offset_min: e.offset_min,
            source: e.source,
            lat: e.lat,
            lon: e.lon,
        }
    }
}

/// Formats nom-exif reads reliably. When it finds no date in one of these, ExifTool won't
/// either (a stripped WhatsApp JPEG, a PNG screenshot), so the slow ExifTool pass skips them.
const NOM_EXIF_COMPLETE: &[&str] = &[
    "jpg", "jpeg", "jpe", "jfif", "png", "gif", "bmp", "dib", "webp", "heic", "heif", "hif", "avif",
];

/// True when a file without an embedded date is worth asking ExifTool about.
pub fn worth_exiftool(path: &Path, kind: Kind) -> bool {
    kind != Kind::Companion && !NOM_EXIF_COMPLETE.contains(&ext_of(path).as_str())
}

/// Try the in-process readers: nom-exif, then the Windows property system.
/// Companion sidecars carry no useful date of their own and are skipped.
pub fn read_fast(parser: &mut MediaParser, path: &Path, kind: Kind) -> Option<Embedded> {
    if kind == Kind::Companion {
        return None;
    }
    // A malformed file must never take the app down, so parser panics count as "no date".
    let nom = catch_unwind(AssertUnwindSafe(|| read_nom_exif(parser, path)))
        .ok()
        .flatten();
    nom.or_else(|| read_windows(path))
}

/// Fill in the name and modified-time fallbacks when no reader found an embedded date.
pub fn finish(path: &Path, mtime: i64, embedded: Option<Embedded>) -> MediaMeta {
    if let Some(e) = embedded {
        return e.into();
    }
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy())
        .unwrap_or_default();
    if let Some(taken_at) = dates::from_filename(&name) {
        return MediaMeta {
            taken_at,
            offset_min: None,
            source: DateSource::Filename,
            lat: None,
            lon: None,
        };
    }
    let taken_at = dates::from_unix_local(mtime).unwrap_or_default();
    MediaMeta {
        taken_at,
        offset_min: None,
        source: DateSource::Modified,
        lat: None,
        lon: None,
    }
}

fn read_nom_exif(parser: &mut MediaParser, path: &Path) -> Option<Embedded> {
    let source = MediaSource::open(path).ok()?;
    match source.kind() {
        MediaKind::Image => {
            let exif: nom_exif::Exif = parser.parse_exif(source).ok()?.into();
            let value = exif
                .get(ExifTag::DateTimeOriginal)
                .or_else(|| exif.get(ExifTag::CreateDate))?;
            let (taken_at, offset_min) = match value.as_datetime()? {
                nom_exif::ExifDateTime::Aware(dt) => (dt.naive_local(), Some(offset_minutes(&dt))),
                nom_exif::ExifDateTime::Naive(dt) => (dt, None),
            };
            let (lat, lon) = exif.gps_info().and_then(gps_decimal).unzip();
            build(taken_at, offset_min, DateSource::Exif, lat, lon)
        }
        MediaKind::Track => {
            let track = parser.parse_track(source).ok()?;
            let created = track.get(TrackInfoTag::CreateDate)?.as_datetime()?;
            let (taken_at, offset_min) = match created {
                nom_exif::ExifDateTime::Aware(dt) => video_local(&dt),
                nom_exif::ExifDateTime::Naive(dt) => (dt, None),
            };
            let (lat, lon) = track.gps_info().and_then(gps_decimal).unzip();
            build(taken_at, offset_min, DateSource::Video, lat, lon)
        }
    }
}

/// Video creation dates come in two flavours. Apple's `com.apple.quicktime.creationdate`
/// carries the real offset, so its wall-clock time is used as-is. The MP4 `mvhd` box is UTC
/// (offset exactly zero), so it is shifted into this PC's time zone; there is no better guess.
fn video_local(dt: &DateTime<FixedOffset>) -> (NaiveDateTime, Option<i32>) {
    if dt.offset().local_minus_utc() == 0 {
        (Local.from_utc_datetime(&dt.naive_utc()).naive_local(), None)
    } else {
        (dt.naive_local(), Some(offset_minutes(dt)))
    }
}

fn offset_minutes(dt: &DateTime<FixedOffset>) -> i32 {
    dt.offset().local_minus_utc() / 60
}

fn build(
    taken_at: NaiveDateTime,
    offset_min: Option<i32>,
    source: DateSource,
    lat: Option<f64>,
    lon: Option<f64>,
) -> Option<Embedded> {
    dates::plausible(&taken_at).then_some(Embedded {
        taken_at,
        offset_min,
        source,
        lat,
        lon,
    })
}

/// Signed decimal degrees, or `None` for missing or null-island (0, 0) coordinates.
fn gps_decimal(gps: &GPSInfo) -> Option<(f64, f64)> {
    let mut lat = gps.latitude.to_decimal_degrees()?;
    let mut lon = gps.longitude.to_decimal_degrees()?;
    if gps.latitude_ref == LatRef::South {
        lat = -lat;
    }
    if gps.longitude_ref == LonRef::West {
        lon = -lon;
    }
    valid_coords(lat, lon)
}

/// Keep coordinates only when they are on the globe and not the (0, 0) placeholder.
pub fn valid_coords(lat: f64, lon: f64) -> Option<(f64, f64)> {
    let on_globe = (-90.0..=90.0).contains(&lat) && (-180.0..=180.0).contains(&lon);
    let placeholder = lat.abs() < 1e-6 && lon.abs() < 1e-6;
    (on_globe && !placeholder && lat.is_finite() && lon.is_finite()).then_some((lat, lon))
}

/// Ask Windows for the date it shows in Explorer's "Date taken" / "Media created" columns.
/// Covers any format with an installed property handler (RAW extension, camcorder formats).
#[cfg(windows)]
fn read_windows(path: &Path) -> Option<Embedded> {
    use windows::Win32::Storage::EnhancedStorage::{PKEY_Media_DateEncoded, PKEY_Photo_DateTaken};
    use windows::Win32::System::Com::StructuredStorage::PropVariantToFileTime;
    use windows::Win32::System::Com::{COINIT_MULTITHREADED, CoInitializeEx};
    use windows::Win32::System::Variant::PSTF_UTC;
    use windows::Win32::UI::Shell::PropertiesSystem::{
        GPS_DEFAULT, IPropertyStore, SHGetPropertyStoreFromParsingName,
    };
    // SAFETY: COM is initialised for this thread before use (a repeat call is harmless), and
    // every pointer passed lives for the duration of its call.
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        let store: IPropertyStore =
            SHGetPropertyStoreFromParsingName(&crate::win::parsing_name(path), None, GPS_DEFAULT)
                .ok()?;
        for key in [PKEY_Photo_DateTaken, PKEY_Media_DateEncoded] {
            let Ok(value) = store.GetValue(&key) else {
                continue;
            };
            let Ok(ft) = PropVariantToFileTime(&value, PSTF_UTC) else {
                continue;
            };
            // FILETIME counts 100 ns ticks since 1601; Windows stored it as UTC after converting
            // from local time with this PC's zone, so converting back recovers the wall-clock.
            let ticks = (u64::from(ft.dwHighDateTime) << 32) | u64::from(ft.dwLowDateTime);
            let secs = (ticks / 10_000_000) as i64 - 11_644_473_600;
            if let Some(taken_at) = dates::from_unix_local(secs)
                && let Some(e) = build(taken_at, None, DateSource::Windows, None, None)
            {
                return Some(e);
            }
        }
        None
    }
}

#[cfg(not(windows))]
fn read_windows(_path: &Path) -> Option<Embedded> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn fixture(name: &str) -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures")
            .join(name)
    }

    fn dt(text: &str) -> NaiveDateTime {
        dates::parse(text).unwrap()
    }

    #[test]
    fn jpeg_exif_date_offset_and_gps() {
        let mut parser = MediaParser::new();
        let e = read_fast(&mut parser, &fixture("exif_gps.jpg"), Kind::Photo).unwrap();
        assert_eq!(e.source, DateSource::Exif);
        assert_eq!(e.taken_at, dt("2024-07-15T09:30:00"));
        assert_eq!(e.offset_min, Some(-7 * 60));
        let (lat, lon) = (e.lat.unwrap(), e.lon.unwrap());
        assert!(
            (lat - 36.1).abs() < 0.01 && (lon + 115.2).abs() < 0.01,
            "{lat},{lon}"
        );
    }

    #[test]
    fn mov_apple_creationdate_keeps_capture_wall_clock() {
        let mut parser = MediaParser::new();
        let e = read_fast(&mut parser, &fixture("apple.mov"), Kind::Video).unwrap();
        assert_eq!(e.source, DateSource::Video);
        assert_eq!(e.taken_at, dt("2024-07-15T09:31:00"));
        assert_eq!(e.offset_min, Some(-7 * 60));
    }

    #[test]
    fn mp4_utc_creation_time_is_shifted_to_local() {
        let mut parser = MediaParser::new();
        let e = read_fast(&mut parser, &fixture("utc.mp4"), Kind::Video).unwrap();
        let expected = Local
            .from_utc_datetime(&dt("2024-07-15T16:32:00"))
            .naive_local();
        assert_eq!(e.taken_at, expected);
        assert_eq!(e.offset_min, None);
    }

    #[test]
    fn png_without_metadata_falls_back_to_filename_then_mtime() {
        let mut parser = MediaParser::new();
        let named = fixture("Screenshot_2024-07-15-10-00-00.png");
        assert_eq!(read_fast(&mut parser, &named, Kind::Photo), None);
        let meta = finish(&named, 0, None);
        assert_eq!(
            (meta.source, meta.taken_at),
            (DateSource::Filename, dt("2024-07-15T10:00:00"))
        );

        let unnamed = fixture("plain.png");
        let meta = finish(
            &unnamed,
            1_700_000_000,
            read_fast(&mut parser, &unnamed, Kind::Photo),
        );
        assert_eq!(meta.source, DateSource::Modified);
        assert_eq!(
            meta.taken_at,
            dates::from_unix_local(1_700_000_000).unwrap()
        );
    }

    #[test]
    fn corrupt_files_and_companions_yield_no_embedded_date() {
        let mut parser = MediaParser::new();
        assert_eq!(
            read_fast(&mut parser, &fixture("corrupt.jpg"), Kind::Photo),
            None
        );
        assert_eq!(
            read_fast(&mut parser, &fixture("exif_gps.jpg"), Kind::Companion),
            None
        );
    }

    #[test]
    fn exiftool_pass_skips_formats_nom_exif_already_covers() {
        assert!(!worth_exiftool(Path::new("a.JPG"), Kind::Photo));
        assert!(!worth_exiftool(Path::new("a.png"), Kind::Photo));
        assert!(!worth_exiftool(Path::new("a.xmp"), Kind::Companion));
        assert!(worth_exiftool(Path::new("a.AVI"), Kind::Video));
        assert!(worth_exiftool(Path::new("a.mts"), Kind::Video));
        assert!(worth_exiftool(Path::new("a.orf"), Kind::Raw));
    }

    #[test]
    fn placeholder_and_out_of_range_coordinates_are_dropped() {
        assert_eq!(valid_coords(0.0, 0.0), None);
        assert_eq!(valid_coords(91.0, 10.0), None);
        assert_eq!(valid_coords(-36.85, 174.76), Some((-36.85, 174.76)));
    }
}
