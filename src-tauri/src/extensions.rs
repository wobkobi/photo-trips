// Microsoft Store codec extensions: which ones this user has, and their Store pages. Windows needs
// them to preview HEIC photos, HEVC video, camera RAW and AVIF, so the Library suggests the
// missing ones when thumbnails fail.

use crate::error::{Error, Result};

/// Store product ids, keyed by the names the frontend uses. `hevc` is the free listing, which the
/// Store only offers on some PCs; `hevc_paid` is the same decoder as a small one-off purchase.
const STORE_PAGES: &[(&str, &str)] = &[
    ("heif", "9PMMSR1CGPWG"),
    ("hevc", "9N4WGH0Z6VHQ"),
    ("hevc_paid", "9NMZLZ57R3T7"),
    ("raw", "9NCTDW2W1BH8"),
    ("av1", "9MVZQVXJBQ9V"),
];

/// Package families that provide each codec, as the Store's catalogue lists them. Both HEVC
/// listings install the same decoder under different names (singular for the free one).
const PACKAGES: &[(&str, &[&str])] = &[
    ("heif", &["Microsoft.HEIFImageExtension_8wekyb3d8bbwe"]),
    (
        "hevc",
        &[
            "Microsoft.HEVCVideoExtension_8wekyb3d8bbwe",
            "Microsoft.HEVCVideoExtensions_8wekyb3d8bbwe",
        ],
    ),
    ("raw", &["Microsoft.RawImageExtension_8wekyb3d8bbwe"]),
    ("av1", &["Microsoft.AV1VideoExtension_8wekyb3d8bbwe"]),
];

/// The codecs this user already has, so the Library only suggests ones that would help.
#[tauri::command(async)]
pub fn installed_extensions() -> Vec<&'static str> {
    PACKAGES
        .iter()
        .filter(|(_, families)| families.iter().any(|family| package_installed(family)))
        .map(|(codec, _)| *codec)
        .collect()
}

/// Open an extension's page in the Microsoft Store app.
#[tauri::command]
pub fn open_store_page(product: String) -> Result<()> {
    let (_, id) = STORE_PAGES
        .iter()
        .find(|(name, _)| *name == product)
        .ok_or_else(|| Error::msg(format!("Unknown Store product {product}")))?;
    tauri_plugin_opener::open_url(
        format!("ms-windows-store://pdp/?ProductId={id}"),
        None::<&str>,
    )
    .map_err(|e| Error::msg(e.to_string()))
}

/// Whether any package of `family` is installed for the current user.
#[cfg(windows)]
fn package_installed(family: &str) -> bool {
    use windows::Win32::Foundation::{ERROR_INSUFFICIENT_BUFFER, ERROR_SUCCESS};
    use windows::Win32::Storage::Packaging::Appx::GetPackagesByPackageFamily;
    use windows::core::HSTRING;

    let (mut count, mut length) = (0u32, 0u32);
    // SAFETY: with no buffers passed, the call only writes the two counts.
    let status = unsafe {
        GetPackagesByPackageFamily(&HSTRING::from(family), &mut count, None, &mut length, None)
    };
    // Asked without a buffer, a family with packages reports the room their names need
    // (ERROR_INSUFFICIENT_BUFFER); one with none succeeds with a count of zero.
    (status == ERROR_INSUFFICIENT_BUFFER || status == ERROR_SUCCESS) && count > 0
}

#[cfg(not(windows))]
fn package_installed(_family: &str) -> bool {
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_codec_has_a_store_page() {
        for (codec, _) in PACKAGES {
            assert!(STORE_PAGES.iter().any(|(name, _)| name == codec), "{codec}");
        }
    }

    #[cfg(windows)]
    #[test]
    fn finds_an_installed_package_family() {
        // The Store app itself, which every PC that can install these extensions has.
        assert!(package_installed("Microsoft.WindowsStore_8wekyb3d8bbwe"));
    }

    #[test]
    fn missing_package_family_is_not_installed() {
        assert!(!package_installed("PicCabinet.NoSuchPackage_0000000000000"));
    }
}
