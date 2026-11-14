// Work out which folder every library file belongs in and the moves that put it there.
// Pure: the disk is only consulted through the `exists` callback, so the same code drives the
// dry-run preview and is easy to test.

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use chrono::{Datelike, NaiveDateTime};

use crate::formats::FormatTable;
use crate::groups::{Group, MediaRow};
use crate::index::path_key;
use crate::scan;
use crate::trips::{TRIPS_DIR, Trip, trip_of};

/// One file to move.
#[derive(Debug, Clone, PartialEq)]
pub struct Move {
    pub media_id: i64,
    pub from: PathBuf,
    pub to: PathBuf,
}

/// The moves for one group. They succeed or fail together, so a photo never loses its Live
/// Photo video or sidecar.
#[derive(Debug, Clone, PartialEq)]
pub struct GroupMove {
    /// Leader first, in the group's member order.
    pub moves: Vec<Move>,
    /// A ` (n)` was added to the names because the target folder already used them.
    pub renamed: bool,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct Plan {
    pub groups: Vec<GroupMove>,
    /// Groups already in the folder they belong in.
    pub in_place: usize,
    /// Files never moved: sidecars whose photo is missing, and anything outside the library.
    pub left_alone: usize,
}

impl Plan {
    /// Number of files that will move.
    pub fn file_count(&self) -> usize {
        self.groups.iter().map(|g| g.moves.len()).sum()
    }
}

/// Where groups belong.
pub struct Rules<'a> {
    pub root: &'a Path,
    /// Trips never overlap, so at most one contains any date.
    pub trips: &'a [Trip],
}

impl Rules<'_> {
    /// Folder a group belongs in: its trip's folder when it was taken during a trip and not
    /// taken out of it, otherwise its year and month folder.
    pub fn target_dir(&self, group: &Group) -> PathBuf {
        match trip_of(self.trips, group) {
            Some(trip) => self.root.join(TRIPS_DIR).join(&trip.folder),
            None => year_month_dir(self.root, &group.taken_at),
        }
    }
}

/// `<root>/YYYY/YYYY-MM` for a taken date.
pub fn year_month_dir(root: &Path, taken: &NaiveDateTime) -> PathBuf {
    root.join(format!("{:04}", taken.year())).join(format!(
        "{:04}-{:02}",
        taken.year(),
        taken.month()
    ))
}

/// Plan the moves that put every group in the folder `rules` picks for it.
///
/// Groups are taken in the order given (date order from `groups::build`), so clash numbers are
/// stable from one preview to the next. A name counts as taken when a file already has it on
/// disk or an earlier group in this plan claimed it. Names freed by files moving away are not
/// reused, so the moves can run in any order without one landing on a file that hasn't left.
pub fn plan(
    rules: &Rules,
    groups: &[Group],
    orphans: usize,
    table: &FormatTable,
    exists: &dyn Fn(&Path) -> bool,
) -> Plan {
    let mut plan = Plan {
        left_alone: orphans,
        ..Plan::default()
    };
    let mut claimed: HashSet<String> = HashSet::new();
    for group in groups {
        let leader = group.leader();
        let Some(current) = leader
            .path
            .parent()
            .filter(|_| is_inside(&leader.path, rules.root))
        else {
            plan.left_alone += group.members.len();
            continue;
        };
        let dir = rules.target_dir(group);
        if same_path(current, &dir) {
            plan.in_place += 1;
            continue;
        }
        plan.groups.push(place(group, &dir, table, &mut claimed, exists));
    }
    plan
}

/// The moves that put every member of `group` in `dir` under its own name, or with the lowest
/// ` (n)` that frees every member's name at once, so the group keeps matching names. A name is
/// taken when `exists` says so or `claimed` holds it; the names picked are added to `claimed`.
pub fn place(
    group: &Group,
    dir: &Path,
    table: &FormatTable,
    claimed: &mut HashSet<String>,
    exists: &dyn Fn(&Path) -> bool,
) -> GroupMove {
    // Some number is always free: `exists` and `claimed` only know finitely many names.
    let (moves, number) = (0..)
        .find_map(|n| {
            let moves: Vec<Move> = group
                .members
                .iter()
                .map(|m| Move {
                    media_id: m.id,
                    from: m.path.clone(),
                    to: dir.join(numbered_name(m, n, table)),
                })
                .collect();
            let free = moves
                .iter()
                .all(|mv| !claimed.contains(&path_key(&mv.to)) && !exists(&mv.to));
            free.then_some((moves, n))
        })
        .unwrap_or_default();
    claimed.extend(moves.iter().map(|mv| path_key(&mv.to)));
    GroupMove {
        moves,
        renamed: number > 0,
    }
}

/// The member's file name, with ` (n)` before the part it shares with its partners when `n`
/// is above zero: `IMG_1 (2).HEIC`, `IMG_1 (2).CR2.xmp`, `C0001 (2)M01.XML`.
fn numbered_name(member: &MediaRow, n: usize, table: &FormatTable) -> String {
    let name = member
        .path
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default();
    if n == 0 {
        return name;
    }
    let (base, rest) = scan::split_name(&name, member.kind, table);
    format!("{base} ({n}){rest}")
}

/// Case-insensitive path equality that ignores separator style and trailing slashes.
pub fn same_path(a: &Path, b: &Path) -> bool {
    lower(a).components().eq(lower(b).components())
}

/// True when `path` is `root` or anywhere under it (case-insensitive).
pub fn is_inside(path: &Path, root: &Path) -> bool {
    lower(path).starts_with(lower(root))
}

fn lower(path: &Path) -> PathBuf {
    PathBuf::from(path_key(path))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dates::DateSource::{Exif, Modified, Video};
    use crate::formats::Kind;
    use crate::groups::{self, tests::row};

    const ROOT: &str = "C:\\L";

    fn run(rows: Vec<MediaRow>, on_disk: &[&str]) -> Plan {
        run_with_trips(rows, on_disk, &[])
    }

    fn run_with_trips(rows: Vec<MediaRow>, on_disk: &[&str], trips: &[Trip]) -> Plan {
        let (groups, orphans) = groups::build(rows);
        let disk: HashSet<String> = on_disk.iter().map(|p| path_key(Path::new(p))).collect();
        plan(
            &Rules {
                root: Path::new(ROOT),
                trips,
            },
            &groups,
            orphans.len(),
            &FormatTable::default(),
            &|p| disk.contains(&path_key(p)),
        )
    }

    /// Targets relative to the root, one list per group.
    fn targets(plan: &Plan) -> Vec<Vec<String>> {
        plan.groups
            .iter()
            .map(|g| {
                g.moves
                    .iter()
                    .map(|m| {
                        m.to.strip_prefix(ROOT)
                            .unwrap()
                            .to_string_lossy()
                            .into_owned()
                    })
                    .collect()
            })
            .collect()
    }

    #[test]
    fn groups_go_to_year_month_folders_with_their_companions() {
        let plan = run(
            vec![
                row(
                    1,
                    "in",
                    "IMG_1.HEIC",
                    Kind::Photo,
                    "2025-03-12T10:00:00",
                    Exif,
                ),
                row(
                    2,
                    "in",
                    "IMG_1.MOV",
                    Kind::Video,
                    "2025-03-12T10:00:01",
                    Video,
                ),
                row(
                    3,
                    "in",
                    "IMG_1.AAE",
                    Kind::Companion,
                    "2025-06-01T00:00:00",
                    Modified,
                ),
                row(
                    4,
                    "in\\sub",
                    "clip.MP4",
                    Kind::Video,
                    "2024-12-31T23:59:59",
                    Video,
                ),
            ],
            &[],
        );
        assert_eq!(
            targets(&plan),
            [
                vec!["2024\\2024-12\\clip.MP4"],
                vec![
                    "2025\\2025-03\\IMG_1.HEIC",
                    "2025\\2025-03\\IMG_1.MOV",
                    "2025\\2025-03\\IMG_1.AAE"
                ],
            ]
        );
        assert_eq!(plan.file_count(), 4);
        assert!(plan.groups.iter().all(|g| !g.renamed));
    }

    #[test]
    fn files_already_in_place_are_skipped() {
        let plan = run(
            vec![
                row(
                    1,
                    "2025\\2025-03",
                    "IMG_1.JPG",
                    Kind::Photo,
                    "2025-03-12T10:00:00",
                    Exif,
                ),
                row(
                    2,
                    "2025\\2025-04",
                    "IMG_2.JPG",
                    Kind::Photo,
                    "2025-03-20T10:00:00",
                    Exif,
                ),
            ],
            &[],
        );
        assert_eq!(plan.in_place, 1);
        assert_eq!(targets(&plan), [vec!["2025\\2025-03\\IMG_2.JPG"]]);
    }

    #[test]
    fn a_clash_on_any_member_renumbers_the_whole_group() {
        let plan = run(
            vec![
                row(
                    1,
                    "in",
                    "IMG_1.JPG",
                    Kind::Photo,
                    "2025-03-12T10:00:00",
                    Exif,
                ),
                row(2, "in", "IMG_1.CR2", Kind::Raw, "2025-03-12T10:00:00", Exif),
                row(
                    3,
                    "in",
                    "IMG_1.CR2.xmp",
                    Kind::Companion,
                    "2025-03-13T00:00:00",
                    Modified,
                ),
            ],
            &[
                "C:\\L\\2025\\2025-03\\img_1.jpg",
                "C:\\L\\2025\\2025-03\\IMG_1 (1).CR2.xmp",
            ],
        );
        assert_eq!(
            targets(&plan),
            [vec![
                "2025\\2025-03\\IMG_1 (2).JPG",
                "2025\\2025-03\\IMG_1 (2).CR2",
                "2025\\2025-03\\IMG_1 (2).CR2.xmp",
            ]]
        );
        assert!(plan.groups[0].renamed);
    }

    #[test]
    fn two_planned_groups_never_get_the_same_name() {
        let plan = run(
            vec![
                row(
                    1,
                    "a",
                    "IMG_1.JPG",
                    Kind::Photo,
                    "2025-03-12T10:00:00",
                    Exif,
                ),
                row(
                    2,
                    "b",
                    "IMG_1.JPG",
                    Kind::Photo,
                    "2025-03-14T10:00:00",
                    Exif,
                ),
            ],
            &[],
        );
        assert_eq!(
            targets(&plan),
            [
                vec!["2025\\2025-03\\IMG_1.JPG"],
                vec!["2025\\2025-03\\IMG_1 (1).JPG"]
            ]
        );
        assert_eq!(
            plan.groups.iter().map(|g| g.renamed).collect::<Vec<_>>(),
            [false, true]
        );
    }

    #[test]
    fn orphans_and_files_outside_the_library_are_left_alone() {
        let mut outside = row(
            2,
            "x",
            "IMG_5.JPG",
            Kind::Photo,
            "2025-03-12T10:00:00",
            Exif,
        );
        outside.path = PathBuf::from("D:\\Elsewhere\\IMG_5.JPG");
        outside.group_key = "d:\\elsewhere|img_5".into();
        let plan = run(
            vec![
                row(
                    1,
                    "in",
                    "IMG_9.XMP",
                    Kind::Companion,
                    "2025-03-12T10:00:00",
                    Modified,
                ),
                outside,
            ],
            &[],
        );
        assert!(plan.groups.is_empty());
        assert_eq!(plan.left_alone, 2);
    }

    #[test]
    fn path_helpers_ignore_case_and_separators() {
        assert!(same_path(Path::new("C:\\L\\2025"), Path::new("c:/l/2025/")));
        assert!(is_inside(
            Path::new("C:\\L\\2025\\a.jpg"),
            Path::new("c:\\l")
        ));
        assert!(!is_inside(Path::new("C:\\Lib\\a.jpg"), Path::new("C:\\L")));
    }

    #[test]
    fn trip_photos_go_to_the_trip_folder_from_its_first_second_to_its_last() {
        let japan = Trip {
            id: 1,
            name: "Japan".into(),
            start_at: crate::dates::parse("2025-03-12T00:00:00").unwrap(),
            end_at: crate::dates::parse("2025-03-18T23:59:59").unwrap(),
            folder: "2025-03-12 Japan".into(),
            created_at: 0,
            excluded: Default::default(),
        };
        let photo = |id: i64, folder: &str, at: &str| {
            row(id, folder, &format!("IMG_{id}.JPG"), Kind::Photo, at, Exif)
        };
        let plan = run_with_trips(
            vec![
                photo(1, "in", "2025-03-11T23:59:59"),
                photo(2, "in", "2025-03-12T00:00:00"),
                photo(3, "in", "2025-03-18T23:59:59"),
                photo(4, "in", "2025-03-19T00:00:00"),
                photo(5, r"Trips\2025-03-12 Japan", "2025-03-15T12:00:00"),
            ],
            &[],
            &[japan],
        );
        assert_eq!(
            targets(&plan),
            [
                vec![r"2025\2025-03\IMG_1.JPG"],
                vec![r"Trips\2025-03-12 Japan\IMG_2.JPG"],
                vec![r"Trips\2025-03-12 Japan\IMG_3.JPG"],
                vec![r"2025\2025-03\IMG_4.JPG"],
            ]
        );
        assert_eq!(plan.in_place, 1);
    }
}
