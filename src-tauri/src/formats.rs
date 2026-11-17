// Every file type the app recognises, and how each kind is treated.

use std::collections::HashMap;
use std::path::Path;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Photo,
    Raw,
    Video,
    /// Sidecar that only travels with a photo or video of the same name (.aae, .xmp, .thm, ...).
    Companion,
}

impl Kind {
    pub fn as_str(self) -> &'static str {
        match self {
            Kind::Photo => "photo",
            Kind::Raw => "raw",
            Kind::Video => "video",
            Kind::Companion => "companion",
        }
    }

    pub fn parse(text: &str) -> Option<Kind> {
        match text {
            "photo" => Some(Kind::Photo),
            "raw" => Some(Kind::Raw),
            "video" => Some(Kind::Video),
            "companion" => Some(Kind::Companion),
            _ => None,
        }
    }

    /// Which file in a same-name group leads it (lower wins). The leader's date dates the group
    /// and it is the tile shown in the grid.
    pub fn lead_rank(self) -> u8 {
        match self {
            Kind::Photo => 0,
            Kind::Raw => 1,
            Kind::Video => 2,
            Kind::Companion => 3,
        }
    }
}

pub const PHOTO_EXTS: &[&str] = &[
    "jpg", "jpeg", "jpe", "jfif", "png", "gif", "bmp", "dib", "tif", "tiff", "webp", "heic",
    "heif", "hif", "avif", "jxl", "jp2", "j2k", "psd",
    // 360 cameras: Insta360 photos
    "insp",
];

pub const RAW_EXTS: &[&str] = &[
    "3fr", "ari", "arw", "srf", "sr2", "bay", "cr2", "cr3", "crw", "dcr", "kdc", "k25", "dng",
    "erf", "fff", "gpr", "iiq", "mef", "mos", "mrw", "nef", "nrw", "orf", "pef", "raf", "raw",
    "rw2", "rwl", "srw", "x3f",
];

pub const VIDEO_EXTS: &[&str] = &[
    "mp4", "m4v", "mov", "qt", "avi", "wmv", "asf", "mkv", "webm", "3gp", "3g2", "mts", "m2ts",
    "ts", "mpg", "mpeg", "mpe", "m2v", "vob", "flv", "f4v", "ogv", "dv", "mxf",
    // 360 cameras: Insta360 video, GoPro Max
    "insv", "360",
];

/// Sidecars: Apple edits (.aae), XMP, GoPro thumbnail/low-res proxy (.thm, .lrv), Sony clip
/// metadata (C0001M01.XML), DJI flight logs (.srt), and the edit files RAW editors keep beside
/// a RAW (RawTherapee .pp3, DxO .dop, Adobe Camera Raw masks .acr, ON1 .on1, AfterShot .arp,
/// Capture One .cos).
pub const COMPANION_EXTS: &[&str] = &[
    "aae", "xmp", "thm", "lrv", "xml", "srt", "pp3", "dop", "acr", "on1", "arp", "cos",
];

/// Sidecars that hold RAW edits, so they go with the RAW when its name is shared.
pub const RAW_EDIT_EXTS: &[&str] = &["xmp", "pp3", "dop", "acr", "on1", "arp", "cos"];

/// Photo formats WebView2 renders directly. Everything else gets a converted JPEG preview.
const WEB_IMAGE_EXTS: &[&str] = &["jpg", "jpeg", "jpe", "jfif", "png", "gif", "bmp", "webp", "avif"];

/// Video formats worth trying in the built-in player. The UI falls back to "Open in default
/// player" when the codec inside turns out to be unsupported (HEVC without the extension, etc).
const WEB_VIDEO_EXTS: &[&str] = &["mp4", "m4v", "mov", "qt", "webm", "ogv"];

/// Lookup table of recognised extensions, including any extras the user added in Settings.
#[derive(Debug, Clone)]
pub struct FormatTable {
    kinds: HashMap<String, Kind>,
}

impl Default for FormatTable {
    fn default() -> Self {
        Self::new(&[], &[])
    }
}

impl FormatTable {
    /// Build the table from the built-in lists plus user-added photo and video extensions.
    pub fn new(extra_photo: &[String], extra_video: &[String]) -> Self {
        let mut kinds = HashMap::new();
        for (list, kind) in [
            (PHOTO_EXTS, Kind::Photo),
            (RAW_EXTS, Kind::Raw),
            (VIDEO_EXTS, Kind::Video),
            (COMPANION_EXTS, Kind::Companion),
        ] {
            for ext in list {
                kinds.insert((*ext).to_string(), kind);
            }
        }
        for (list, kind) in [(extra_photo, Kind::Photo), (extra_video, Kind::Video)] {
            for ext in list {
                let ext = normalise_ext(ext);
                if !ext.is_empty() {
                    kinds.entry(ext).or_insert(kind);
                }
            }
        }
        Self { kinds }
    }

    /// Kind of file at `path`, or `None` when the extension isn't recognised.
    pub fn kind_of(&self, path: &Path) -> Option<Kind> {
        let ext = path.extension()?.to_str()?;
        self.kinds.get(&ext.to_ascii_lowercase()).copied()
    }

    /// True when `ext` (any case, with or without the dot) names a photo, RAW or video format.
    pub fn is_media_ext(&self, ext: &str) -> bool {
        matches!(
            self.kinds.get(&normalise_ext(ext)),
            Some(Kind::Photo | Kind::Raw | Kind::Video)
        )
    }
}

fn normalise_ext(ext: &str) -> String {
    ext.trim().trim_start_matches('.').to_ascii_lowercase()
}

/// Lowercase extension of `path` without the dot.
pub fn ext_of(path: &Path) -> String {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .unwrap_or_default()
}

/// True when the webview can display this photo without conversion.
pub fn web_viewable(path: &Path) -> bool {
    WEB_IMAGE_EXTS.contains(&ext_of(path).as_str())
}

/// True when the built-in player should try this video before offering the default player.
pub fn web_playable(path: &Path) -> bool {
    WEB_VIDEO_EXTS.contains(&ext_of(path).as_str())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_listed_extension_is_recognised_in_any_case() {
        let table = FormatTable::default();
        for (list, kind) in [
            (PHOTO_EXTS, Kind::Photo),
            (RAW_EXTS, Kind::Raw),
            (VIDEO_EXTS, Kind::Video),
            (COMPANION_EXTS, Kind::Companion),
        ] {
            for ext in list {
                for name in [
                    format!("a.{ext}"),
                    format!("a.{}", ext.to_uppercase()),
                    format!("a.{}", mixed_case(ext)),
                ] {
                    assert_eq!(table.kind_of(Path::new(&name)), Some(kind), "{name}");
                }
            }
        }
    }

    #[test]
    fn unknown_and_missing_extensions_are_rejected() {
        let table = FormatTable::default();
        for name in ["notes.txt", "doc.pdf", "archive.zip", "README", "photo.jpg.part", ".hidden"] {
            assert_eq!(table.kind_of(Path::new(name)), None, "{name}");
        }
    }

    #[test]
    fn extra_extensions_are_added_without_overriding_built_ins() {
        let table = FormatTable::new(&[".HEICS".into(), " jpg ".into()], &["mod".into()]);
        assert_eq!(table.kind_of(Path::new("x.heics")), Some(Kind::Photo));
        assert_eq!(table.kind_of(Path::new("x.MOD")), Some(Kind::Video));
        assert_eq!(table.kind_of(Path::new("x.jpg")), Some(Kind::Photo));
        assert!(table.is_media_ext(".Mod"));
        assert!(!table.is_media_ext("xmp"));
    }

    #[test]
    fn no_extension_is_listed_twice() {
        let mut seen = std::collections::HashSet::new();
        for ext in PHOTO_EXTS.iter().chain(RAW_EXTS).chain(VIDEO_EXTS).chain(COMPANION_EXTS) {
            assert!(seen.insert(*ext), "duplicate extension {ext}");
        }
    }

    fn mixed_case(ext: &str) -> String {
        ext.chars()
            .enumerate()
            .map(|(i, c)| if i % 2 == 0 { c.to_ascii_uppercase() } else { c })
            .collect()
    }
}
