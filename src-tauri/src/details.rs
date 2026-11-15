// Camera, picture size and camera settings for the viewer's side panel, read from the file by
// ExifTool when the viewer shows it. None of this is stored: the index keeps only what sorting
// needs.

use std::path::Path;
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Manager};

use crate::error::{Error, Result};
use crate::exiftool::{self, ExifTool};
use crate::metadata::valid_coords;

const TAGS: &[&str] = &[
    "Make",
    "Model",
    "LensModel",
    "Lens",
    "ImageWidth",
    "ImageHeight",
    "Orientation",
    "Rotation",
    "Duration",
    "FNumber",
    "ExposureTime",
    "ISO",
    "FocalLength",
    "FocalLengthIn35mmFormat",
    "GPSLatitude",
    "GPSLongitude",
];

/// The ExifTool process stays open between files while someone steps through the viewer, and
/// closes once it has sat unused this long.
const IDLE: Duration = Duration::from_secs(90);

/// What the file says about itself. Every field is missing when the file doesn't record it.
#[derive(Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Details {
    pub make: Option<String>,
    pub model: Option<String>,
    pub lens: Option<String>,
    /// Pixels as the photo is shown, so a portrait photo stored sideways is taller than wide.
    pub width: Option<u32>,
    pub height: Option<u32>,
    /// A video's length in seconds.
    pub duration: Option<f64>,
    pub f_number: Option<f64>,
    /// Seconds.
    pub exposure: Option<f64>,
    pub iso: Option<u32>,
    /// Millimetres, as fitted and as the full-frame equivalent.
    pub focal_length: Option<f64>,
    pub focal_35: Option<f64>,
    pub lat: Option<f64>,
    pub lon: Option<f64>,
}

/// Read `path`'s details. A missing ExifTool or an unreadable file gives empty details rather
/// than an error, since the viewer has everything else to show.
pub fn read(app: &AppHandle, path: &Path) -> Details {
    match query(app, path) {
        Ok(json) => parse(&json),
        Err(err) => {
            log::warn!("Couldn't read the details of {}: {err}", path.display());
            Details::default()
        }
    }
}

static SESSION: Mutex<Option<(ExifTool, Instant)>> = Mutex::new(None);

fn query(app: &AppHandle, path: &Path) -> Result<String> {
    let mut session = SESSION
        .lock()
        .map_err(|_| Error::msg("ExifTool lock poisoned"))?;
    // A process that has died since the last file is replaced, once.
    for attempt in 0..2 {
        if session.is_none() {
            let exe = app
                .path()
                .resource_dir()
                .ok()
                .and_then(|dir| exiftool::locate(&dir))
                .ok_or_else(|| Error::msg("ExifTool is missing from the install folder"))?;
            *session = Some((ExifTool::start(&exe)?, Instant::now()));
            close_when_idle();
        }
        let (tool, used) = session.as_mut().expect("started above");
        *used = Instant::now();
        match tool.tags(path, TAGS) {
            Ok(json) => return Ok(json),
            Err(err) if attempt == 0 => {
                log::warn!("ExifTool stopped answering, starting it again: {err}");
                *session = None;
            }
            Err(err) => return Err(err),
        }
    }
    unreachable!("the second attempt returns")
}

/// Watch a newly started session and close it once it's idle. The watcher ends with it.
fn close_when_idle() {
    thread::spawn(|| {
        loop {
            thread::sleep(IDLE / 3);
            let Ok(mut session) = SESSION.lock() else {
                return;
            };
            match session.as_ref() {
                Some((_, used)) if used.elapsed() < IDLE => {}
                _ => {
                    *session = None;
                    return;
                }
            }
        }
    });
}

/// Pull the details out of ExifTool's JSON (an array with one object per file).
fn parse(json: &str) -> Details {
    let Some(entry) = serde_json::from_str::<Value>(json)
        .ok()
        .and_then(|v| v.as_array()?.first().cloned())
    else {
        return Details::default();
    };
    let text = |tag: &str| {
        let value = entry.get(tag)?;
        let text = match value {
            Value::String(s) => s.trim().to_owned(),
            Value::Number(n) => n.to_string(),
            _ => return None,
        };
        (!text.is_empty()).then_some(text)
    };
    // Numbers, which ExifTool sometimes gives as text ("1/120" isn't one, but -n avoids that).
    let number = |tag: &str| {
        let value = entry.get(tag)?;
        let n = value
            .as_f64()
            .or_else(|| value.as_str()?.trim().parse().ok())?;
        (n.is_finite() && n > 0.0).then_some(n)
    };
    let whole = |tag: &str| number(tag).and_then(|n| u32::try_from(n.round() as u64).ok());

    let (mut width, mut height) = (whole("ImageWidth"), whole("ImageHeight"));
    // EXIF orientations 5 to 8 turn the picture a quarter, as does a video's 90 or 270.
    let orientation = number("Orientation").unwrap_or(1.0) as u32;
    let rotation = number("Rotation").unwrap_or(0.0) as u32 % 180;
    if (5..=8).contains(&orientation) || rotation == 90 {
        (width, height) = (height, width);
    }
    let coords = number_signed(&entry, "GPSLatitude")
        .zip(number_signed(&entry, "GPSLongitude"))
        .and_then(|(lat, lon)| valid_coords(lat, lon));

    Details {
        make: text("Make"),
        model: text("Model"),
        lens: text("LensModel").or_else(|| text("Lens")),
        width,
        height,
        duration: number("Duration"),
        f_number: number("FNumber"),
        exposure: number("ExposureTime"),
        iso: whole("ISO"),
        focal_length: number("FocalLength"),
        focal_35: number("FocalLengthIn35mmFormat"),
        lat: coords.map(|c| c.0),
        lon: coords.map(|c| c.1),
    }
}

/// A number that may be negative, as GPS coordinates are with -n.
fn number_signed(entry: &Value, tag: &str) -> Option<f64> {
    let value = entry.get(tag)?;
    value
        .as_f64()
        .or_else(|| value.as_str()?.trim().parse().ok())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_a_phone_photo() {
        let json = r#"[{"SourceFile":"x.jpg","Make":"Apple","Model":"iPhone 13","LensModel":"iPhone 13 back dual wide camera 5.1mm f/1.6",
            "ImageWidth":4032,"ImageHeight":3024,"Orientation":6,"FNumber":1.6,"ExposureTime":0.008333,"ISO":50,
            "FocalLength":5.1,"FocalLengthIn35mmFormat":26,"GPSLatitude":-38.1368,"GPSLongitude":176.2497}]"#;
        let d = parse(json);
        assert_eq!(d.make.as_deref(), Some("Apple"));
        assert_eq!(d.model.as_deref(), Some("iPhone 13"));
        assert!(d.lens.unwrap().starts_with("iPhone 13 back"));
        assert_eq!(
            (d.width, d.height),
            (Some(3024), Some(4032)),
            "turned upright"
        );
        assert_eq!(d.iso, Some(50));
        assert_eq!(d.focal_35, Some(26.0));
        assert_eq!((d.lat, d.lon), (Some(-38.1368), Some(176.2497)));
        assert_eq!(d.duration, None);
    }

    #[test]
    fn reads_a_turned_video_and_numbers_given_as_text() {
        let json = r#"[{"ImageWidth":"1920","ImageHeight":1080,"Rotation":90,"Duration":"134.5","Model":" "}]"#;
        let d = parse(json);
        assert_eq!((d.width, d.height), (Some(1080), Some(1920)));
        assert_eq!(d.duration, Some(134.5));
        assert_eq!(d.model, None, "blank text is no text");
    }

    #[test]
    fn nothing_useful_gives_empty_details() {
        assert_eq!(parse("not json"), Details::default());
        assert_eq!(parse("[]"), Details::default());
        let d = parse(r#"[{"GPSLatitude":0,"GPSLongitude":0,"ISO":0,"Make":12}]"#);
        assert_eq!(
            (d.lat, d.iso),
            (None, None),
            "the 0,0 placeholder and a zero ISO"
        );
        assert_eq!(d.make.as_deref(), Some("12"));
    }
}
