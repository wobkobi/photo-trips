// Bundle a photo or video with the files that must travel with it (Live Photo video, RAW
// twin, sidecars), so they are shown as one tile and always moved together.

use std::collections::HashMap;
use std::path::PathBuf;

use chrono::NaiveDateTime;

use crate::dates::DateSource;
use crate::formats::{Kind, RAW_EDIT_EXTS};

/// One indexed file, as loaded from the `media` table.
#[derive(Debug, Clone, PartialEq)]
pub struct MediaRow {
    pub id: i64,
    pub path: PathBuf,
    pub group_key: String,
    pub kind: Kind,
    pub size: u64,
    pub mtime: i64,
    pub taken_at: NaiveDateTime,
    pub date_source: DateSource,
    pub lat: Option<f64>,
    pub lon: Option<f64>,
    pub hash: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Group {
    /// First member is the leader: the tile shown in the grid.
    pub members: Vec<MediaRow>,
    /// Best-sourced date among the members (EXIF beats a guessed mtime, etc).
    pub taken_at: NaiveDateTime,
    pub date_source: DateSource,
}

impl Group {
    pub fn leader(&self) -> &MediaRow {
        &self.members[0]
    }
}

/// Same-name files further apart than this are unrelated (two cameras both writing
/// IMG_0001), not a photo and its twin. Live Photo and RAW+JPEG pairs are seconds apart.
const MAX_PAIR_GAP_SECS: i64 = 10 * 60;

/// Group rows that share a group key. Returns the groups plus orphans: sidecars whose photo is
/// missing, which are left where they are.
pub fn build(rows: Vec<MediaRow>) -> (Vec<Group>, Vec<MediaRow>) {
    let mut buckets: HashMap<String, Vec<MediaRow>> = HashMap::new();
    for row in rows {
        buckets.entry(row.group_key.clone()).or_default().push(row);
    }
    let mut groups = Vec::new();
    let mut orphans = Vec::new();
    for (_, mut bucket) in buckets {
        bucket.sort_by(|a, b| {
            (a.kind.lead_rank(), a.path.as_os_str()).cmp(&(b.kind.lead_rank(), b.path.as_os_str()))
        });
        let (companions, mut media): (Vec<_>, Vec<_>) =
            bucket.into_iter().partition(|r| r.kind == Kind::Companion);
        if media.is_empty() {
            orphans.extend(companions);
            continue;
        }
        // A group holds at most one file of each kind: a photo with its RAW twin and its Live
        // Photo video. A second same-name photo or video (image.jpg beside image.png, a film
        // beside its trailer) is a different picture, so it starts a group of its own.
        let mut bucket_groups: Vec<Vec<MediaRow>> = Vec::new();
        while !media.is_empty() {
            let mut members = vec![media.remove(0)];
            let mut rest = Vec::new();
            for r in media {
                if members.iter().all(|m| m.kind != r.kind) && belongs_with(&members[0], &r) {
                    members.push(r);
                } else {
                    rest.push(r);
                }
            }
            media = rest;
            bucket_groups.push(members);
        }
        for companion in companions {
            let at = companion_home(&companion, &bucket_groups);
            bucket_groups[at].push(companion);
        }
        groups.extend(bucket_groups.into_iter().map(finish));
    }
    groups.sort_by(|a, b| {
        (a.taken_at, a.leader().path.as_os_str()).cmp(&(b.taken_at, b.leader().path.as_os_str()))
    });
    (groups, orphans)
}

/// Whether `other` can join a group led by `leader`: they were taken within a few minutes, or
/// either date is only a guess.
pub fn belongs_with(leader: &MediaRow, other: &MediaRow) -> bool {
    // A guessed date can't prove two files unrelated, so give them the benefit of the doubt.
    if !leader.date_source.is_embedded() || !other.date_source.is_embedded() {
        return true;
    }
    (leader.taken_at - other.taken_at).num_seconds().abs() <= MAX_PAIR_GAP_SECS
}

/// Index of the group a sidecar belongs with when its name is shared by several groups.
///
/// A sidecar that names its file (`IMG_1.CR2.xmp`) goes with the group holding `IMG_1.CR2`.
/// Otherwise its type decides: XMP and other RAW editors' files belong to the RAW, AAE edits to the photo, THM, LRV,
/// XML and SRT files to the video. With no such group it follows the first one, which is
/// photo-led whenever there is a photo.
fn companion_home(companion: &MediaRow, groups: &[Vec<MediaRow>]) -> usize {
    let name = file_name_lower(&companion.path);
    let (stem, ext) = name.rsplit_once('.').unwrap_or((&name, ""));
    let named = stem.rsplit_once('.').map(|(_, inner)| inner);
    let has = |pred: &dyn Fn(&MediaRow) -> bool| groups.iter().position(|g| g.iter().any(pred));
    if let Some(inner) = named
        && let Some(at) = has(&|m| ext_lower(&m.path) == inner)
    {
        return at;
    }
    let wanted = match ext {
        e if RAW_EDIT_EXTS.contains(&e) => Some(Kind::Raw),
        "aae" => Some(Kind::Photo),
        "thm" | "lrv" | "xml" | "srt" => Some(Kind::Video),
        _ => None,
    };
    wanted.and_then(|kind| has(&|m| m.kind == kind)).unwrap_or(0)
}

fn file_name_lower(path: &std::path::Path) -> String {
    path.file_name()
        .map(|n| n.to_string_lossy().to_lowercase())
        .unwrap_or_default()
}

fn ext_lower(path: &std::path::Path) -> String {
    path.extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default()
}

fn finish(members: Vec<MediaRow>) -> Group {
    let best = members
        .iter()
        .filter(|m| m.kind != Kind::Companion)
        .min_by_key(|m| m.date_source)
        .unwrap_or(&members[0]);
    let (taken_at, date_source) = (best.taken_at, best.date_source);
    Group { members, taken_at, date_source }
}

#[cfg(test)]
pub mod tests {
    use super::*;
    use crate::dates;

    /// Test row builder: `C:\L\<dir>\<name>` taken at `when` from `source`.
    pub fn row(id: i64, dir: &str, name: &str, kind: Kind, when: &str, source: DateSource) -> MediaRow {
        let path = PathBuf::from(format!("C:\\L\\{dir}\\{name}"));
        let stem = name.split('.').next().unwrap().to_lowercase();
        MediaRow {
            id,
            group_key: format!("{}|{stem}", path.parent().unwrap().to_string_lossy().to_lowercase()),
            path,
            kind,
            size: 100 + id as u64,
            mtime: 0,
            taken_at: dates::parse(when).unwrap(),
            date_source: source,
            lat: None,
            lon: None,
            hash: None,
        }
    }

    #[test]
    fn live_photo_raw_pair_and_sidecars_form_one_group_led_by_the_photo() {
        let rows = vec![
            row(1, "in", "IMG_1.MOV", Kind::Video, "2025-03-12T10:00:01", DateSource::Video),
            row(2, "in", "IMG_1.HEIC", Kind::Photo, "2025-03-12T10:00:00", DateSource::Exif),
            row(3, "in", "IMG_1.AAE", Kind::Companion, "2025-04-01T00:00:00", DateSource::Modified),
            row(4, "in", "IMG_1.DNG", Kind::Raw, "2025-03-12T10:00:00", DateSource::Exif),
        ];
        let (groups, orphans) = build(rows);
        assert!(orphans.is_empty());
        assert_eq!(groups.len(), 1);
        let ids: Vec<_> = groups[0].members.iter().map(|m| m.id).collect();
        assert_eq!(ids, [2, 4, 1, 3]);
        assert_eq!(groups[0].date_source, DateSource::Exif);
    }

    #[test]
    fn same_name_files_hours_apart_stay_separate() {
        let rows = vec![
            row(1, "in", "IMG_1.JPG", Kind::Photo, "2025-03-12T10:00:00", DateSource::Exif),
            row(2, "in", "IMG_1.MP4", Kind::Video, "2025-06-01T18:00:00", DateSource::Video),
        ];
        let (groups, _) = build(rows);
        assert_eq!(groups.len(), 2);
    }

    #[test]
    fn better_dated_member_dates_the_group() {
        let rows = vec![
            row(1, "in", "IMG_1.JPG", Kind::Photo, "2025-04-01T00:00:00", DateSource::Modified),
            row(2, "in", "IMG_1.MOV", Kind::Video, "2025-03-12T10:00:00", DateSource::Video),
        ];
        let (groups, _) = build(rows);
        assert_eq!(groups[0].leader().id, 1);
        assert_eq!(groups[0].taken_at, dates::parse("2025-03-12T10:00:00").unwrap());
    }

    #[test]
    fn two_same_name_pictures_are_two_tiles() {
        let rows = vec![
            row(1, "in", "image.jpg", Kind::Photo, "2025-04-01T00:00:00", DateSource::Modified),
            row(2, "in", "image.png", Kind::Photo, "2025-04-01T00:00:00", DateSource::Modified),
        ];
        let (groups, _) = build(rows);
        assert_eq!(groups.len(), 2);
        assert!(groups.iter().all(|g| g.members.len() == 1));
    }

    #[test]
    fn two_same_name_videos_are_two_tiles() {
        let rows = vec![
            row(1, "in", "Title.mp4", Kind::Video, "2025-04-01T00:00:00", DateSource::Video),
            row(2, "in", "Title.mkv", Kind::Video, "2025-04-01T00:00:00", DateSource::Video),
        ];
        let (groups, _) = build(rows);
        assert_eq!(groups.len(), 2);
    }

    #[test]
    fn a_converted_copy_stays_out_of_the_live_photo() {
        let rows = vec![
            row(1, "in", "IMG_1.HEIC", Kind::Photo, "2025-03-12T10:00:00", DateSource::Exif),
            row(2, "in", "IMG_1.JPG", Kind::Photo, "2025-03-12T10:00:00", DateSource::Exif),
            row(3, "in", "IMG_1.MOV", Kind::Video, "2025-03-12T10:00:01", DateSource::Video),
        ];
        let (groups, _) = build(rows);
        assert_eq!(groups.len(), 2);
        let live = groups.iter().find(|g| g.leader().id == 1).unwrap();
        let ids: Vec<_> = live.members.iter().map(|m| m.id).collect();
        assert_eq!(ids, [1, 3]);
    }

    #[test]
    fn sidecars_follow_the_file_they_name_when_a_name_splits() {
        let rows = vec![
            row(1, "in", "IMG_1.JPG", Kind::Photo, "2025-01-01T09:00:00", DateSource::Exif),
            row(2, "in", "IMG_1.CR2", Kind::Raw, "2025-06-01T09:00:00", DateSource::Exif),
            row(3, "in", "IMG_1.CR2.xmp", Kind::Companion, "2025-06-02T00:00:00", DateSource::Modified),
            row(4, "in", "IMG_1.xmp", Kind::Companion, "2025-06-02T00:00:00", DateSource::Modified),
            row(5, "in", "IMG_1.AAE", Kind::Companion, "2025-06-02T00:00:00", DateSource::Modified),
        ];
        let (groups, _) = build(rows);
        assert_eq!(groups.len(), 2);
        let ids_of = |leader: i64| -> Vec<i64> {
            let g = groups.iter().find(|g| g.leader().id == leader).unwrap();
            g.members.iter().map(|m| m.id).collect()
        };
        assert_eq!(ids_of(1), [1, 5]);
        assert_eq!(ids_of(2), [2, 3, 4]);
    }

    #[test]
    fn sidecars_without_a_partner_are_orphans() {
        let rows = vec![row(1, "in", "IMG_9.XMP", Kind::Companion, "2025-03-12T10:00:00", DateSource::Modified)];
        let (groups, orphans) = build(rows);
        assert!(groups.is_empty());
        assert_eq!(orphans.len(), 1);
    }
}
