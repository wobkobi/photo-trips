// Folders that look like trips the app doesn't know about: "Trips\Hamilton 2026" left behind by a
// trip that was deleted, or "Japan" made by hand before Pic Cabinet. Sort would spread their
// files into month folders, so Suggestions offers each one as a trip first.
//
// A folder counts when its name is more than a date ("2019\2019-02", "02 February" and "DCIM" are
// filing systems, not trips) and its photos fit a trip: any folder under Trips, or elsewhere at
// least `MIN_GROUPS` photos taken within `MAX_DAYS_ELSEWHERE` days. Folders over a trip or a
// dismissed suggestion are left out, so dismissing one hands it back to the normal sort.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use chrono::NaiveDate;

use crate::dates::DateSource;
use crate::groups::Group;
use crate::trips::{self, TRIPS_DIR, Trip};

/// Photos a folder outside Trips needs before it looks like a trip rather than a few strays.
const MIN_GROUPS: usize = 5;
/// Longest span, first day to last, for a folder outside Trips. A folder of a whole season is
/// more likely a topic ("Garden") than a trip.
const MAX_DAYS_ELSEWHERE: i64 = 31;
/// Longest span for a folder under Trips.
const MAX_DAYS_IN_TRIPS: i64 = 92;

/// Folder names that are where cameras, phones and apps put photos, not trips.
const GENERIC: [&str; 16] = [
    "camera",
    "camera roll",
    "dcim",
    "downloads",
    "import",
    "imported",
    "imports",
    "new folder",
    "photos",
    "pictures",
    "saved pictures",
    "screenshots",
    "trips",
    "unsorted",
    "videos",
    "whatsapp images",
];

const MONTHS: [&str; 12] = [
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
];

/// A folder that looks like a trip.
#[derive(Debug, Clone, PartialEq)]
pub struct FolderTrip {
    /// Relative to the library folder, e.g. "Trips\Hamilton 2026".
    pub folder: String,
    /// The folder name without its dates, e.g. "Hamilton".
    pub name: String,
    /// First and last day a photo in it was taken.
    pub start: NaiveDate,
    pub end: NaiveDate,
}

/// Every folder under `root` that looks like a trip no trip or dismissed suggestion covers,
/// newest first.
pub fn find(
    root: &Path,
    groups: &[Group],
    trips: &[Trip],
    dismissed: &[(NaiveDate, NaiveDate)],
) -> Vec<FolderTrip> {
    let mut folders: BTreeMap<PathBuf, Vec<&Group>> = BTreeMap::new();
    for group in groups {
        let Some(parent) = group.leader().path.parent() else {
            continue;
        };
        if let Ok(inside) = parent.strip_prefix(root)
            && !inside.as_os_str().is_empty()
        {
            folders.entry(inside.to_path_buf()).or_default().push(group);
        }
    }
    let mut found: Vec<FolderTrip> = folders
        .into_iter()
        .filter_map(|(folder, members)| looks_like_trip(&folder, &members, trips))
        .filter(|f| {
            let (start, end) = (f.start.and_hms_opt(0, 0, 0), f.end.and_hms_opt(23, 59, 59));
            let (Some(start), Some(end)) = (start, end) else {
                return false;
            };
            trips.iter().all(|t| t.end_at < start || end < t.start_at)
                && dismissed.iter().all(|(s, e)| *e < f.start || f.end < *s)
        })
        .collect();
    found.sort_by(|a, b| b.start.cmp(&a.start).then_with(|| a.folder.cmp(&b.folder)));
    found
}

/// The folder as a trip, when its name and photos fit one.
fn looks_like_trip(folder: &Path, members: &[&Group], trips: &[Trip]) -> Option<FolderTrip> {
    let parts: Vec<String> = folder
        .components()
        .map(|c| c.as_os_str().to_string_lossy().into_owned())
        .collect();
    let in_trips = parts.len() == 2 && parts[0].eq_ignore_ascii_case(TRIPS_DIR);
    // A trip's own folder is already sorted; its files only move when they leave the trip.
    if in_trips
        && trips
            .iter()
            .any(|t| t.folder.eq_ignore_ascii_case(&parts[1]))
    {
        return None;
    }
    let name = trip_name(parts.last()?)?;
    // A date guessed from the file's modified time says when it was copied, not taken.
    let days: Vec<NaiveDate> = members
        .iter()
        .filter(|g| g.date_source != DateSource::Modified)
        .map(|g| g.taken_at.date())
        .collect();
    let (start, end) = (*days.iter().min()?, *days.iter().max()?);
    let span = (end - start).num_days() + 1;
    let fits = if in_trips {
        span <= MAX_DAYS_IN_TRIPS
    } else {
        members.len() >= MIN_GROUPS && span <= MAX_DAYS_ELSEWHERE
    };
    fits.then(|| FolderTrip {
        folder: folder.to_string_lossy().into_owned(),
        name,
        start,
        end,
    })
}

/// A trip name from a folder name: "2025-03-12 Japan", "Japan 2025" and "2025 Japan" all give
/// "Japan", the three ways Pic Cabinet names trip folders. `None` when the name is only dates,
/// months or numbers ("2019-02", "02 February", "May 2024", "100APPLE"), or a generic folder
/// like "DCIM".
pub fn trip_name(folder: &str) -> Option<String> {
    let words: Vec<&str> = folder.split_whitespace().collect();
    let mut kept = words.as_slice();
    if let Some((first, rest)) = kept.split_first()
        && is_dated(first)
    {
        kept = rest;
    }
    if let Some((last, rest)) = kept.split_last()
        && is_dated(last)
    {
        kept = rest;
    }
    let name = trips::clean_name(&kept.join(" "));
    // Every word a number, a month or a date means a filing system, not a trip.
    let named = name.split_whitespace().any(|w| {
        let lower = w.to_lowercase();
        w.chars().any(char::is_alphabetic) && !MONTHS.contains(&lower.as_str()) && !is_camera_dir(w)
    });
    let generic = GENERIC.contains(&name.to_lowercase().as_str());
    (named && !generic).then_some(name)
}

/// A year or a date: "2025", "2025-26", "2025-03", "2025-03-12", "2025_03_12".
fn is_dated(word: &str) -> bool {
    let digits = word.chars().take_while(char::is_ascii_digit).count();
    digits == 4
        && word
            .chars()
            .all(|c| c.is_ascii_digit() || matches!(c, '-' | '_' | '.'))
}

/// A camera's numbered folder: "100APPLE", "101CANON", "100_FUJI".
fn is_camera_dir(word: &str) -> bool {
    let digits = word.chars().take_while(char::is_ascii_digit).count();
    digits == 3
        && word
            .chars()
            .skip(3)
            .all(|c| c.is_ascii_uppercase() || c == '_')
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::formats::Kind;
    use crate::groups::MediaRow;
    use chrono::NaiveDateTime;

    const ROOT: &str = "C:\\L";

    fn group(path: &str, taken: &str, source: DateSource) -> Group {
        let taken_at = NaiveDateTime::parse_from_str(taken, "%Y-%m-%d %H:%M").unwrap();
        Group {
            members: vec![MediaRow {
                id: 1,
                path: Path::new(ROOT).join(path),
                group_key: path.to_string(),
                kind: Kind::Photo,
                size: 1,
                mtime: 0,
                taken_at,
                date_source: source,
                lat: None,
                lon: None,
                hash: None,
            }],
            taken_at,
            date_source: source,
        }
    }

    /// `count` photos in `folder`, one a day from `first`.
    fn photos(folder: &str, first: &str, count: u32) -> Vec<Group> {
        let start = NaiveDate::parse_from_str(first, "%Y-%m-%d").unwrap();
        (0..count)
            .map(|i| {
                let day = start + chrono::Days::new(u64::from(i));
                group(
                    &format!("{folder}\\IMG_{i}.JPG"),
                    &format!("{day} 10:00"),
                    DateSource::Exif,
                )
            })
            .collect()
    }

    fn day(text: &str) -> NaiveDate {
        NaiveDate::parse_from_str(text, "%Y-%m-%d").unwrap()
    }

    fn trip(folder: &str, start: &str, end: &str) -> Trip {
        Trip {
            id: 1,
            name: folder.to_string(),
            start_at: NaiveDateTime::parse_from_str(start, "%Y-%m-%d %H:%M").unwrap(),
            end_at: NaiveDateTime::parse_from_str(end, "%Y-%m-%d %H:%M").unwrap(),
            folder: folder.to_string(),
            created_at: 0,
            excluded: Default::default(),
        }
    }

    #[test]
    fn names_lose_the_dates_trip_folders_add() {
        assert_eq!(trip_name("Hamilton 2026").as_deref(), Some("Hamilton"));
        assert_eq!(trip_name("2025-03-12 Japan").as_deref(), Some("Japan"));
        assert_eq!(trip_name("2025 Japan").as_deref(), Some("Japan"));
        assert_eq!(
            trip_name("Summer camp 2025-26").as_deref(),
            Some("Summer camp")
        );
        assert_eq!(trip_name("May walk 2024").as_deref(), Some("May walk"));
        assert_eq!(trip_name("Day 2").as_deref(), Some("Day 2"));
    }

    #[test]
    fn date_and_camera_folders_are_not_trips() {
        for name in [
            "2019",
            "2019-02",
            "02 February",
            "February 2019",
            "May",
            "100APPLE",
            "DCIM",
            "Camera Roll",
            "2024",
        ] {
            assert_eq!(trip_name(name), None, "{name}");
        }
    }

    #[test]
    fn a_folder_left_from_a_deleted_trip_is_found() {
        let groups = photos("Trips\\Hamilton 2026", "2026-04-03", 3);
        let found = find(Path::new(ROOT), &groups, &[], &[]);
        assert_eq!(
            found,
            [FolderTrip {
                folder: "Trips\\Hamilton 2026".into(),
                name: "Hamilton".into(),
                start: day("2026-04-03"),
                end: day("2026-04-05"),
            }]
        );
    }

    #[test]
    fn month_folders_and_trip_folders_are_left_out() {
        let mut groups = photos("2019\\2019-02", "2019-02-01", 20);
        groups.extend(photos("Trips\\Japan 2025", "2025-03-12", 4));
        let japan = trip("Japan 2025", "2025-03-12 00:00", "2025-03-15 23:59");
        assert!(find(Path::new(ROOT), &groups, &[japan], &[]).is_empty());
    }

    #[test]
    fn a_folder_over_a_trip_or_a_dismissed_range_is_left_out() {
        let groups = photos("Trips\\Hamilton 2026", "2026-04-03", 3);
        let other = trip("Raglan 2026", "2026-04-05 00:00", "2026-04-06 23:59");
        assert!(find(Path::new(ROOT), &groups, &[other], &[]).is_empty());
        let dismissed = [(day("2026-04-01"), day("2026-04-03"))];
        assert!(find(Path::new(ROOT), &groups, &[], &dismissed).is_empty());
    }

    #[test]
    fn folders_outside_trips_need_enough_photos_close_together() {
        let root = Path::new(ROOT);
        assert_eq!(
            find(root, &photos("Rotorua", "2024-01-02", 5), &[], &[]).len(),
            1
        );
        assert!(find(root, &photos("Rotorua", "2024-01-02", 4), &[], &[]).is_empty());
        assert!(find(root, &photos("Garden", "2024-01-02", 40), &[], &[]).is_empty());
    }

    #[test]
    fn guessed_dates_and_loose_files_dont_count() {
        let root = Path::new(ROOT);
        let guessed: Vec<Group> = (0..6)
            .map(|i| {
                group(
                    &format!("Rotorua\\IMG_{i}.JPG"),
                    "2024-01-02 10:00",
                    DateSource::Modified,
                )
            })
            .collect();
        assert!(find(root, &guessed, &[], &[]).is_empty());
        let loose: Vec<Group> = (0..6)
            .map(|i| {
                group(
                    &format!("IMG_{i}.JPG"),
                    "2024-01-02 10:00",
                    DateSource::Exif,
                )
            })
            .collect();
        assert!(find(root, &loose, &[], &[]).is_empty());
    }
}
