// Small helpers shared by the Windows shell callers (thumbnails, property store).

use std::path::Path;

use windows::core::HSTRING;

/// Path in the form the shell's parsing-name APIs accept. They reject forward slashes with
/// E_INVALIDARG, and Rust happily builds mixed-slash paths (`C:\lib/2024/a.jpg`).
pub fn parsing_name(path: &Path) -> HSTRING {
    HSTRING::from(path.to_string_lossy().replace('/', "\\"))
}
