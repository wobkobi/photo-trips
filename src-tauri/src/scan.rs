// Walk a folder tree and list the photo, video and sidecar files in it.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

use crate::error::{Error, Result};
use crate::formats::{FormatTable, Kind};
use crate::planner::same_path;

#[derive(Debug, Clone)]
pub struct ScannedFile {
    pub path: PathBuf,
    pub kind: Kind,
    pub size: u64,
    /// Last-modified time, Unix seconds.
    pub mtime: i64,
}

#[derive(Debug, Default)]
pub struct ScanResult {
    pub files: Vec<ScannedFile>,
    /// Files with an unrecognised type. They are never moved, only counted so the UI can say so.
    pub other_files: u64,
}

/// Folder names never descended into: app data, version control, code dependencies, Windows
/// system folders, and the recycle and thumbnail folders NAS boxes keep beside photos.
pub fn skip_dir(name: &str) -> bool {
    const SKIPPED: [&str; 8] = [
        "node_modules",
        "$RECYCLE.BIN",
        "System Volume Information",
        "RECYCLER",
        "@eaDir",
        "@Recycle",
        "#recycle",
        "#snapshot",
    ];
    name.starts_with('.') || SKIPPED.iter().any(|s| name.eq_ignore_ascii_case(s))
}

/// [`skip_dir`], plus folders a camera fills with its own working files: Sony's `M4ROOT/THMBNL`
/// (a small JPEG per clip) and `M4ROOT/SUB` (low-resolution proxy clips). Those two names are
/// only skipped inside `M4ROOT`, so a folder of the user's own called `SUB` is still read.
pub fn skip_folder(path: &Path) -> bool {
    let name = path.file_name().map(|n| n.to_string_lossy()).unwrap_or_default();
    if skip_dir(&name) {
        return true;
    }
    let in_m4root = path
        .parent()
        .and_then(Path::file_name)
        .is_some_and(|p| p.eq_ignore_ascii_case("M4ROOT"));
    in_m4root && (name.eq_ignore_ascii_case("THMBNL") || name.eq_ignore_ascii_case("SUB"))
}

/// List every recognised file under `root`. Unreadable entries are skipped rather than failing
/// the whole scan.
pub fn scan(root: &Path, table: &FormatTable, cancel: &AtomicBool) -> Result<ScanResult> {
    scan_excluding(root, None, table, cancel)
}

/// [`scan`], never descending into `exclude` (the library, when importing a folder that holds it).
pub fn scan_excluding(
    root: &Path,
    exclude: Option<&Path>,
    table: &FormatTable,
    cancel: &AtomicBool,
) -> Result<ScanResult> {
    let mut result = ScanResult::default();
    let walker = walkdir::WalkDir::new(root).follow_links(false).into_iter();
    let walker = walker.filter_entry(|entry| {
        entry.depth() == 0
            || !entry.file_type().is_dir()
            || !(skip_folder(entry.path())
                || exclude.is_some_and(|ex| same_path(entry.path(), ex)))
    });
    for entry in walker {
        if cancel.load(Ordering::Relaxed) {
            return Err(Error::msg("Cancelled"));
        }
        let Ok(entry) = entry else { continue };
        if !entry.file_type().is_file() {
            continue;
        }
        let Some(kind) = file_kind(entry.path(), table) else {
            result.other_files += 1;
            continue;
        };
        let Ok(meta) = entry.metadata() else { continue };
        result.files.push(ScannedFile {
            path: entry.into_path(),
            kind,
            size: meta.len(),
            mtime: mtime_secs(&meta),
        });
    }
    Ok(result)
}

/// The kind of file at `path`, or `None` when it isn't a photo, video or companion.
pub fn file_kind(path: &Path, table: &FormatTable) -> Option<Kind> {
    let name = path.file_name()?.to_string_lossy();
    // Dot-files are never the user's photos: macOS resource forks ("._IMG_0001.JPG") and
    // Android's binned and half-written files (".trashed-1712345678-IMG_1.jpg", ".pending-...").
    if name.starts_with('.') {
        return None;
    }
    let kind = table.kind_of(path)?;
    if kind == Kind::Video && shares_ext_with_code(path) && !is_transport_stream(path) {
        return None;
    }
    Some(kind)
}

/// `.ts` and `.mts` are also TypeScript source files, and `.m2ts` keeps them company.
fn shares_ext_with_code(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| ["ts", "mts", "m2ts"].iter().any(|x| e.eq_ignore_ascii_case(x)))
}

/// True when the file starts like an MPEG transport stream: the sync byte 0x47 every 188 bytes
/// (broadcast and HDV `.ts`), or every 192 bytes after a 4-byte timecode (AVCHD `.mts`/`.m2ts`).
/// A file that can't be read (a phone path, a locked file) gets the benefit of the doubt.
fn is_transport_stream(path: &Path) -> bool {
    use std::io::Read;
    let Ok(file) = std::fs::File::open(path) else {
        return true;
    };
    let mut head = Vec::with_capacity(3 * 192 + 4);
    if file.take(3 * 192 + 4).read_to_end(&mut head).is_err() {
        return true;
    }
    let synced = |start: usize, step: usize| {
        (0..3).all(|i| head.get(start + i * step) == Some(&0x47))
    };
    synced(0, 188) || synced(4, 192)
}


/// Last-modified time of a file in Unix seconds (0 when the platform can't say).
pub fn mtime_secs(meta: &std::fs::Metadata) -> i64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map_or(0, |d| d.as_secs() as i64)
}

/// Key shared by a file and its companions: lowercase folder + lowercase base name
/// (see [`split_name`]).
pub fn group_key(path: &Path, kind: Kind, table: &FormatTable) -> String {
    let parent = path
        .parent()
        .map(|p| p.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    let name = path
        .file_name()
        .map(|s| s.to_string_lossy())
        .unwrap_or_default();
    let (base, _) = split_name(&name, kind, table);
    format!("{parent}|{}", base.to_lowercase())
}

/// Split a file name into the base it shares with its partner files and the rest.
///
/// Sidecars name their partner in a few different ways, all folded to the partner's base:
/// `IMG_1.HEIC` + `IMG_1.AAE`, darktable-style `IMG_1.CR2.xmp` (rest `.CR2.xmp`), and Sony's
/// `C0001.MP4` + `C0001M01.XML` (rest `M01.XML`). A suffix inserted between the two halves
/// keeps the whole group matching after a rename.
pub fn split_name<'a>(name: &'a str, kind: Kind, table: &FormatTable) -> (&'a str, &'a str) {
    let dot = name.rfind('.');
    let mut base_end = dot.unwrap_or(name.len());
    if kind == Kind::Companion {
        if let Some(inner) = name[..base_end].rfind('.')
            && table.is_media_ext(&name[inner + 1..base_end])
        {
            base_end = inner;
        }
        let is_xml = dot.is_some_and(|d| name[d + 1..].eq_ignore_ascii_case("xml"));
        // "m01" is ASCII, so cutting 3 bytes off the end stays on a character boundary.
        if is_xml && base_end > 3 && name[..base_end].to_ascii_lowercase().ends_with("m01") {
            base_end -= 3;
        }
    }
    name.split_at(base_end)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn touch(path: &Path) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, b"x").unwrap();
    }

    #[test]
    fn scan_lists_media_counts_others_and_skips_hidden_folders() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        touch(&root.join("a/IMG_1.JPG"));
        touch(&root.join("a/IMG_1.AAE"));
        touch(&root.join("b/clip.MP4"));
        touch(&root.join("b/notes.txt"));
        touch(&root.join("b/._IMG_2.JPG"));
        touch(&root.join(".photolib/staging/IMG_9.JPG"));
        touch(&root.join("$RECYCLE.BIN/IMG_8.JPG"));

        let result = scan(root, &FormatTable::default(), &AtomicBool::new(false)).unwrap();
        let mut names: Vec<_> = result
            .files
            .iter()
            .map(|f| f.path.file_name().unwrap().to_string_lossy().to_string())
            .collect();
        names.sort();
        assert_eq!(names, ["IMG_1.AAE", "IMG_1.JPG", "clip.MP4"]);
        assert_eq!(result.other_files, 2);
    }

    #[test]
    fn binned_hidden_and_camera_working_files_are_skipped() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        touch(&root.join("DCIM/Camera/IMG_1.jpg"));
        touch(&root.join("DCIM/Camera/.trashed-1712345678-IMG_2.jpg"));
        touch(&root.join("DCIM/Camera/.pending-1712345678-IMG_3.jpg"));
        touch(&root.join("Photos/#recycle/IMG_4.jpg"));
        touch(&root.join("Photos/@eaDir/IMG_5.jpg/SYNOPHOTO_THUMB_M.jpg"));
        touch(&root.join("PRIVATE/M4ROOT/CLIP/C0001.MP4"));
        touch(&root.join("PRIVATE/M4ROOT/THMBNL/C0001T01.JPG"));
        touch(&root.join("PRIVATE/M4ROOT/SUB/C0001S03.MP4"));
        touch(&root.join("Holiday/SUB/IMG_6.jpg"));

        let result = scan(root, &FormatTable::default(), &AtomicBool::new(false)).unwrap();
        let mut names: Vec<_> = result
            .files
            .iter()
            .map(|f| f.path.file_name().unwrap().to_string_lossy().to_string())
            .collect();
        names.sort();
        assert_eq!(names, ["C0001.MP4", "IMG_1.jpg", "IMG_6.jpg"]);
    }

    #[test]
    fn code_files_with_video_extensions_are_not_videos() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        fs::write(root.join("index.ts"), b"export const a = 1;\n").unwrap();
        fs::write(root.join("config.mts"), b"export default {};\n").unwrap();
        let mut ts = vec![0u8; 188 * 3];
        for i in 0..3 {
            ts[i * 188] = 0x47;
        }
        fs::write(root.join("broadcast.ts"), &ts).unwrap();
        let mut m2ts = vec![0u8; 192 * 3];
        for i in 0..3 {
            m2ts[4 + i * 192] = 0x47;
        }
        fs::write(root.join("00001.MTS"), &m2ts).unwrap();
        touch(&root.join("node_modules/pkg/clip.mp4"));

        let t = FormatTable::default();
        let result = scan(root, &t, &AtomicBool::new(false)).unwrap();
        let mut names: Vec<_> = result
            .files
            .iter()
            .map(|f| f.path.file_name().unwrap().to_string_lossy().to_string())
            .collect();
        names.sort();
        assert_eq!(names, ["00001.MTS", "broadcast.ts"]);
        assert_eq!(result.other_files, 2);
        // A phone path can't be read here, so it keeps its extension's kind.
        assert_eq!(file_kind(Path::new("Z:\\phone\\00001.MTS"), &t), Some(Kind::Video));
    }

    #[test]
    fn scan_excluding_skips_the_given_folder() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        touch(&root.join("Camera/IMG_1.JPG"));
        touch(&root.join("Library/2025/IMG_2.JPG"));
        let library = root.join("library");
        let t = FormatTable::default();
        let result = scan_excluding(root, Some(&library), &t, &AtomicBool::new(false)).unwrap();
        assert_eq!(result.files.len(), 1);
        assert!(result.files[0].path.ends_with("IMG_1.JPG"));
    }

    #[test]
    fn scan_stops_when_cancelled() {
        let dir = tempfile::tempdir().unwrap();
        touch(&dir.path().join("IMG_1.JPG"));
        assert!(scan(dir.path(), &FormatTable::default(), &AtomicBool::new(true)).is_err());
    }

    #[test]
    fn companions_share_their_partners_group_key() {
        let t = FormatTable::default();
        let dir = Path::new("C:\\Photos\\Trip");
        let key = |name: &str| {
            let path = dir.join(name);
            group_key(&path, t.kind_of(&path).unwrap(), &t)
        };
        assert_eq!(key("IMG_1.HEIC"), key("IMG_1.MOV"));
        assert_eq!(key("IMG_1.HEIC"), key("img_1.aae"));
        assert_eq!(key("DSC_5.NEF"), key("DSC_5.NEF.xmp"));
        assert_eq!(key("DSC_5.NEF"), key("DSC_5.NEF.pp3"));
        assert_eq!(key("DSC_5.NEF"), key("DSC_5.NEF.dop"));
        assert_eq!(key("DSC_5.NEF"), key("DSC_5.acr"));
        assert_eq!(key("DSC_5.NEF"), key("DSC_5.JPG"));
        assert_eq!(key("C0001.MP4"), key("C0001M01.XML"));
        assert_eq!(key("GX010001.MP4"), key("GX010001.THM"));
        assert_ne!(key("IMG_1.HEIC"), key("IMG_2.HEIC"));
        // A photo whose own name ends in M01 is not a Sony sidecar.
        assert_ne!(key("ROOM01.JPG"), key("ROO.JPG"));
    }

    #[test]
    fn split_name_finds_the_shared_base() {
        let t = FormatTable::default();
        assert_eq!(split_name("IMG_1.JPG", Kind::Photo, &t), ("IMG_1", ".JPG"));
        assert_eq!(
            split_name("DSC_5.NEF.xmp", Kind::Companion, &t),
            ("DSC_5", ".NEF.xmp")
        );
        assert_eq!(
            split_name("C0001M01.XML", Kind::Companion, &t),
            ("C0001", "M01.XML")
        );
        assert_eq!(
            split_name("notes.v2.xmp", Kind::Companion, &t),
            ("notes.v2", ".xmp")
        );
        assert_eq!(split_name("README", Kind::Photo, &t), ("README", ""));
    }

    #[test]
    fn numbered_companions_still_share_a_group_key() {
        let t = FormatTable::default();
        let dir = Path::new(r"C:\Photos\2025\2025-03");
        let renamed_key = |name: &str| {
            let kind = t.kind_of(Path::new(name)).unwrap();
            let (base, rest) = split_name(name, kind, &t);
            let path = dir.join(format!("{base} (2){rest}"));
            group_key(&path, kind, &t)
        };
        for (lead, partner) in [
            ("IMG_1.HEIC", "IMG_1.AAE"),
            ("IMG_1.HEIC", "IMG_1.MOV"),
            ("DSC_5.NEF", "DSC_5.NEF.xmp"),
            ("C0001.MP4", "C0001M01.XML"),
        ] {
            assert_eq!(
                renamed_key(lead),
                renamed_key(partner),
                "{lead} + {partner}"
            );
        }
    }
}
